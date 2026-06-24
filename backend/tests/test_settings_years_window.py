"""
Route-level tests for the System Settings period dropdowns
(`GET /admin/settings/years`).

The key invariant: NO future period is ever offered. In the manual-cycle
model a period becomes configurable only once the org rolls into it, so the
FY dropdown is capped at the current FY and the half dropdown at the active
half (on H1, the H2 of the same FY is not yet shown).
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import list_settings_years
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
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


_n = {"i": 0}


def _admin(db, org_id):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role="Admin",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    return u


def _setup(db, *, active="H1 FY26-27"):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name=active,
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    admin = _admin(db, org.id)
    db.commit()
    return org, admin


def _labels(options):
    return [o.period_label for o in options]


def test_fy_dropdown_caps_at_current_fy(db):
    _org, admin = _setup(db, active="H1 FY26-27")
    resp = list_settings_years(db, admin)
    years = _labels(resp.years)
    # Current + two prior, NO future.
    assert "FY26-27" in years
    assert "FY25-26" in years
    assert "FY24-25" in years
    assert "FY27-28" not in years
    assert all(y <= "FY26-27" for y in years)
    # The current FY is flagged.
    assert next(o for o in resp.years if o.period_label == "FY26-27").is_current


def test_half_dropdown_caps_at_active_half_on_h1(db):
    _org, admin = _setup(db, active="H1 FY26-27")
    resp = list_settings_years(db, admin)
    halves = _labels(resp.halves)
    # Active half present and flagged.
    assert "H1 FY26-27" in halves
    assert next(o for o in resp.halves if o.period_label == "H1 FY26-27").is_current
    # The SAME-FY second half is still in the future on H1 — must not appear.
    assert "H2 FY26-27" not in halves
    # Prior-FY halves remain selectable.
    assert "H2 FY25-26" in halves
    assert "H1 FY25-26" in halves
    # No future-FY halves at all.
    assert not any(h.endswith("FY27-28") for h in halves)


def test_half_dropdown_includes_first_half_when_active_is_h2(db):
    _org, admin = _setup(db, active="H2 FY26-27")
    resp = list_settings_years(db, admin)
    halves = _labels(resp.halves)
    # On H2 both halves of the current FY are now in the past/present.
    assert "H1 FY26-27" in halves
    assert "H2 FY26-27" in halves
    assert next(o for o in resp.halves if o.period_label == "H2 FY26-27").is_current
    # Next FY's H1 is still future.
    assert "H1 FY27-28" not in halves


def test_future_override_row_is_not_surfaced(db):
    """A stray override row for a future period (shouldn't occur under normal
    roll-out) must not drag a future option into the dropdown."""
    org, admin = _setup(db, active="H1 FY26-27")
    db.add_all(
        [
            SystemSettingsYearOverride(org_id=org.id, period_label="FY27-28"),
            SystemSettingsYearOverride(org_id=org.id, period_label="H2 FY26-27"),
        ]
    )
    db.commit()
    resp = list_settings_years(db, admin)
    assert "FY27-28" not in _labels(resp.years)
    assert "H2 FY26-27" not in _labels(resp.halves)


def test_past_override_row_is_surfaced(db):
    org, admin = _setup(db, active="H1 FY26-27")
    db.add(
        SystemSettingsYearOverride(
            org_id=org.id, period_label="H2 FY25-26", annual_goals_edit_enabled=True
        )
    )
    db.commit()
    resp = list_settings_years(db, admin)
    h = next(o for o in resp.halves if o.period_label == "H2 FY25-26")
    assert h.has_override is True
