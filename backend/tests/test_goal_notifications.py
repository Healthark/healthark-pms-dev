"""
Route-level tests for the PR 2 goal notification hooks.

The goal endpoints are plain functions, so we call them directly with an
in-memory SQLite session, fabricated User objects, and a real BackgroundTasks
instance. SMTP is unconfigured in the test env, so create_notification's email
branch is a no-op — we assert the in-app Notification rows the hooks write.
"""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.goal_routes import (
    approve_goal,
    bulk_approve_goals,
    remind_goal_self_review,
    submit_goal,
    submit_goal_mentor_review,
    submit_goal_self_review,
)
from app.core.cycle_utils import current_half_and_fy
from app.core.database import Base
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.goal_schemas import (
    GoalApprovalUpdate,
    GoalBulkApproveRequest,
    GoalMentorReviewSubmit,
    GoalSelfReviewSubmit,
)


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
    """Org + SystemSettings + a mentor and a mentee who reports to them."""
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
    mentor = _user(db, org.id, role="Admin")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    return org, mentor, mentee


def _user(db, org_id, *, role="Staff", mentor_id=None, is_deleted=False):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_deleted=is_deleted,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _goal(db, org, owner, *, status, cycle_name=None, title="Goal X"):
    g = Goal(
        org_id=org.id,
        user_id=owner.id,
        title=title,
        goal_type=GoalType.ANNUAL.value,
        approval_status=status,
        cycle_name=cycle_name,
    )
    db.add(g)
    db.flush()
    return g


# ── approve / changes-requested ──────────────────────────────────────


def test_approve_goal_notifies_owner(db):
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.PENDING_APPROVAL.value)
    db.commit()

    approve_goal(
        g.id,
        GoalApprovalUpdate(approval_status=ApprovalStatus.APPROVED, feedback=None),
        db,
        mentor,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(Notification.type == "goal_approved").one()
    assert n.recipient_id == mentee.id
    assert n.category == "personal"
    assert n.link == "/annual-goals?tab=my"
    assert n.actor_id == mentor.id


def test_changes_requested_notifies_owner(db):
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.PENDING_APPROVAL.value)
    db.commit()

    approve_goal(
        g.id,
        GoalApprovalUpdate(
            approval_status=ApprovalStatus.CHANGES_REQUESTED, feedback="Please revise"
        ),
        db,
        mentor,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(Notification.type == "goal_changes_requested").one()
    assert n.recipient_id == mentee.id


# ── submit for approval ──────────────────────────────────────────────


def test_submit_goal_notifies_mentor(db):
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()

    submit_goal(g.id, db, mentee)

    n = db.query(Notification).filter(
        Notification.type == "goal_submitted_for_approval"
    ).one()
    assert n.recipient_id == mentor.id
    assert n.category == "personal"
    assert n.link == "/annual-goals?tab=team"
    assert n.actor_id == mentee.id


def test_submit_goal_skips_self_notification_when_mentor_submits(db):
    # An admin-mentor submitting their own mentee's draft IS the recipient,
    # so the self-notify guard suppresses the row.
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()

    submit_goal(g.id, db, mentor)

    assert db.query(Notification).filter(
        Notification.type == "goal_submitted_for_approval"
    ).count() == 0


def test_bulk_approve_notifies_each_owner(db):
    org, mentor, mentee = _setup(db)
    g1 = _goal(db, org, mentee, status=ApprovalStatus.PENDING_APPROVAL.value, title="G1")
    g2 = _goal(db, org, mentee, status=ApprovalStatus.PENDING_APPROVAL.value, title="G2")
    db.commit()

    result = bulk_approve_goals(
        GoalBulkApproveRequest(goal_ids=[g1.id, g2.id]), db, mentor, BackgroundTasks()
    )

    assert set(result.approved_ids) == {g1.id, g2.id}
    assert db.query(Notification).filter(Notification.type == "goal_approved").count() == 2


# ── self-review reminder ─────────────────────────────────────────────


def test_reminder_notifies_mentee(db):
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value)
    db.commit()

    remind_goal_self_review(g.id, db, mentor, BackgroundTasks())

    n = db.query(Notification).filter(Notification.type == "self_review_reminder").one()
    assert n.recipient_id == mentee.id
    assert n.link == "/annual-goals?tab=my"


def test_reminder_requires_assigned_mentor(db):
    org, mentor, mentee = _setup(db)
    outsider = _user(db, org.id, role="Staff")
    g = _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        remind_goal_self_review(g.id, db, outsider, BackgroundTasks())
    assert exc.value.status_code == 403
    assert db.query(Notification).count() == 0


def test_reminder_rejects_unapproved_goal(db):
    org, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        remind_goal_self_review(g.id, db, mentor, BackgroundTasks())
    assert exc.value.status_code == 400


# ── self-review / mentor-review submit (set up in the current FY window) ──


def test_self_review_submit_notifies_mentor(db):
    org, mentor, mentee = _setup(db)
    half, fy = current_half_and_fy(date.today(), 4)
    g = _goal(
        db, org, mentee, status=ApprovalStatus.APPROVED.value, cycle_name=f"{half} {fy}"
    )
    db.commit()

    submit_goal_self_review(
        g.id,
        SelfReviewCycleHalf(half),
        GoalSelfReviewSubmit(self_overall_review="Made solid progress."),
        db,
        mentee,
    )

    n = db.query(Notification).filter(
        Notification.type == "goal_self_review_submitted"
    ).one()
    assert n.recipient_id == mentor.id
    assert n.link == "/annual-goals?tab=team"


def test_mentor_review_submit_notifies_owner(db):
    org, mentor, mentee = _setup(db)
    half, fy = current_half_and_fy(date.today(), 4)
    g = _goal(
        db,
        org,
        mentee,
        status=f"{half.lower()}_self_reviewed",
        cycle_name=f"{half} {fy}",
    )
    db.add(
        GoalSelfReview(
            goal_id=g.id,
            org_id=org.id,
            cycle_half=half,
            self_overall_review="my self review",
            is_draft=False,
        )
    )
    db.commit()

    submit_goal_mentor_review(
        g.id,
        SelfReviewCycleHalf(half),
        GoalMentorReviewSubmit(mentor_overall_review="Strong half overall."),
        db,
        mentor,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(
        Notification.type == "goal_mentor_review_submitted"
    ).one()
    assert n.recipient_id == mentee.id
    assert n.link == "/annual-goals?tab=my"
