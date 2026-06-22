"""
Route-level tests for GET /annual-reviews/all (the admin All Reviews roster).

The route is a plain function, so we call it directly with an in-memory SQLite
session. Covers: real non-draft reviews across every year are returned, drafts
are excluded, and synthetic `not_started` rows are appended for the ACTIVE
cycle only (one per active employee with no review row there — a draft counts
as started). Admin-gated.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.annual_review_routes import get_all_reviews
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User

ACTIVE = "FY26-27"
PAST = "FY25-26"


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


def _user(db, org_id, *, role="Staff", is_management=False, mentor_id=None, name=None):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=name or f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_management=is_management,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _review(db, org_id, user_id, cycle, status, *, mentor_id=None):
    r = AnnualReview(
        org_id=org_id,
        user_id=user_id,
        mentor_id=mentor_id,
        cycle_name=cycle,
        status=status,
        self_performance_rating=2,
    )
    db.add(r)
    db.flush()
    return r


def _setup(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name="H1 FY26-27",
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    admin = _user(db, org.id, role="Admin", name="Admin")
    mentor = _user(db, org.id, role="Admin", is_management=True, name="Mentor")
    done = _user(db, org.id, name="Done Emp", mentor_id=mentor.id)
    pending = _user(db, org.id, name="Pending Emp", mentor_id=mentor.id)
    drafter = _user(db, org.id, name="Drafter Emp", mentor_id=mentor.id)
    _user(db, org.id, name="None Emp", mentor_id=mentor.id)  # not started
    past_only = _user(db, org.id, name="Past Emp", mentor_id=mentor.id)

    _review(db, org.id, done.id, ACTIVE, ReviewStatus.COMPLETED.value, mentor_id=mentor.id)
    _review(db, org.id, pending.id, ACTIVE, ReviewStatus.PENDING_MENTOR.value, mentor_id=mentor.id)
    _review(db, org.id, drafter.id, ACTIVE, ReviewStatus.DRAFT.value, mentor_id=mentor.id)
    _review(db, org.id, past_only.id, PAST, ReviewStatus.COMPLETED.value, mentor_id=mentor.id)
    db.commit()
    return org, admin


def _by_status(rows):
    real = [r for r in rows if r.status != ReviewStatus.NOT_STARTED]
    not_started = [r for r in rows if r.status == ReviewStatus.NOT_STARTED]
    return real, not_started


def test_returns_real_reviews_excluding_drafts(db):
    _org, admin = _setup(db)
    real, _ns = _by_status(get_all_reviews(db, admin))
    pairs = {(r.employee_name, r.cycle_name) for r in real}
    assert ("Done Emp", ACTIVE) in pairs
    assert ("Pending Emp", ACTIVE) in pairs
    assert ("Past Emp", PAST) in pairs
    # The drafter's active-cycle draft is private — never a real row.
    assert not any(name == "Drafter Emp" for (name, _c) in pairs)


def test_not_started_only_for_active_cycle_and_unstarted_employees(db):
    _org, admin = _setup(db)
    _real, ns = _by_status(get_all_reviews(db, admin))
    ns_names = {r.employee_name for r in ns}

    # No active-cycle row at all → not started.
    assert "None Emp" in ns_names
    # Only a PAST review → still not started for the active cycle.
    assert "Past Emp" in ns_names
    # A draft counts as started → NOT not_started (and the draft stays private).
    assert "Drafter Emp" not in ns_names
    # Submitted reviews are obviously not "not started".
    assert "Done Emp" not in ns_names
    assert "Pending Emp" not in ns_names

    # Every synthetic row is id-less and tagged to the active cycle.
    for r in ns:
        assert r.review_id is None
        assert r.cycle_name == ACTIVE
        assert r.self_performance_rating is None


def test_requires_admin(db):
    org, _admin = _setup(db)
    staff = _user(db, org.id, role="Staff", name="Staff Person")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        get_all_reviews(db, staff)
    assert exc.value.status_code == 403
