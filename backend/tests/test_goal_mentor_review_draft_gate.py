"""
Goal mentor-review DRAFT gate.

A mentor must be able to DRAFT their review of a mentee's goal BEFORE the mentee
submits their self-review; they only cannot SUBMIT until the self-review is in.
Drafting still requires the goal to be approved (this half active) and the
caller to be the assigned mentor. The route functions are called directly
against an in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.goal_routes import (
    save_goal_mentor_review_draft,
    submit_goal_mentor_review,
)
from app.core.cycle_utils import parse_cycle
from app.core.database import Base
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.goal_schemas import GoalMentorReviewDraft, GoalMentorReviewSubmit

_HALF, _FY = parse_cycle("H1 FY26-27")
_CYCLE_NAME = f"{_HALF} {_FY}"


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


def _user(db, org_id, *, mentor_id=None, role="Staff"):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role=role,
        password_hash="x",
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db, *, goal_status):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(
        org_id=org.id, active_cycle_name="H1 FY26-27",
        cycle_type="half_yearly", fiscal_start_month=4,
    ))
    mentor = _user(db, org.id, role="Admin")
    mentee = _user(db, org.id, mentor_id=mentor.id)
    goal = Goal(
        org_id=org.id, user_id=mentee.id, title="Goal X",
        goal_type=GoalType.ANNUAL.value, approval_status=goal_status,
        cycle_name=_CYCLE_NAME,
    )
    db.add(goal)
    db.flush()
    db.commit()
    return org, mentor, mentee, goal


def _draft(text="wip"):
    return GoalMentorReviewDraft(mentor_overall_review=text)


def _submit(text="final review"):
    return GoalMentorReviewSubmit(mentor_overall_review=text)


def test_mentor_can_draft_before_mentee_self_review(db):
    _org, mentor, _mentee, goal = _scenario(db, goal_status=ApprovalStatus.APPROVED.value)
    # No self-review exists yet — drafting must still succeed.
    save_goal_mentor_review_draft(goal.id, SelfReviewCycleHalf(_HALF), _draft(), db, mentor)
    row = db.query(GoalMentorReview).filter_by(goal_id=goal.id, cycle_half=_HALF).one()
    assert row.is_draft is True
    assert row.mentor_overall_review == "wip"
    # A draft does NOT advance the goal lifecycle.
    db.refresh(goal)
    assert goal.approval_status == ApprovalStatus.APPROVED.value


def test_mentor_cannot_submit_before_mentee_self_review(db):
    _org, mentor, _mentee, goal = _scenario(db, goal_status=ApprovalStatus.APPROVED.value)
    with pytest.raises(HTTPException) as ei:
        submit_goal_mentor_review(
            goal.id, SelfReviewCycleHalf(_HALF), _submit(), db, mentor, BackgroundTasks()
        )
    assert ei.value.status_code == 400


def test_mentor_draft_then_submit_after_self_review(db):
    _org, mentor, _mentee, goal = _scenario(db, goal_status=ApprovalStatus.APPROVED.value)
    # Mentor drafts early (before any self-review).
    save_goal_mentor_review_draft(
        goal.id, SelfReviewCycleHalf(_HALF), _draft("early notes"), db, mentor
    )
    # Mentee then submits their self-review; the goal advances.
    db.add(GoalSelfReview(
        goal_id=goal.id, org_id=goal.org_id, cycle_half=_HALF,
        self_overall_review="my self review", is_draft=False,
    ))
    goal.approval_status = f"{_HALF.lower()}_self_reviewed"
    db.commit()
    # Now the mentor can submit — it promotes the existing draft.
    submit_goal_mentor_review(
        goal.id, SelfReviewCycleHalf(_HALF), _submit("final"), db, mentor, BackgroundTasks()
    )
    row = db.query(GoalMentorReview).filter_by(goal_id=goal.id, cycle_half=_HALF).one()
    assert row.is_draft is False
    assert row.mentor_overall_review == "final"
    db.refresh(goal)
    assert goal.approval_status == f"{_HALF.lower()}_mentor_reviewed"


def test_mentor_draft_blocked_before_goal_approved(db):
    """Drafting still requires the goal to be approved — a pending-approval goal
    is not yet in the review phase."""
    _org, mentor, _mentee, goal = _scenario(
        db, goal_status=ApprovalStatus.PENDING_APPROVAL.value
    )
    with pytest.raises(HTTPException) as ei:
        save_goal_mentor_review_draft(goal.id, SelfReviewCycleHalf(_HALF), _draft(), db, mentor)
    assert ei.value.status_code == 400


def test_non_mentor_cannot_draft(db):
    org, _mentor, _mentee, goal = _scenario(db, goal_status=ApprovalStatus.APPROVED.value)
    stranger = _user(db, org.id)  # not the mentee's mentor
    db.commit()
    with pytest.raises(HTTPException) as ei:
        save_goal_mentor_review_draft(goal.id, SelfReviewCycleHalf(_HALF), _draft(), db, stranger)
    assert ei.value.status_code == 403
