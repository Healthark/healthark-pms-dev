"""
Team-member (reviewee) visibility of their OWN project rating on the
Project Reviews → My Reviews table (`GET /project-reviews/mine`).

Reported bug: the PM drafts a project evaluation before submitting it. While
that evaluation is still a `draft`, the rating must stay private to the PM.
But `get_my_projects` gates the rating purely on the per-half
`project_ratings_visible` toggle — so an admin who had enabled "View ratings"
for the cycle leaked the PM's *draft* rating to the team member BEFORE Evaluate
was completed.

The rating must surface to the team member only when BOTH hold:
  1. the PM has submitted (status == reviewed), and
  2. the admin has published ratings for the half (project_ratings_visible).

`get_my_projects` is a plain function, so we call it directly against an
in-memory SQLite session (mirrors test_mentee_project_rating_visibility.py).
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import get_my_projects
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User

ACTIVE_CYCLE = "H1 FY26-27"
HALF_LABEL = "H1 FY26-27"       # the per-half override key for the active cycle
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


def _user(db, org_id, *, role="Staff"):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role=role,
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db):
    """Org + active cycle + one active project with a PM and a team member.
    Returns (org, pm, member, project)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))

    pm = _user(db, org.id, role="Manager")
    member = _user(db, org.id, role="Staff")

    project = Project(
        org_id=org.id,
        project_code="P-1",
        name="Proj",
        status=PROJECT_STATUS_ACTIVE,
    )
    db.add(project)
    db.flush()

    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False, review_included=True,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=member.id,
        is_deleted=False, review_included=True,
    ))
    db.commit()
    return org, pm, member, project


def _add_review(db, org, project, member, pm, status):
    rv = ProjectReview(
        org_id=org.id,
        project_id=project.id,
        user_id=member.id,
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


def _publish_ratings(db, org, *, visible):
    """Admin toggle: expose project ratings for the active half."""
    db.add(SystemSettingsYearOverride(
        org_id=org.id,
        period_label=HALF_LABEL,
        project_ratings_visible=visible,
    ))
    db.commit()


def _active_card(cards):
    active = [c for c in cards if c.cycle == ACTIVE_CYCLE]
    assert len(active) == 1, f"expected exactly one active-cycle card, got {active}"
    return active[0]


def test_member_cannot_see_draft_rating_even_when_published(db):
    """The reported leak: a PM draft rating stays hidden from the team member
    even after the admin has enabled "View ratings" for the cycle."""
    org, pm, member, project = _scenario(db)
    _add_review(db, org, project, member, pm, ProjectReviewStatus.DRAFT.value)
    _publish_ratings(db, org, visible=True)

    card = _active_card(get_my_projects(db, member))

    assert card.review_status == ProjectReviewStatus.DRAFT.value
    assert card.performance_group is None      # draft rating withheld


def test_member_cannot_see_pending_rating(db):
    """A stray rating on a still-pending review must not leak either."""
    org, pm, member, project = _scenario(db)
    _add_review(db, org, project, member, pm, ProjectReviewStatus.PENDING.value)
    _publish_ratings(db, org, visible=True)

    card = _active_card(get_my_projects(db, member))
    assert card.performance_group is None


def test_member_sees_rating_when_reviewed_and_published(db):
    """Once the PM submits AND the admin publishes, the rating surfaces."""
    org, pm, member, project = _scenario(db)
    _add_review(db, org, project, member, pm, ProjectReviewStatus.REVIEWED.value)
    _publish_ratings(db, org, visible=True)

    card = _active_card(get_my_projects(db, member))
    assert card.review_status == ProjectReviewStatus.REVIEWED.value
    assert card.performance_group == RATING


def test_member_cannot_see_reviewed_rating_when_not_published(db):
    """Reviewed but the admin toggle is off → still hidden (unchanged rule)."""
    org, pm, member, project = _scenario(db)
    _add_review(db, org, project, member, pm, ProjectReviewStatus.REVIEWED.value)
    _publish_ratings(db, org, visible=False)

    card = _active_card(get_my_projects(db, member))
    assert card.performance_group is None


def test_draft_rating_appears_only_after_submit(db):
    """End-to-end of the fix: hidden while draft, visible after submit — with
    the admin publish toggle ON the whole time."""
    org, pm, member, project = _scenario(db)
    review = _add_review(db, org, project, member, pm, ProjectReviewStatus.DRAFT.value)
    _publish_ratings(db, org, visible=True)

    # Draft → member sees nothing.
    card = _active_card(get_my_projects(db, member))
    assert card.performance_group is None

    # PM clicks "Submit Evaluate".
    review.status = ProjectReviewStatus.REVIEWED.value
    db.commit()

    # Reviewed → the same rating is now visible to the member.
    card = _active_card(get_my_projects(db, member))
    assert card.performance_group == RATING
