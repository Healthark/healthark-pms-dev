"""
Per-project review eligibility (admin Review Eligibility tab).

Marking a project ineligible (Project.review_eligible=False) removes it — every
member AND the PM — from every review surface; re-marking restores it. Pure
filter, nothing deleted. Route functions are called directly against an
in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    get_review_eligibility,
    set_review_eligibility,
)
from app.api.routes.project_review_routes import (
    get_my_projects,
    get_pm_evaluation_queue,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    Project,
    ProjectAssignment,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.admin_schemas import (
    ReviewEligibilityProjectUpdate,
    ReviewEligibilityUpdate,
)

_ACTIVE_CYCLE = "H2 FY26-27"


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
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(
        org_id=org.id, active_cycle_name=_ACTIVE_CYCLE,
        cycle_type="half_yearly", fiscal_start_month=4,
    ))
    admin = _user(db, org.id, role="Admin")
    pm = _user(db, org.id)
    member = _user(db, org.id)
    proj = Project(
        org_id=org.id, project_code="P1", name="Project P1",
        status=PROJECT_STATUS_ACTIVE, is_billable=True,
    )
    db.add(proj)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=pm.id, evaluator_type="Primary",
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=member.id,
    ))
    db.commit()
    return org, admin, pm, member, proj


def _set_eligible(db, admin, project, eligible):
    return set_review_eligibility(
        ReviewEligibilityUpdate(projects=[
            ReviewEligibilityProjectUpdate(
                project_id=project.id, review_eligible=eligible
            )
        ]),
        db, admin,
    )


def test_get_eligibility_lists_active_projects(db):
    _org, admin, _pm, _member, proj = _scenario(db)
    resp = get_review_eligibility(db, admin)
    assert [p.project_id for p in resp.projects] == [proj.id]
    row = resp.projects[0]
    assert row.review_eligible is True   # opt-out default
    assert row.is_billable is True


def test_ineligible_project_hidden_from_pm_queue(db):
    _org, admin, pm, member, proj = _scenario(db)
    assert member.id in {c.user_id for c in get_pm_evaluation_queue(db, pm)}

    _set_eligible(db, admin, proj, False)
    assert member.id not in {c.user_id for c in get_pm_evaluation_queue(db, pm)}


def test_ineligible_project_hidden_from_my_projects(db):
    _org, admin, _pm, member, proj = _scenario(db)
    assert proj.id in {c.project_id for c in get_my_projects(db, member)}

    _set_eligible(db, admin, proj, False)
    assert proj.id not in {c.project_id for c in get_my_projects(db, member)}


def test_reeligible_restores_project(db):
    _org, admin, pm, _member, proj = _scenario(db)
    _set_eligible(db, admin, proj, False)
    assert not get_pm_evaluation_queue(db, pm)

    _set_eligible(db, admin, proj, True)
    db.refresh(proj)
    assert proj.review_eligible is True
    assert get_pm_evaluation_queue(db, pm)  # project (and its member) are back


def test_non_admin_cannot_view_eligibility(db):
    _org, _admin, _pm, member, _proj = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        get_review_eligibility(db, member)  # member is not an Admin
    assert ei.value.status_code == 403
