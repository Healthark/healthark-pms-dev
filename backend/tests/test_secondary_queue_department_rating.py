"""
Secondary evaluator queue exposes the reviewed member's Department and the PM's
Rating.

Two bugs were fixed together:
  - Department never reached the card — SecondaryEvalCard had no department_name
    field and the builder never computed it, so the queue's Department column was
    always "—".
  - Rating was run through the employee-facing per-FY visibility gate, so the
    Secondary (a reviewer, not the rated employee) only saw it when an admin
    flipped the per-half toggle. The Secondary now sees the PM's rating once the
    PM finalises (status=reviewed); the PM's unsubmitted draft rating stays
    hidden.

Routes are plain functions, called directly against in-memory SQLite (mirrors
test_secondary_eval_before_pm.py).
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    get_secondary_evaluation_queue,
    submit_pm_evaluation,
    submit_secondary_evaluation,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    Project,
    ProjectAssignment,
)
from app.models.project_review_models import (
    PerformanceGroup,
    ProjectReview,
    ProjectReviewStatus,
)
from app.models.reference_models import Department
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import (
    PMEvaluationSubmit,
    SecondaryEvalSubmit,
)

ACTIVE_CYCLE = "H1 FY26-27"
FIRST_GROUP = next(iter(PerformanceGroup))


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


def _dept(db, org_id, name):
    d = Department(org_id=org_id, name=name)
    db.add(d)
    db.flush()
    return d


def _pm_payload():
    return PMEvaluationSubmit(
        performance_group=FIRST_GROUP,
        impact_statement="ok",
        comment_task_execution="ok",
        comment_ownership="ok",
        comment_project_management="ok",
        comment_client_deliverables="ok",
        comment_communication="ok",
        comment_mentoring="ok",
        comment_competency_skills="ok",
    )


def _scenario(db):
    """single-PM project, project-level Secondary, two members each in their own
    department. Returns (org, project, pm, m1, m2, sec, dept1, dept2)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))

    dept1 = _dept(db, org.id, "Engineering")
    dept2 = _dept(db, org.id, "Design")
    pm = _user(db, org.id)
    m1 = _user(db, org.id)
    m2 = _user(db, org.id)
    senior = _user(db, org.id)
    sec = _user(db, org.id)  # outside project-level secondary

    project = Project(
        org_id=org.id, project_code="SEC-DR-1", name="Proj",
        status=PROJECT_STATUS_ACTIVE, reports_to_id=senior.id,
        secondary_evaluator_id=sec.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=m1.id,
        department_id=dept1.id, is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=m2.id,
        department_id=dept2.id, is_deleted=False,
    ))
    db.commit()
    return org, project, pm, m1, m2, sec, dept1, dept2


# ── Department ────────────────────────────────────────────────────────

def test_secondary_queue_carries_member_department(db):
    _org, _project, _pm, m1, m2, sec, dept1, dept2 = _scenario(db)

    cards = {c.user_id: c for c in get_secondary_evaluation_queue(db, sec)}
    # Each member's department (from their assignment) reaches the card — no
    # longer hardcoded null.
    assert cards[m1.id].department_name == dept1.name
    assert cards[m2.id].department_name == dept2.name


# ── Rating visibility ─────────────────────────────────────────────────

def test_rating_hidden_while_pm_review_not_finalized(db):
    _org, project, _pm, m1, _m2, sec, _d1, _d2 = _scenario(db)

    # Secondary writes first → a PENDING parent review is created lazily.
    submit_secondary_evaluation(
        project.id, m1.id, SecondaryEvalSubmit(impact_statement="early"), db, sec,
    )
    # Simulate the PM parking a DRAFT rating on the still-pending review.
    review = db.query(ProjectReview).filter(
        ProjectReview.project_id == project.id, ProjectReview.user_id == m1.id,
    ).one()
    assert review.status == ProjectReviewStatus.PENDING.value
    review.performance_group = FIRST_GROUP.value
    db.commit()

    # The Secondary must NOT see the PM's draft rating.
    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    assert card.performance_group is None


def test_rating_visible_once_pm_finalizes(db):
    _org, project, pm, m1, _m2, sec, _d1, _d2 = _scenario(db)

    # PM evaluates → review becomes REVIEWED with a rating.
    submit_pm_evaluation(project.id, m1.id, _pm_payload(), db, pm)

    card = next(c for c in get_secondary_evaluation_queue(db, sec) if c.user_id == m1.id)
    # The Secondary, as a reviewer, now sees the PM's finalized rating —
    # regardless of the employee-facing per-FY visibility toggle.
    assert card.performance_group == FIRST_GROUP.value
