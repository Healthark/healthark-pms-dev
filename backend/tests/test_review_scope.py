"""
Per-employee project review scope (admin tab).

Excluding an (employee, project) pair sets ProjectAssignment.review_included
false, soft-deletes the pair's OPEN-cycle reviews (leaving closed past-FY
history intact), and drops the member from the PM's evaluation queue.
Re-including restores the open-cycle reviews. Route functions are called
directly against an in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    get_employee_review_scope,
    set_employee_review_scope,
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
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.admin_schemas import ReviewScopeProjectUpdate, ReviewScopeUpdate

_ACTIVE_CYCLE = "H2 FY26-27"
_OPEN_CYCLE = "H2 FY26-27"      # the active cycle — window open
_CLOSED_CYCLE = "H1 FY25-26"    # a prior fiscal year — window closed


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


def _project(db, org_id, *, code, billable=False):
    p = Project(
        org_id=org_id,
        project_code=code,
        name=f"Project {code}",
        status=PROJECT_STATUS_ACTIVE,
        is_billable=billable,
    )
    db.add(p)
    db.flush()
    return p


def _assign(db, org_id, project, user, *, evaluator_type=None):
    a = ProjectAssignment(
        org_id=org_id,
        project_id=project.id,
        user_id=user.id,
        evaluator_type=evaluator_type,
    )
    db.add(a)
    db.flush()
    return a


def _review(db, org_id, project, user, cycle, *, reviewer_id=None):
    r = ProjectReview(
        org_id=org_id,
        user_id=user.id,
        project_id=project.id,
        reviewer_id=reviewer_id,
        cycle=cycle,
        status=ProjectReviewStatus.REVIEWED.value,
        is_deleted=False,
    )
    db.add(r)
    db.flush()
    return r


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
    proj = _project(db, org.id, code="P1", billable=True)
    _assign(db, org.id, proj, pm, evaluator_type="Primary")
    member_assign = _assign(db, org.id, proj, member)
    db.commit()
    return org, admin, pm, member, proj, member_assign


def _exclude(db, admin, member, project):
    return set_employee_review_scope(
        member.id,
        ReviewScopeUpdate(projects=[
            ReviewScopeProjectUpdate(project_id=project.id, review_included=False)
        ]),
        db, admin,
    )


def _include(db, admin, member, project):
    return set_employee_review_scope(
        member.id,
        ReviewScopeUpdate(projects=[
            ReviewScopeProjectUpdate(project_id=project.id, review_included=True)
        ]),
        db, admin,
    )


def test_get_scope_lists_only_member_projects(db):
    org, admin, _pm, member, proj, _ma = _scenario(db)
    # A second project where the member is the PM — must NOT be scopable here.
    pm_proj = _project(db, org.id, code="P2")
    _assign(db, org.id, pm_proj, member, evaluator_type="Primary")
    db.commit()

    resp = get_employee_review_scope(member.id, db, admin)
    assert [p.project_id for p in resp.projects] == [proj.id]
    row = resp.projects[0]
    assert row.review_included is True
    assert row.is_billable is True


def test_exclude_softdeletes_open_cycle_keeps_closed(db):
    org, admin, _pm, member, proj, member_assign = _scenario(db)
    open_rv = _review(db, org.id, proj, member, _OPEN_CYCLE)
    closed_rv = _review(db, org.id, proj, member, _CLOSED_CYCLE)
    db.commit()

    _exclude(db, admin, member, proj)

    db.refresh(member_assign)
    db.refresh(open_rv)
    db.refresh(closed_rv)
    assert member_assign.review_included is False
    assert open_rv.is_deleted is True       # open cycle — soft-deleted
    assert closed_rv.is_deleted is False     # closed past FY — preserved as history


def test_reinclude_restores_open_cycle(db):
    org, admin, _pm, member, proj, member_assign = _scenario(db)
    open_rv = _review(db, org.id, proj, member, _OPEN_CYCLE)
    db.commit()

    _exclude(db, admin, member, proj)
    db.refresh(open_rv)
    assert open_rv.is_deleted is True

    _include(db, admin, member, proj)
    db.refresh(member_assign)
    db.refresh(open_rv)
    assert member_assign.review_included is True
    assert open_rv.is_deleted is False       # restored


def test_pm_queue_drops_excluded_member(db):
    org, admin, pm, member, proj, _ma = _scenario(db)

    before = {c.user_id for c in get_pm_evaluation_queue(db, pm)}
    assert member.id in before

    _exclude(db, admin, member, proj)

    after = {c.user_id for c in get_pm_evaluation_queue(db, pm)}
    assert member.id not in after


def test_my_projects_hides_softdeleted_reviews(db):
    # A soft-deleted (excluded) review must not surface in the employee's My
    # Reviews — even on a project still in scope (e.g. after a cross-FY
    # re-include leaves an old closed-cycle review soft-deleted).
    org, _admin, _pm, member, proj, _ma = _scenario(db)
    deleted_rv = _review(db, org.id, proj, member, _CLOSED_CYCLE)
    deleted_rv.is_deleted = True
    db.commit()

    cards = get_my_projects(db, member)
    assert deleted_rv.id not in {c.review_id for c in cards}


def test_non_admin_cannot_view_scope(db):
    _org, _admin, _pm, member, _proj, _ma = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        get_employee_review_scope(member.id, db, member)  # member is not an Admin
    assert ei.value.status_code == 403
