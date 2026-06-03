"""
Route-level tests for project team-member soft delete + restore.

Same harness as test_project_notifications.py: call the route functions
directly against an in-memory SQLite session. We assert that removing a member
keeps the row (with audit), that removed members drop out of the active-team
helpers, that the PM stays protected, and that re-adding restores the same row.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_routes import (
    _resolve_project_pm,
    add_assignment,
    get_project_detail,
    remove_assignment,
    restore_assignment,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    Project,
    ProjectAssignment,
)
from app.models.user_models import User
from app.schemas.project_schemas import AssignmentCreate
from app.services.notifications import project_team_users


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
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _setup(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    admin = _user(db, org.id, role="Admin")
    return org, admin


def _project(db, org):
    _n["i"] += 1
    p = Project(
        org_id=org.id,
        project_code=f"P-{_n['i']:04d}",
        name="Proj X",
        status=PROJECT_STATUS_ACTIVE,
    )
    db.add(p)
    db.flush()
    return p


def _assign(db, org, project, user, *, evaluator_type=None):
    a = ProjectAssignment(
        org_id=org.id,
        project_id=project.id,
        user_id=user.id,
        evaluator_type=evaluator_type,
        is_deleted=False,
    )
    db.add(a)
    db.flush()
    return a


# ── Soft remove ──────────────────────────────────────────────────────


def test_remove_is_soft_with_audit(db):
    org, admin = _setup(db)
    member = _user(db, org.id)
    project = _project(db, org)
    a = _assign(db, org, project, member)
    db.commit()

    remove_assignment(a.id, db, admin)

    row = db.query(ProjectAssignment).filter(ProjectAssignment.id == a.id).one()
    assert row.is_deleted is True
    assert row.removed_at is not None
    assert row.removed_by_id == admin.id


def test_removed_member_drops_out_of_active_team(db):
    org, admin = _setup(db)
    pm = _user(db, org.id)
    member = _user(db, org.id)
    project = _project(db, org)
    _assign(db, org, project, pm, evaluator_type="Primary")
    a = _assign(db, org, project, member)
    db.commit()

    remove_assignment(a.id, db, admin)
    db.commit()

    team_ids = {u.id for u in project_team_users(db, org.id, project.id)}
    assert team_ids == {pm.id}  # removed member excluded
    pm_id, _ = _resolve_project_pm(db, project.id, org.id)
    assert pm_id == pm.id  # PM unaffected


def test_pm_cannot_be_removed(db):
    org, admin = _setup(db)
    pm = _user(db, org.id)
    project = _project(db, org)
    a = _assign(db, org, project, pm, evaluator_type="Primary")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        remove_assignment(a.id, db, admin)
    assert exc.value.status_code == 400


def test_remove_twice_is_rejected(db):
    org, admin = _setup(db)
    member = _user(db, org.id)
    project = _project(db, org)
    a = _assign(db, org, project, member)
    db.commit()

    remove_assignment(a.id, db, admin)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        remove_assignment(a.id, db, admin)
    assert exc.value.status_code == 400


# ── Re-add / restore ─────────────────────────────────────────────────


def test_readd_restores_existing_row(db):
    org, admin = _setup(db)
    member = _user(db, org.id)
    project = _project(db, org)
    a = _assign(db, org, project, member)
    db.commit()

    remove_assignment(a.id, db, admin)
    db.commit()

    # Re-adding the same user restores the existing row (unique index honoured).
    add_assignment(
        project.id,
        AssignmentCreate(user_id=member.id),
        db,
        admin,
        BackgroundTasks(),
    )

    rows = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.user_id == member.id,
    ).all()
    assert len(rows) == 1  # restored, not duplicated
    assert rows[0].is_deleted is False
    assert rows[0].removed_at is None
    assert rows[0].removed_by_id is None


def test_restore_endpoint_clears_marker(db):
    org, admin = _setup(db)
    member = _user(db, org.id)
    project = _project(db, org)
    a = _assign(db, org, project, member)
    db.commit()

    remove_assignment(a.id, db, admin)
    db.commit()

    result = restore_assignment(a.id, db, admin)
    assert result.is_deleted is False
    row = db.query(ProjectAssignment).filter(ProjectAssignment.id == a.id).one()
    assert row.is_deleted is False
    assert row.removed_at is None


def test_detail_includes_removed_last_with_audit(db):
    org, admin = _setup(db)
    active = _user(db, org.id)
    removed = _user(db, org.id)
    project = _project(db, org)
    _assign(db, org, project, active)
    a = _assign(db, org, project, removed)
    db.commit()

    remove_assignment(a.id, db, admin)
    db.commit()

    detail = get_project_detail(project.id, db, admin)
    # Active first, removed last.
    assert [x.is_deleted for x in detail.assignments] == [False, True]
    removed_row = detail.assignments[-1]
    assert removed_row.user_id == removed.id
    assert removed_row.removed_by_name == admin.full_name
    assert removed_row.removed_at is not None
