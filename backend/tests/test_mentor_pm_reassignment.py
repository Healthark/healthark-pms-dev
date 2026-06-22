"""
Mentor/PM reassignment — live access + admin coverage warning.

Covers the two behaviours added for mid-cycle reassignment:
  1. A reassigned mentor/PM gets the SAME access a regular one has — full
     review history + the right to act — because auth follows the LIVE
     relationship, not the frozen per-row stamp.
  2. Removing a mentor/PM that leaves mentees orphaned / a project PM-less
     surfaces via GET /admin/coverage-gaps and broadcasts an in-app warning
     to every admin.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    deactivate_user,
    get_coverage_gaps,
    update_user,
)
from app.api.routes.annual_review_routes import (
    get_mentee_reviews,
    get_review,
    submit_mentor_evaluation,
)
from app.api.routes.project_review_routes import update_review
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import ApprovalStatus, Goal
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import (
    PerformanceGroup as _PG,
)
from app.models.project_review_models import (
    ProjectReview,
    ProjectReviewStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.schemas.admin_schemas import UserUpdate
from app.schemas.annual_review_schemas import MentorEvalUpdate
from app.schemas.project_review_schemas import PMEvaluationSubmit

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


def _user(db, org_id, *, role="Staff", mentor_id=None):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role=role,
        password_hash="x",
        is_deleted=False,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _org_with_settings(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=FY))
    return org


def _annual_review(db, org_id, user_id, mentor_id, status, cycle_name=FY):
    r = AnnualReview(
        org_id=org_id,
        user_id=user_id,
        mentor_id=mentor_id,
        cycle_name=cycle_name,
        status=status,
    )
    db.add(r)
    db.flush()
    return r


# ── Annual reviews: live mentor access ───────────────────────────────


def test_new_mentor_sees_full_history_old_mentor_loses_it(db):
    org = _org_with_settings(db)
    sam = _user(db, org.id)       # old mentor
    dhaval = _user(db, org.id)    # new mentor
    aakash = _user(db, org.id, mentor_id=sam.id)
    # Aakash has a past completed review (prior FY, under Sam) + a current
    # pending one. One review per (user, cycle) — so use distinct cycles.
    _annual_review(
        db, org.id, aakash.id, sam.id, ReviewStatus.COMPLETED.value, cycle_name="FY25-26"
    )
    _annual_review(db, org.id, aakash.id, sam.id, ReviewStatus.PENDING_MENTOR.value)
    db.commit()

    # Reassign Aakash to Dhaval.
    aakash.mentor_id = dhaval.id
    db.commit()

    dhaval_list = get_mentee_reviews(db, dhaval)
    assert len(dhaval_list) == 2  # full history, incl. the completed one
    sam_list = get_mentee_reviews(db, sam)
    assert sam_list == []  # former mentor no longer sees ex-mentee


def test_former_mentor_denied_single_review_new_mentor_allowed(db):
    org = _org_with_settings(db)
    sam = _user(db, org.id)
    dhaval = _user(db, org.id)
    aakash = _user(db, org.id, mentor_id=dhaval.id)  # currently Dhaval's
    review = _annual_review(
        db, org.id, aakash.id, sam.id, ReviewStatus.PENDING_MENTOR.value
    )  # stamped to Sam at submit time
    db.commit()

    # Dhaval (current mentor) can view despite the frozen stamp pointing to Sam.
    assert get_review(review.id, db, dhaval).id == review.id
    # Sam (no longer the mentor) is denied even though the stamp is his.
    with pytest.raises(HTTPException) as exc:
        get_review(review.id, db, sam)
    assert exc.value.status_code == 403


def test_reassigned_mentor_can_submit_and_restamps(db):
    org = _org_with_settings(db)
    sam = _user(db, org.id)
    dhaval = _user(db, org.id)
    aakash = _user(db, org.id, mentor_id=dhaval.id)
    review = _annual_review(
        db, org.id, aakash.id, sam.id, ReviewStatus.PENDING_MENTOR.value
    )
    # Open annual reviews for the FY (per-FY gate).
    db.add(SystemSettingsYearOverride(
        org_id=org.id, fy_label=FY, annual_reviews_enabled=True
    ))
    db.commit()

    result = submit_mentor_evaluation(
        review.id,
        MentorEvalUpdate(mentor_overall_review="Solid work", mentor_performance_rating=4),
        db,
        dhaval,
        BackgroundTasks(),
    )
    assert result.status == ReviewStatus.PENDING_MANAGEMENT.value
    # Attribution re-stamped to the actual evaluator.
    assert result.mentor_id == dhaval.id


def test_old_mentor_cannot_submit_after_reassignment(db):
    org = _org_with_settings(db)
    sam = _user(db, org.id)
    dhaval = _user(db, org.id)
    aakash = _user(db, org.id, mentor_id=dhaval.id)
    review = _annual_review(
        db, org.id, aakash.id, sam.id, ReviewStatus.PENDING_MENTOR.value
    )
    db.commit()
    with pytest.raises(HTTPException) as exc:
        submit_mentor_evaluation(
            review.id,
            MentorEvalUpdate(mentor_overall_review="x", mentor_performance_rating=3),
            db,
            sam,
            BackgroundTasks(),
        )
    assert exc.value.status_code == 403


# ── Project reviews: new PM can edit ─────────────────────────────────


def _pm_payload():
    return PMEvaluationSubmit(
        performance_group=list(_PG)[0],
        impact_statement="Impactful",
        comment_task_execution="a",
        comment_ownership="b",
        comment_project_management="c",
        comment_client_deliverables="d",
        comment_communication="e",
        comment_mentoring="f",
        comment_competency_skills="g",
    )


def test_new_primary_can_edit_inflight_review_and_restamps(db):
    org = _org_with_settings(db)
    old_pm = _user(db, org.id)
    new_pm = _user(db, org.id)
    member = _user(db, org.id)
    project = Project(org_id=org.id, project_code="P1", name="Proj", status=PROJECT_STATUS_ACTIVE)
    db.add(project)
    db.flush()
    # new_pm is the CURRENT Primary; old_pm authored a draft review.
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=new_pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    review = ProjectReview(
        org_id=org.id, project_id=project.id, user_id=member.id,
        reviewer_id=old_pm.id, cycle=FY,
        status=ProjectReviewStatus.DRAFT.value, is_deleted=False,
    )
    db.add(review)
    db.commit()

    result = update_review(review.id, _pm_payload(), db, new_pm)
    assert result is not None
    db.refresh(review)
    assert review.reviewer_id == new_pm.id  # acting PM is recorded


def test_non_pm_non_reviewer_cannot_edit(db):
    org = _org_with_settings(db)
    pm = _user(db, org.id)
    stranger = _user(db, org.id)
    member = _user(db, org.id)
    project = Project(org_id=org.id, project_code="P2", name="Proj2", status=PROJECT_STATUS_ACTIVE)
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    review = ProjectReview(
        org_id=org.id, project_id=project.id, user_id=member.id,
        reviewer_id=pm.id, cycle=FY,
        status=ProjectReviewStatus.DRAFT.value, is_deleted=False,
    )
    db.add(review)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_review(review.id, _pm_payload(), db, stranger)
    assert exc.value.status_code == 403


# ── Coverage gaps + admin warning ────────────────────────────────────


def _make_gap_scenario(db):
    org = _org_with_settings(db)
    admin1 = _user(db, org.id, role="Admin")
    admin2 = _user(db, org.id, role="Admin")
    sam = _user(db, org.id)  # mentor + PM
    _user(db, org.id, mentor_id=sam.id)  # mentee 1
    _user(db, org.id, mentor_id=sam.id)  # mentee 2
    project = Project(org_id=org.id, project_code="P9", name="Proj9", status=PROJECT_STATUS_ACTIVE)
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=sam.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.commit()
    return org, admin1, admin2, sam, project


def test_coverage_endpoint_empty_then_populated(db):
    org, admin1, _admin2, sam, project = _make_gap_scenario(db)
    # Nothing dangling yet.
    before = get_coverage_gaps(db, admin1)
    assert before.orphaned_mentees == [] and before.pm_less_projects == []

    # Remove Sam → 2 mentees orphaned + 1 project PM-less.
    deactivate_user(sam.id, db, admin1)

    after = get_coverage_gaps(db, admin1)
    assert len(after.orphaned_mentees) == 2
    assert [p.id for p in after.pm_less_projects] == [project.id]


def test_deactivation_warns_all_admins(db):
    org, admin1, admin2, sam, _project = _make_gap_scenario(db)
    deactivate_user(sam.id, db, admin1)

    warnings = (
        db.query(Notification)
        .filter(Notification.type == "coverage_gap_warning")
        .all()
    )
    recipients = {n.recipient_id for n in warnings}
    assert recipients == {admin1.id, admin2.id}  # every active admin


def test_no_warning_when_no_impact(db):
    org = _org_with_settings(db)
    admin = _user(db, org.id, role="Admin")
    nobody = _user(db, org.id)  # not a mentor, not a PM
    db.commit()
    deactivate_user(nobody.id, db, admin)
    assert db.query(Notification).filter(
        Notification.type == "coverage_gap_warning"
    ).count() == 0


# ── Mentor reassignment: re-stamp in-flight reviews + clear draft + notify ──


def test_reassignment_restamps_inflight_clears_draft_and_notifies(db):
    org = _org_with_settings(db)
    admin = _user(db, org.id, role="Admin")
    old_m = _user(db, org.id)
    new_m = _user(db, org.id)
    mentee = _user(db, org.id, mentor_id=old_m.id)

    # In-flight (pending_mentor) review stamped to the old mentor, carrying
    # the old mentor's half-typed draft.
    review = _annual_review(
        db, org.id, mentee.id, old_m.id, ReviewStatus.PENDING_MENTOR.value
    )
    review.mentor_overall_review_draft = "old mentor half-typed"
    review.mentor_performance_rating_draft = 3
    # A completed prior-FY review must stay frozen (audit attribution).
    done = _annual_review(
        db, org.id, mentee.id, old_m.id, ReviewStatus.COMPLETED.value,
        cycle_name="FY25-26",
    )
    done.mentor_overall_review_draft = "should stay"
    db.commit()

    update_user(
        mentee.id, UserUpdate(mentor_id=new_m.id), db, admin, BackgroundTasks()
    )
    db.refresh(review)
    db.refresh(done)

    # In-flight review re-pointed to the new mentor + drafts wiped (so the
    # new mentor starts fresh and the old mentor's dashboard stops counting it).
    assert review.mentor_id == new_m.id
    assert review.mentor_overall_review_draft is None
    assert review.mentor_performance_rating_draft is None
    # Completed review left untouched.
    assert done.mentor_id == old_m.id
    assert done.mentor_overall_review_draft == "should stay"

    # Old mentor, new mentor, and mentee are each notified.
    fired = {(n.recipient_id, n.type) for n in db.query(Notification).all()}
    assert (new_m.id, "mentee_assigned") in fired
    assert (old_m.id, "mentee_unassigned") in fired
    assert (mentee.id, "mentor_reassigned") in fired


def test_reassignment_restamps_inflight_goals_keeps_completed(db):
    org = _org_with_settings(db)
    admin = _user(db, org.id, role="Admin")
    old_m = _user(db, org.id)
    new_m = _user(db, org.id)
    mentee = _user(db, org.id, mentor_id=old_m.id)

    # An active (approved, mid-cycle) goal still owned by the mentor pipeline.
    inflight = Goal(
        org_id=org.id, user_id=mentee.id, manager_id=old_m.id,
        title="In-flight goal",
        approval_status=ApprovalStatus.APPROVED.value,
    )
    # A fully-completed goal (final cycle mentor-reviewed) — historical.
    done = Goal(
        org_id=org.id, user_id=mentee.id, manager_id=old_m.id,
        title="Completed goal",
        approval_status=ApprovalStatus.H2_MENTOR_REVIEWED.value,
    )
    db.add_all([inflight, done])
    db.commit()

    update_user(
        mentee.id, UserUpdate(mentor_id=new_m.id), db, admin, BackgroundTasks()
    )
    db.refresh(inflight)
    db.refresh(done)

    # Active goal follows the new mentor (fixes the stale "Mentor" column/export)…
    assert inflight.manager_id == new_m.id
    # …but the completed goal keeps the mentor who actually reviewed it.
    assert done.manager_id == old_m.id
