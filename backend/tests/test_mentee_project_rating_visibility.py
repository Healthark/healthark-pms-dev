"""
Mentor visibility of a mentee's project rating on the My Mentees → Projects tab.

The PM (Primary evaluator) drafts a project evaluation before submitting it.
While that evaluation is still a `draft`, the rating must stay private to the
PM — the mentee's mentor should NOT see the performance group (nor the full
review detail) on the Projects / Annual Summary tabs. Only once the PM clicks
"Submit Evaluate" (status → `reviewed`) does the rating surface to the mentor.

`get_mentee_projects` is a plain function, so we call it directly against an
in-memory SQLite session with fabricated rows (mirrors
test_project_review_reports_to.py).
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.mentee_routes import get_mentee_projects
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User

ACTIVE_CYCLE = "H1 FY26-27"
RATING = "4"


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


def _scenario(db):
    """Org + active cycle + one project with a PM and a mentee, where the
    mentee reports to `mentor`. Returns (org, mentor, pm, mentee, project)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))

    mentor = _user(db, org.id, role="Manager")
    pm = _user(db, org.id, role="Manager")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)

    project = Project(
        org_id=org.id,
        project_code="P-1",
        name="Proj",
        status=PROJECT_STATUS_ACTIVE,
    )
    db.add(project)
    db.flush()

    # PM is the project's Primary evaluator; the mentee is a regular member.
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=mentee.id,
        is_deleted=False,
    ))
    db.commit()
    return org, mentor, pm, mentee, project


def _add_review(db, org, project, mentee, pm, status):
    rv = ProjectReview(
        org_id=org.id,
        project_id=project.id,
        user_id=mentee.id,
        reviewer_id=pm.id,
        cycle=ACTIVE_CYCLE,
        status=status,
        performance_group=RATING,
        impact_statement="Solid contribution.",
        comment_task_execution="ok",
        is_deleted=False,
    )
    db.add(rv)
    db.commit()
    return rv


def _active_row(rows):
    """The single Projects-tab row for the active cycle."""
    active = [r for r in rows if r.cycle == ACTIVE_CYCLE]
    assert len(active) == 1, f"expected exactly one active-cycle row, got {active}"
    return active[0]


def test_mentor_cannot_see_draft_rating(db):
    """A PM's saved-but-unsubmitted draft rating stays hidden from the mentor."""
    org, mentor, pm, mentee, project = _scenario(db)
    _add_review(db, org, project, mentee, pm, ProjectReviewStatus.DRAFT.value)

    rows = get_mentee_projects(mentee.id, db, mentor)
    row = _active_row(rows)

    assert row.review_status == ProjectReviewStatus.DRAFT.value
    assert row.performance_group is None      # rating withheld
    assert row.review_detail is None          # full evaluation withheld too


def test_mentor_cannot_see_pending_rating(db):
    """Even a stray rating on a still-pending review must not leak."""
    org, mentor, pm, mentee, project = _scenario(db)
    _add_review(db, org, project, mentee, pm, ProjectReviewStatus.PENDING.value)

    rows = get_mentee_projects(mentee.id, db, mentor)
    row = _active_row(rows)

    assert row.performance_group is None
    assert row.review_detail is None


def test_mentor_sees_rating_once_reviewed(db):
    """Once the PM submits (status → reviewed), the rating + detail surface."""
    org, mentor, pm, mentee, project = _scenario(db)
    _add_review(db, org, project, mentee, pm, ProjectReviewStatus.REVIEWED.value)

    rows = get_mentee_projects(mentee.id, db, mentor)
    row = _active_row(rows)

    assert row.review_status == ProjectReviewStatus.REVIEWED.value
    assert row.performance_group == RATING
    assert row.review_detail is not None
    assert row.review_detail.performance_group == RATING


def test_draft_rating_appears_only_after_submit(db):
    """End-to-end of the reported bug: hidden while draft, visible after submit."""
    org, mentor, pm, mentee, project = _scenario(db)
    review = _add_review(db, org, project, mentee, pm, ProjectReviewStatus.DRAFT.value)

    # Draft → mentor sees nothing.
    row = _active_row(get_mentee_projects(mentee.id, db, mentor))
    assert row.performance_group is None
    assert row.review_detail is None

    # PM clicks "Submit Evaluate".
    review.status = ProjectReviewStatus.REVIEWED.value
    db.commit()

    # Reviewed → the same rating is now visible to the mentor.
    row = _active_row(get_mentee_projects(mentee.id, db, mentor))
    assert row.performance_group == RATING
    assert row.review_detail is not None
