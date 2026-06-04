"""
Brute-force throttle on /auth/login: after N failed attempts for an account
within the window, further attempts are refused with 429 — checked BEFORE the
password is verified, and recorded in the login_attempts ledger.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes import auth_routes
from app.core.config import settings
from app.core.database import Base
from app.core.security import get_password_hash
from app.models.login_attempt_models import LoginAttempt
from app.models.organization_models import Organization
from app.models.user_models import User


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


def _fake_request(ip="203.0.113.7"):
    return SimpleNamespace(headers={}, client=SimpleNamespace(host=ip))


def _make_user(db, email="dave@example.com", password="correct-horse"):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    u = User(
        org_id=org.id,
        employee_code="EMP-0001",
        full_name="Dave",
        email=email,
        role="Staff",
        password_hash=get_password_hash(password),
        is_deleted=False,
    )
    db.add(u)
    db.commit()
    return u


def _attempt(db, email, password):
    return auth_routes.login(
        OAuth2PasswordRequestForm(username=email, password=password, scope=""),
        db,
        Response(),
        _fake_request(),
    )


def test_failed_attempts_are_recorded(db):
    _make_user(db, email="dave@example.com")
    with pytest.raises(HTTPException) as exc:
        _attempt(db, "dave@example.com", "wrong")
    assert exc.value.status_code == 401
    assert db.query(LoginAttempt).filter(LoginAttempt.email == "dave@example.com").count() == 1


def test_throttle_trips_after_cap(db, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 3)
    _make_user(db, email="dave@example.com", password="right")

    for _ in range(3):
        with pytest.raises(HTTPException) as exc:
            _attempt(db, "dave@example.com", "wrong")
        assert exc.value.status_code == 401

    # 4th attempt is refused before the password is even checked — so even the
    # CORRECT password now yields 429 until the window passes.
    with pytest.raises(HTTPException) as exc:
        _attempt(db, "dave@example.com", "right")
    assert exc.value.status_code == 429


def test_unknown_email_is_throttled_too(db, monkeypatch):
    """Spray against non-existent accounts still climbs the window count."""
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 2)
    for _ in range(2):
        with pytest.raises(HTTPException) as exc:
            _attempt(db, "ghost@example.com", "x")
        assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _attempt(db, "ghost@example.com", "x")
    assert exc.value.status_code == 429


def test_successful_login_under_cap_works_and_records_nothing(db, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 5)
    _make_user(db, email="dave@example.com", password="right")

    result = _attempt(db, "dave@example.com", "right")
    assert "csrf_token" in result
    # Only failures are ledgered.
    assert db.query(LoginAttempt).count() == 0
