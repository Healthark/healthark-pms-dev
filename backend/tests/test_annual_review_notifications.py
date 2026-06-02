"""
Route-level tests for the PR 3 annual-review notification hooks.

Same approach as test_goal_notifications: call the route functions directly
against an in-memory SQLite session with fabricated users + an open review
window. SMTP is unconfigured in tests, so the email branch is a no-op — we
assert the in-app Notification rows.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.annual_review_routes import (
    create_self_appraisal,
    set_management_rating,
    submit_mentor_evaluation,
)
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.schemas.annual_review_schemas import (
    ManagementRatingUpdate,
    MentorEvalUpdate,
    SelfAppraisalCreate,
)

FY = "FY26-27"


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


def _setup(db):
    """Org + open-review-window settings + mentor, mentee, management user."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name=FY,
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    db.add(
        SystemSettingsYearOverride(
            org_id=org.id, fy_label=FY, annual_reviews_enabled=True
        )
    )
    mentor = _user(db, org.id, role="Admin")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    management = _user(db, org.id, role="Admin", is_management=True)
    return org, mentor, mentee, management


def _user(db, org_id, *, role="Staff", mentor_id=None, is_management=False):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_deleted=False,
        mentor_id=mentor_id,
        is_management=is_management,
    )
    db.add(u)
    db.flush()
    return u


def _review(db, org, mentee, mentor, *, status):
    r = AnnualReview(
        org_id=org.id,
        user_id=mentee.id,
        mentor_id=mentor.id if mentor else None,
        cycle_name=FY,
        status=status,
    )
    db.add(r)
    db.flush()
    return r


def test_self_appraisal_notifies_mentor(db):
    org, mentor, mentee, _mgmt = _setup(db)
    db.commit()

    create_self_appraisal(
        SelfAppraisalCreate(self_overall_review="Solid year.", self_performance_rating=3),
        db,
        mentee,
    )

    n = db.query(Notification).filter(Notification.type == "annual_self_submitted").one()
    assert n.recipient_id == mentor.id
    assert n.link == "/annual-reviews?tab=team"
    assert n.actor_id == mentee.id


def test_self_appraisal_without_mentor_sends_nothing(db):
    org, _mentor, _mentee, _mgmt = _setup(db)
    orphan = _user(db, org.id, role="Staff")  # no mentor_id
    db.commit()

    create_self_appraisal(
        SelfAppraisalCreate(self_overall_review="No mentor here.", self_performance_rating=3),
        db,
        orphan,
    )
    assert db.query(Notification).count() == 0


def test_mentor_eval_notifies_employee(db):
    org, mentor, mentee, _mgmt = _setup(db)
    review = _review(db, org, mentee, mentor, status=ReviewStatus.PENDING_MENTOR.value)
    db.commit()

    submit_mentor_evaluation(
        review.id,
        MentorEvalUpdate(mentor_overall_review="Great work.", mentor_performance_rating=2),
        db,
        mentor,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(
        Notification.type == "annual_mentor_eval_submitted"
    ).one()
    assert n.recipient_id == mentee.id
    # The mentor's review text must not leak into the mentee-facing body
    # (the mentee can't see ratings/text until later).
    assert "Great work." not in n.body


def test_management_rating_notifies_employee_on_publish(db):
    org, mentor, mentee, mgmt = _setup(db)
    review = _review(db, org, mentee, mentor, status=ReviewStatus.PENDING_MANAGEMENT.value)
    db.commit()

    set_management_rating(review.id, ManagementRatingUpdate(management_performance_rating=2), db, mgmt)
    rows = db.query(Notification).filter(
        Notification.type == "annual_management_published"
    ).all()
    assert len(rows) == 1
    assert rows[0].recipient_id == mentee.id
    # Exact generic body — proves the rating value never enters the message.
    assert rows[0].body == f"Your {FY} performance review has been finalized."

    # A re-publish (adjusting the rating on an already-COMPLETED row) notifies
    # again — every publish tells the employee their finalized rating changed.
    set_management_rating(review.id, ManagementRatingUpdate(management_performance_rating=1), db, mgmt)
    assert (
        db.query(Notification)
        .filter(Notification.type == "annual_management_published")
        .count()
        == 2
    )
