"""
Project reviews are scoped to the fiscal YEAR, not the half/quarter window.

Unlike annual goals (which carry a separate H1 and H2 self/mentor review),
a project gets exactly ONE review per employee per project per fiscal year.
These tests lock that contract at the route layer:

  - `_get_active_cycle` strips the cadence prefix → bare FY label.
  - A PM evaluation is stamped with the FY label, not "H1 FY..".
  - Rotating the org's active cycle H1 → H2 within the same FY does NOT
    open a second review — the existing one is hit (409).
  - A genuinely new fiscal year DOES get its own review row.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    _get_active_cycle,
    submit_pm_evaluation,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import PerformanceGroup, ProjectReview
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import PMEvaluationSubmit


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


def _user(db, org_id, role="Staff"):
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


def _set_active_cycle(db, org_id, cycle_name):
    row = db.query(SystemSettings).filter_by(org_id=org_id).first()
    if row is None:
        db.add(SystemSettings(org_id=org_id, active_cycle_name=cycle_name))
    else:
        row.active_cycle_name = cycle_name
    db.commit()


def _scenario(db, active_cycle="H1 FY26-27"):
    """One org (half-yearly), a PM and an employee both on one project."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    _set_active_cycle(db, org.id, active_cycle)

    pm = _user(db, org.id)
    emp = _user(db, org.id)
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
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=emp.id,
        is_deleted=False,
    ))
    db.commit()
    return org, pm, emp, project


def _payload():
    return PMEvaluationSubmit(
        performance_group=PerformanceGroup.RATING_3,
        impact_statement="Solid, steady contributor across the engagement.",
        comment_task_execution="Executed assigned tasks reliably.",
        comment_ownership="Owned their modules end-to-end.",
        comment_project_management="Kept the tracker clean.",
        comment_client_deliverables="Deliverables were client-ready.",
        comment_communication="Clear written and verbal updates.",
        comment_mentoring="Supported juniors on methodology.",
        comment_competency_skills="Building strong domain depth.",
    )


# ── _get_active_cycle strips the cadence prefix ──────────────────────

def test_active_cycle_is_bare_fy_for_half_yearly(db):
    org, *_ = _scenario(db, active_cycle="H1 FY26-27")
    assert _get_active_cycle(db, org.id) == "FY26-27"


def test_active_cycle_is_bare_fy_for_quarterly(db):
    org, *_ = _scenario(db, active_cycle="Q3 FY27-28")
    assert _get_active_cycle(db, org.id) == "FY27-28"


# ── A submitted review is stamped with the FY label ──────────────────

def test_submit_stamps_fy_label(db):
    org, pm, emp, project = _scenario(db, active_cycle="H1 FY26-27")
    resp = submit_pm_evaluation(project.id, emp.id, _payload(), db, pm)
    assert resp.cycle == "FY26-27"

    rows = db.query(ProjectReview).filter_by(
        org_id=org.id, user_id=emp.id, project_id=project.id
    ).all()
    assert len(rows) == 1
    assert rows[0].cycle == "FY26-27"


# ── The core guarantee: H1 → H2 rotation does NOT add a 2nd review ───

def test_h1_then_h2_same_fy_is_single_review(db):
    org, pm, emp, project = _scenario(db, active_cycle="H1 FY26-27")
    submit_pm_evaluation(project.id, emp.id, _payload(), db, pm)

    # Admin rotates the org into the second half of the SAME fiscal year.
    _set_active_cycle(db, org.id, "H2 FY26-27")

    # Re-submitting now resolves to the same FY-scoped row → already reviewed.
    with pytest.raises(HTTPException) as exc:
        submit_pm_evaluation(project.id, emp.id, _payload(), db, pm)
    assert exc.value.status_code == 409

    rows = db.query(ProjectReview).filter_by(
        org_id=org.id, user_id=emp.id, project_id=project.id
    ).all()
    assert len(rows) == 1, "H1+H2 of one FY must collapse to a single review"
    assert rows[0].cycle == "FY26-27"


# ── A new fiscal year gets its own review row ────────────────────────

def test_new_fy_opens_a_fresh_review(db):
    org, pm, emp, project = _scenario(db, active_cycle="H1 FY26-27")
    submit_pm_evaluation(project.id, emp.id, _payload(), db, pm)

    # Roll over into the next fiscal year.
    _set_active_cycle(db, org.id, "H1 FY27-28")
    resp = submit_pm_evaluation(project.id, emp.id, _payload(), db, pm)
    assert resp.cycle == "FY27-28"

    cycles = {
        r.cycle
        for r in db.query(ProjectReview).filter_by(
            org_id=org.id, user_id=emp.id, project_id=project.id
        ).all()
    }
    assert cycles == {"FY26-27", "FY27-28"}
