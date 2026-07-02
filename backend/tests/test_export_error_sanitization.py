"""
Export audit-log error sanitization.

A failed export must NOT persist the raw exception text into
export_audit_log.error_message: SQLAlchemy/psycopg2 errors stringify with the
DB host/port/user, the failing SQL, and its bound parameters. Only a redacted,
non-sensitive summary (class name, or an app-authored HTTPException detail) may
be stored; the full detail goes to the server log instead.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.export_routes import _finish_audit_failure
from app.core.database import Base
from app.core.errors import safe_error_summary
from app.models.export_audit_log_models import ExportAuditLog
from app.models.organization_models import Organization
from app.models.user_models import User

# A driver error whose text carries everything we must never persist.
_LEAKY_ORIG = (
    'connection to server at "prod-db.internal.company.com" (10.2.3.4), '
    'port 5432 failed: FATAL: password authentication failed for user "pms_app"'
)
_SECRET_FRAGMENTS = [
    "prod-db.internal.company.com",
    "10.2.3.4",
    "5432",
    "pms_app",
    "password",
]


def _operational_error() -> OperationalError:
    return OperationalError(
        "SELECT users.email FROM users WHERE org_id = %(org_id)s",
        {"org_id": 7},
        Exception(_LEAKY_ORIG),
    )


# ── safe_error_summary (pure function) ───────────────────────────────


def test_db_error_reduced_to_class_name_only():
    err = _operational_error()
    # Sanity: the raw text really does leak (guards the test itself).
    assert any(frag in str(err) for frag in _SECRET_FRAGMENTS)

    summary = safe_error_summary(err)
    assert summary == "OperationalError"
    for frag in _SECRET_FRAGMENTS:
        assert frag not in summary


@pytest.mark.parametrize("exc", [RuntimeError(_LEAKY_ORIG), KeyError("host=db pw=x")])
def test_arbitrary_exceptions_reduced_to_class_name(exc):
    summary = safe_error_summary(exc)
    assert summary == type(exc).__name__
    for frag in _SECRET_FRAGMENTS:
        assert frag not in summary


def test_http_exception_keeps_app_authored_detail():
    err = HTTPException(status_code=413, detail="Export exceeds 100000 rows.")
    assert safe_error_summary(err) == "HTTPException: Export exceeds 100000 rows."


def test_http_exception_detail_is_redacted():
    err = HTTPException(
        status_code=500,
        detail="db down: postgresql://pms_app:hunter2@10.2.3.4:5432/pms password=hunter2",
    )
    summary = safe_error_summary(err)
    assert "hunter2" not in summary
    assert "postgresql://" not in summary
    assert "[redacted" in summary


def test_summary_is_truncated():
    err = HTTPException(status_code=400, detail="x" * 1000)
    # "HTTPException: " prefix + 300-char cap.
    assert len(safe_error_summary(err)) <= len("HTTPException: ") + 300


# ── End-to-end: _finish_audit_failure persists only the safe summary ──


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def test_finish_audit_failure_persists_sanitized_message(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    user = User(
        org_id=org.id,
        employee_code="EMP-0001",
        full_name="HR Admin",
        email="hr@example.com",
        role="Admin",
        password_hash="x",
        is_deleted=False,
    )
    db.add(user)
    db.flush()

    audit = ExportAuditLog(
        org_id=org.id,
        user_id=user.id,
        export_type="users",
        scope="central",
        status="started",
    )
    db.add(audit)
    db.commit()

    _finish_audit_failure(db, audit, _operational_error())

    stored = db.query(ExportAuditLog).filter(ExportAuditLog.id == audit.id).one()
    assert stored.status == "failed"
    assert stored.error_message == "OperationalError"
    assert stored.completed_at is not None
    for frag in _SECRET_FRAGMENTS:
        assert frag not in (stored.error_message or "")
