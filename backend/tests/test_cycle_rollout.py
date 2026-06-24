"""
Route-level tests for manual cycle roll-out.

The endpoints are plain functions, so we call them directly against an
in-memory SQLite session with a fabricated org / settings / admin. Covers the
status preview, a mid-FY advance, an FY rollover (fresh all-closed FY config +
audit), the manual set + its validation, the announcement, and the admin gate.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import get_cycle_status, rollout_cycle, set_cycle
from app.core.database import Base
from app.models.cycle_rollout_log_models import CycleRolloutLog
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.schemas.admin_schemas import CycleSetRequest


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


def _user(db, org_id, *, role="Staff"):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
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
    admin = _user(db, org.id, role="Admin")
    db.commit()
    return org, admin


def test_status_preview_midfy(db):
    _org, admin = _setup(db)
    status = get_cycle_status(db, admin)
    assert status.active_cycle == "H1 FY26-27"
    assert status.next_cycle == "H2 FY26-27"
    assert status.effects.fy_rollover is False
    assert status.effects.requires_typed_confirmation is False


def test_status_preview_flags_fy_rollover(db):
    _org, admin = _setup(db, active="H2 FY26-27")
    status = get_cycle_status(db, admin)
    assert status.next_cycle == "H1 FY27-28"
    assert status.effects.fy_rollover is True
    assert status.effects.requires_typed_confirmation is True


def test_rollout_midfy_advances_and_audits(db):
    org, admin = _setup(db)
    result = rollout_cycle(db, admin)
    assert result.active_cycle == "H2 FY26-27"
    settings = db.query(SystemSettings).filter_by(org_id=org.id).one()
    assert settings.active_cycle_name == "H2 FY26-27"
    log = db.query(CycleRolloutLog).filter_by(org_id=org.id).one()
    assert (log.from_cycle, log.to_cycle, log.kind) == (
        "H1 FY26-27",
        "H2 FY26-27",
        "rollout",
    )


def test_rollout_fy_rollover_creates_all_closed_fy(db):
    org, admin = _setup(db, active="H2 FY26-27")
    # Prior FY had a window open — it must NOT carry over to the new FY.
    db.add(
        SystemSettingsYearOverride(
            org_id=org.id, fy_label="FY26-27", annual_reviews_enabled=True
        )
    )
    db.commit()

    result = rollout_cycle(db, admin)
    assert result.active_cycle == "H1 FY27-28"

    new = (
        db.query(SystemSettingsYearOverride)
        .filter_by(org_id=org.id, fy_label="FY27-28")
        .one()
    )
    # Every per-FY window starts closed (default-deny), overriding the seed.
    assert new.annual_reviews_enabled is False
    assert new.management_review_enabled is False
    assert new.annual_goals_edit_enabled is False


def test_rollout_broadcasts_announcement(db):
    _org, admin = _setup(db)
    rollout_cycle(db, admin)
    rows = db.query(Notification).filter(Notification.type == "cycle_rollout").all()
    assert len(rows) >= 1
    assert rows[0].recipient_id == admin.id
    assert "H2 FY26-27" in rows[0].body


def test_set_cycle_valid(db):
    org, admin = _setup(db)
    result = set_cycle(CycleSetRequest(target_cycle="H2 FY26-27"), db, admin)
    assert result.active_cycle == "H2 FY26-27"
    log = db.query(CycleRolloutLog).filter_by(org_id=org.id).one()
    assert log.kind == "set"


def test_set_cycle_rejects_malformed(db):
    _org, admin = _setup(db)
    with pytest.raises(HTTPException) as exc:
        set_cycle(CycleSetRequest(target_cycle="garbage"), db, admin)
    assert exc.value.status_code == 400


def test_set_cycle_rejects_off_cadence(db):
    # Half-yearly org cannot be set to a quarterly cycle.
    _org, admin = _setup(db)
    with pytest.raises(HTTPException) as exc:
        set_cycle(CycleSetRequest(target_cycle="Q1 FY26-27"), db, admin)
    assert exc.value.status_code == 400


def test_rollout_requires_admin(db):
    org, _admin = _setup(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        rollout_cycle(db, staff)
    assert exc.value.status_code == 403


def test_rollback_across_fy_preserves_prior_config(db):
    """Rolling BACK to a prior, already-configured fiscal year must NOT reset
    its windows — only a genuinely new FY starts all-closed."""
    org, admin = _setup(db, active="H2 FY26-27")
    db.add(
        SystemSettingsYearOverride(
            org_id=org.id, fy_label="FY26-27", annual_reviews_enabled=True
        )
    )
    db.commit()

    rollout_cycle(db, admin)  # → H1 FY27-28 (new FY created all-closed)
    set_cycle(CycleSetRequest(target_cycle="H2 FY26-27"), db, admin)  # roll back

    prior = (
        db.query(SystemSettingsYearOverride)
        .filter_by(org_id=org.id, fy_label="FY26-27")
        .one()
    )
    assert prior.annual_reviews_enabled is True  # preserved, not reset


def test_status_reports_previous_cycle_for_rollback(db):
    _org, admin = _setup(db)
    assert get_cycle_status(db, admin).previous_cycle is None  # never changed
    rollout_cycle(db, admin)  # H1 → H2
    assert get_cycle_status(db, admin).previous_cycle == "H1 FY26-27"
