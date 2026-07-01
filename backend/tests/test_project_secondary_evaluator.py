"""
The Secondary evaluator must be an OUTSIDE reviewer — never a member of the
team they evaluate. This is enforced at every write point that could create the
conflict: project create (schema validator), project update (route), and
member add (route). These tests exercise each guard + a positive case.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_routes import (
    add_assignment,
    remove_assignment,
    restore_assignment,
    update_assignment,
    update_project,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.user_models import User
from app.schemas.project_schemas import (
    AssignmentCreate,
    AssignmentUpdate,
    ProjectCreate,
    ProjectUpdate,
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
    """Org + admin + a project with a PM and one regular member, reports-to set
    to an outsider, secondary unset. Returns (org, admin, project, pm, member,
    reports_to, outsider)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    admin = _user(db, org.id, role="Admin")
    pm = _user(db, org.id)
    member = _user(db, org.id)
    reports_to = _user(db, org.id)
    outsider = _user(db, org.id)
    project = Project(
        org_id=org.id, project_code="P-1", name="Proj",
        status=PROJECT_STATUS_ACTIVE, reports_to_id=reports_to.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=member.id, is_deleted=False,
    ))
    db.commit()
    return org, admin, project, pm, member, reports_to, outsider


# ── Create (schema validator) ────────────────────────────────────────

def test_create_schema_rejects_secondary_who_is_a_member():
    with pytest.raises(ValidationError) as ei:
        ProjectCreate(
            project_code="P1", name="P",
            reports_to_id=999,
            secondary_evaluator_id=2,  # same as the regular member below
            assignments=[
                AssignmentCreate(user_id=1, evaluator_type="Primary"),
                AssignmentCreate(user_id=2),
            ],
        )
    assert "team member" in str(ei.value)


def test_create_schema_allows_outsider_secondary():
    project = ProjectCreate(
        project_code="P1", name="P",
        reports_to_id=999,
        secondary_evaluator_id=888,  # not among the members
        assignments=[
            AssignmentCreate(user_id=1, evaluator_type="Primary"),
            AssignmentCreate(user_id=2),
        ],
    )
    assert project.secondary_evaluator_id == 888


# ── Update project (route) ───────────────────────────────────────────

def test_update_project_rejects_setting_secondary_to_a_member(db):
    _org, admin, project, _pm, member, _rt, _out = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        update_project(project.id, ProjectUpdate(secondary_evaluator_id=member.id), db, admin)
    assert ei.value.status_code == 400
    assert "team member" in ei.value.detail


def test_update_project_allows_outsider_secondary(db):
    _org, admin, project, _pm, _member, _rt, outsider = _scenario(db)
    update_project(project.id, ProjectUpdate(secondary_evaluator_id=outsider.id), db, admin)
    db.refresh(project)
    assert project.secondary_evaluator_id == outsider.id


# ── Add member (route) ───────────────────────────────────────────────

def test_add_member_rejects_the_current_secondary(db):
    _org, admin, project, _pm, _member, _rt, outsider = _scenario(db)
    # Make the outsider the project's secondary evaluator (valid — not a member).
    project.secondary_evaluator_id = outsider.id
    db.commit()
    # Now try to add that same person as a team member → blocked.
    with pytest.raises(HTTPException) as ei:
        add_assignment(
            project.id, AssignmentCreate(user_id=outsider.id), db, admin, BackgroundTasks()
        )
    assert ei.value.status_code == 400
    assert "Secondary Evaluator" in ei.value.detail


def test_restore_member_who_became_secondary_is_blocked(db):
    """Bypass guard: remove a member → make them the secondary (allowed while
    they're inactive) → restoring them must be blocked."""
    _org, admin, project, _pm, member, _rt, _out = _scenario(db)
    m_assignment = (
        db.query(ProjectAssignment)
        .filter_by(project_id=project.id, user_id=member.id)
        .one()
    )
    remove_assignment(m_assignment.id, db, admin)
    update_project(project.id, ProjectUpdate(secondary_evaluator_id=member.id), db, admin)
    with pytest.raises(HTTPException) as ei:
        restore_assignment(m_assignment.id, db, admin)
    assert ei.value.status_code == 400
    assert "Secondary Evaluator" in ei.value.detail


def test_create_schema_rejects_secondary_who_is_the_pm():
    with pytest.raises(ValidationError) as ei:
        ProjectCreate(
            project_code="P1", name="P",
            reports_to_id=999,
            secondary_evaluator_id=1,  # same as the PM
            assignments=[
                AssignmentCreate(user_id=1, evaluator_type="Primary"),
                AssignmentCreate(user_id=2),
            ],
        )
    assert "different user than the PM" in str(ei.value)


def test_add_member_as_pm_rejects_the_current_secondary(db):
    """Fresh-add + Primary path: adding the current secondary as a new PM is
    blocked by the general member guard (before the 'already has a PM' check)."""
    _org, admin, project, _pm, _member, _rt, outsider = _scenario(db)
    project.secondary_evaluator_id = outsider.id
    db.commit()
    with pytest.raises(HTTPException) as ei:
        add_assignment(
            project.id,
            AssignmentCreate(user_id=outsider.id, evaluator_type="Primary"),
            db, admin, BackgroundTasks(),
        )
    assert ei.value.status_code == 400
    assert "Secondary Evaluator" in ei.value.detail


def test_promote_member_to_pm_blocked_when_they_are_the_secondary(db):
    """update_assignment's promotion guard (defense-in-depth): promoting a
    member to PM is blocked when they are the project's secondary. The API
    normally prevents member==secondary, so the conflicting state is forced
    directly to exercise the guard."""
    org, admin, _project, _pm, _member, reports_to, outsider = _scenario(db)
    # A PM-less project so the promotion reaches the secondary check (rather
    # than the earlier 'already has a Primary' guard).
    project2 = Project(
        org_id=org.id, project_code="P-2", name="Proj2",
        status=PROJECT_STATUS_ACTIVE, reports_to_id=reports_to.id,
        secondary_evaluator_id=outsider.id,
    )
    db.add(project2)
    db.flush()
    m2 = _user(db, org.id)
    a2 = ProjectAssignment(
        org_id=org.id, project_id=project2.id, user_id=m2.id, is_deleted=False,
    )
    db.add(a2)
    db.flush()
    project2.secondary_evaluator_id = m2.id  # force the (API-prevented) conflict
    db.commit()
    with pytest.raises(HTTPException) as ei:
        update_assignment(a2.id, AssignmentUpdate(evaluator_type="Primary"), db, admin)
    assert ei.value.status_code == 400
    assert "Secondary Evaluator" in ei.value.detail


def test_restore_member_succeeds_after_secondary_reassigned(db):
    """The restore guard is specific to the CURRENT secondary — once the
    secondary is reassigned to someone else, the removed member restores fine."""
    _org, admin, project, _pm, member, _rt, outsider = _scenario(db)
    m_assignment = (
        db.query(ProjectAssignment)
        .filter_by(project_id=project.id, user_id=member.id)
        .one()
    )
    remove_assignment(m_assignment.id, db, admin)
    update_project(project.id, ProjectUpdate(secondary_evaluator_id=member.id), db, admin)
    update_project(project.id, ProjectUpdate(secondary_evaluator_id=outsider.id), db, admin)
    restore_assignment(m_assignment.id, db, admin)
    db.refresh(m_assignment)
    assert m_assignment.is_deleted is False
