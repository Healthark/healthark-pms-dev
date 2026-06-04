"""
Export hardening: CSV/Excel formula-injection neutralization + the per-sheet
row cap that prevents an unbounded in-memory workbook from OOM-ing the worker.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.user_models import User
from app.services import exporters


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


_n = {"i": 0}


def _org(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    return org


def _user(db, org_id, *, full_name):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=full_name,
        email=f"user{_n['i']}@example.com",
        role="Staff",
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _full_name_column(ws) -> int:
    for col in range(1, ws.max_column + 1):
        if ws.cell(row=1, column=col).value == "Full Name":
            return col
    raise AssertionError("Full Name column not found")


# ── Formula injection ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "payload",
    [
        '=HYPERLINK("http://evil","x")',
        "+1+1",
        "-2+3",
        "@SUM(A1:A9)",
        "=cmd|'/c calc'!A1",
    ],
)
def test_formula_injection_is_neutralized(db, payload):
    org = _org(db)
    _user(db, org.id, full_name=payload)
    db.commit()

    wb, _ = exporters.build_single_entity_workbook("users", db, org.id)
    ws = wb["Users"]
    col = _full_name_column(ws)
    value = ws.cell(row=2, column=col).value

    # Prefixed with a single quote → inert text, not a formula.
    assert value == "'" + payload
    assert ws.cell(row=2, column=col).data_type == "s"


def test_benign_value_is_untouched(db):
    org = _org(db)
    _user(db, org.id, full_name="Alice Normal")
    db.commit()

    wb, _ = exporters.build_single_entity_workbook("users", db, org.id)
    ws = wb["Users"]
    col = _full_name_column(ws)
    assert ws.cell(row=2, column=col).value == "Alice Normal"


# ── Row cap (OOM guard) ──────────────────────────────────────────────


def test_export_refuses_when_over_row_cap(db, monkeypatch):
    org = _org(db)
    for i in range(3):
        _user(db, org.id, full_name=f"User {i}")
    db.commit()

    monkeypatch.setattr(exporters, "MAX_EXPORT_ROWS", 2)
    with pytest.raises(HTTPException) as exc:
        exporters.build_single_entity_workbook("users", db, org.id)
    assert exc.value.status_code == 413


def test_export_allowed_at_cap(db, monkeypatch):
    org = _org(db)
    for i in range(2):
        _user(db, org.id, full_name=f"User {i}")
    db.commit()

    monkeypatch.setattr(exporters, "MAX_EXPORT_ROWS", 2)
    wb, n = exporters.build_single_entity_workbook("users", db, org.id)
    assert n == 2  # exactly at the cap is fine
