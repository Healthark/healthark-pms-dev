"""
Secondary-evaluator name on the My Reviews (MyProjectCard) and Evaluate Team
(PMPendingReviewCard) cards.

Resolution: single-PM → Project.secondary_evaluator_id; multi-PM → the member's
ProjectAssignment.secondary_evaluator_id, falling back to the project-level one.
Route functions are called directly against an in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
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


def _user(db, org_id, name):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=name,
        email=f"user{_n['i']}@example.com",
        role="Staff",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db, *, multi_pm=False, project_secondary=True, member_secondary=None):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(
        org_id=org.id, active_cycle_name="H2 FY26-27",
        cycle_type="half_yearly", fiscal_start_month=4,
    ))
    pm = _user(db, org.id, "PM Pat")
    member = _user(db, org.id, "Member Mia")
    proj_sec = _user(db, org.id, "Proj Secondary")
    proj = Project(
        org_id=org.id, project_code="P1", name="Project P1",
        status=PROJECT_STATUS_ACTIVE, multi_pm_enabled=multi_pm,
        secondary_evaluator_id=proj_sec.id if project_secondary else None,
    )
    db.add(proj)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=pm.id, evaluator_type="Primary",
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=member.id,
        secondary_evaluator_id=member_secondary.id if member_secondary else None,
    ))
    db.commit()
    return org, pm, member, proj_sec


def test_my_reviews_shows_project_secondary(db):
    _org, _pm, member, proj_sec = _scenario(db)
    cards = get_my_projects(db, member)
    assert cards
    assert all(c.secondary_evaluator_name == proj_sec.full_name for c in cards)


def test_pm_queue_shows_member_secondary(db):
    _org, pm, member, proj_sec = _scenario(db)
    cards = get_pm_evaluation_queue(db, pm)
    member_cards = [c for c in cards if c.user_id == member.id]
    assert member_cards
    assert all(c.secondary_evaluator_name == proj_sec.full_name for c in member_cards)


def test_multipm_per_member_secondary_overrides(db):
    # Multi-PM: the member's own ProjectAssignment.secondary_evaluator_id wins.
    org = Organization(name="Org2", enabled_features=[])
    db.add(org)
    db.flush()
    per_member_sec = _user(db, org.id, "Per Member Secondary")
    # Rebuild a scenario in this org with a per-member secondary set.
    db.add(SystemSettings(
        org_id=org.id, active_cycle_name="H2 FY26-27",
        cycle_type="half_yearly", fiscal_start_month=4,
    ))
    pm = _user(db, org.id, "PM2")
    member = _user(db, org.id, "Member2")
    proj_sec = _user(db, org.id, "Proj2 Secondary")
    proj = Project(
        org_id=org.id, project_code="P2", name="Project P2",
        status=PROJECT_STATUS_ACTIVE, multi_pm_enabled=True,
        secondary_evaluator_id=proj_sec.id,
    )
    db.add(proj)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=pm.id, evaluator_type="Primary",
    ))
    db.add(ProjectAssignment(
        org_id=org.id, project_id=proj.id, user_id=member.id,
        secondary_evaluator_id=per_member_sec.id,
    ))
    db.commit()

    cards = get_my_projects(db, member)
    assert cards
    assert all(c.secondary_evaluator_name == per_member_sec.full_name for c in cards)


def test_multipm_falls_back_to_project_secondary(db):
    # Multi-PM but the member has no per-member secondary → project-level wins.
    _org, _pm, member, proj_sec = _scenario(
        db, multi_pm=True, member_secondary=None
    )
    cards = get_my_projects(db, member)
    assert cards
    assert all(c.secondary_evaluator_name == proj_sec.full_name for c in cards)
