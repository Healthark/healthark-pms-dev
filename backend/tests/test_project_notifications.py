"""
Route-level tests for the PR 4 project notification hooks.

Same approach as the other notification suites: call the route functions
directly against an in-memory SQLite session with a real BackgroundTasks.
SMTP is unconfigured in tests, so the email branch is a no-op — we assert the
in-app Notification rows.
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_routes import (
    add_assignment,
    complete_project,
    create_project,
)
from app.core.database import Base
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    Project,
    ProjectAssignment,
)
from app.models.user_models import User
from app.schemas.project_schemas import AssignmentCreate, ProjectCreate


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
    member = _user(db, org.id)
    return org, admin, member


def _project(db, org, *, status=PROJECT_STATUS_ACTIVE):
    _n["i"] += 1
    p = Project(
        org_id=org.id,
        project_code=f"P-{_n['i']:04d}",
        name="Proj X",
        status=status,
    )
    db.add(p)
    db.flush()
    return p


def test_add_assignment_notifies_member(db):
    org, admin, member = _setup(db)
    project = _project(db, org)
    db.commit()

    add_assignment(
        project.id,
        AssignmentCreate(user_id=member.id),
        db,
        admin,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(Notification.type == "project_assigned").one()
    assert n.recipient_id == member.id
    assert n.link == "/project-reviews"
    assert n.entity_type == "project"
    assert n.entity_id == project.id


def test_create_project_notifies_initial_members(db):
    org, admin, member = _setup(db)
    pm = _user(db, org.id)
    senior = _user(db, org.id)
    db.commit()

    payload = ProjectCreate(
        project_code="P-NEW",
        name="New Project",
        reports_to_id=senior.id,
        assignments=[
            AssignmentCreate(user_id=pm.id, evaluator_type="Primary"),
            AssignmentCreate(user_id=member.id),
        ],
    )
    create_project(payload, db, admin, BackgroundTasks())

    rows = db.query(Notification).filter(Notification.type == "project_assigned").all()
    assert {r.recipient_id for r in rows} == {pm.id, member.id}


def test_complete_project_notifies_team_once(db):
    org, admin, member = _setup(db)
    member2 = _user(db, org.id)
    project = _project(db, org)
    db.add(ProjectAssignment(org_id=org.id, project_id=project.id, user_id=member.id))
    db.add(ProjectAssignment(org_id=org.id, project_id=project.id, user_id=member2.id))
    db.commit()

    complete_project(project.id, db, admin, BackgroundTasks())
    rows = db.query(Notification).filter(Notification.type == "project_completed").all()
    assert {r.recipient_id for r in rows} == {member.id, member2.id}

    # Re-complete an already-completed project — idempotent, no second notice.
    complete_project(project.id, db, admin, BackgroundTasks())
    assert (
        db.query(Notification)
        .filter(Notification.type == "project_completed")
        .count()
        == 2
    )
