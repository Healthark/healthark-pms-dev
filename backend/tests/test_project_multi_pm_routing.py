"""
Multi-PM hierarchy — evaluation routing (PR2).

When Project.multi_pm_enabled is on, evaluations route by the per-member
manager_id: a PM sees only their DIRECT reports (in a chain A -> B -> C, A
reviews B and B reviews C — A never reviews C), roots (no manager_id) are
reviewed by the project's reports_to senior (there may be several), and
secondary feedback honours the per-member secondary_evaluator_id. A member's
PM may be any org user, not just a project member.

Routes are plain functions, so we call them directly against an in-memory
SQLite session (mirrors test_project_review_reports_to.py).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    get_pm_evaluation_queue,
    get_reports_to_evaluation_queue,
    get_secondary_evaluation_queue,
    submit_pm_evaluation,
    submit_reports_to_evaluation,
    submit_secondary_evaluation,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import PerformanceGroup, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import PMEvaluationSubmit, SecondaryEvalSubmit

ACTIVE_CYCLE = "H1 FY26-27"


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


def _payload():
    return PMEvaluationSubmit(
        performance_group=next(iter(PerformanceGroup)),
        impact_statement="ok",
        comment_task_execution="ok",
        comment_ownership="ok",
        comment_project_management="ok",
        comment_client_deliverables="ok",
        comment_communication="ok",
        comment_mentoring="ok",
        comment_competency_skills="ok",
    )


def _org_cycle(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    return org


def _project(db, org, *, reports_to=None, multi_pm=True):
    project = Project(
        org_id=org.id,
        project_code=f"MP-{_n['i']}",
        name="Multi",
        status=PROJECT_STATUS_ACTIVE,
        multi_pm_enabled=multi_pm,
        reports_to_id=reports_to.id if reports_to else None,
    )
    db.add(project)
    db.flush()
    return project


def _assign(db, org, project, user, *, manager=None, primary=False, secondary=None):
    a = ProjectAssignment(
        org_id=org.id,
        project_id=project.id,
        user_id=user.id,
        evaluator_type="Primary" if primary else None,
        manager_id=manager.id if manager else None,
        secondary_evaluator_id=secondary.id if secondary else None,
        review_included=True,
        is_deleted=False,
    )
    db.add(a)
    db.flush()
    return a


def _chain(db):
    """Multi-PM project with a A -> B -> C chain, a reports_to senior, and a
    per-member Secondary evaluator on C. Returns (org, project, a, b, c,
    senior, sec)."""
    org = _org_cycle(db)
    a = _user(db, org.id)
    b = _user(db, org.id)
    c = _user(db, org.id)
    senior = _user(db, org.id)
    sec = _user(db, org.id)
    project = _project(db, org, reports_to=senior)
    _assign(db, org, project, a, primary=True)              # root (manager_id None)
    _assign(db, org, project, b, manager=a)                 # B -> A
    _assign(db, org, project, c, manager=b, secondary=sec)  # C -> B, sec reviews C
    db.commit()
    return org, project, a, b, c, senior, sec


# ── PM queue — direct reports only ────────────────────────────────────

def test_pm_queue_lists_only_direct_reports(db):
    _org, _p, a, b, c, _senior, _sec = _chain(db)
    assert {card.user_id for card in get_pm_evaluation_queue(db, a)} == {b.id}
    assert {card.user_id for card in get_pm_evaluation_queue(db, b)} == {c.id}
    assert get_pm_evaluation_queue(db, c) == []  # C manages no one


def test_two_members_sharing_a_pm_are_both_queued(db):
    org = _org_cycle(db)
    a = _user(db, org.id)
    b = _user(db, org.id)
    c = _user(db, org.id)
    senior = _user(db, org.id)
    project = _project(db, org, reports_to=senior)
    _assign(db, org, project, a, primary=True)
    _assign(db, org, project, b, manager=a)
    _assign(db, org, project, c, manager=a)
    db.commit()
    assert {card.user_id for card in get_pm_evaluation_queue(db, a)} == {b.id, c.id}


# ── PM evaluate — direct reports only ─────────────────────────────────

def test_pm_can_evaluate_direct_report_but_not_grandchild(db):
    _org, project, a, b, c, _senior, _sec = _chain(db)

    resp = submit_pm_evaluation(project.id, b.id, _payload(), db, a)  # A -> B ok
    assert resp.status == ProjectReviewStatus.REVIEWED
    assert resp.reviewer_id == a.id

    with pytest.raises(HTTPException) as ei:  # A -> C forbidden (grandchild)
        submit_pm_evaluation(project.id, c.id, _payload(), db, a)
    assert ei.value.status_code == 403

    resp2 = submit_pm_evaluation(project.id, c.id, _payload(), db, b)  # B -> C ok
    assert resp2.reviewer_id == b.id


def test_non_member_pm_gets_a_queue_and_can_evaluate(db):
    """A member's PM may be a user who isn't on the team; they still see and
    can evaluate that member."""
    org = _org_cycle(db)
    outsider = _user(db, org.id)  # NOT assigned to the project
    member = _user(db, org.id)
    senior = _user(db, org.id)
    project = _project(db, org, reports_to=senior)
    _assign(db, org, project, member, manager=outsider)  # PM is a non-member
    db.commit()

    assert {c.user_id for c in get_pm_evaluation_queue(db, outsider)} == {member.id}
    resp = submit_pm_evaluation(project.id, member.id, _payload(), db, outsider)
    assert resp.reviewer_id == outsider.id


# ── Reports-to — reviews the roots ────────────────────────────────────

def test_reports_to_queue_lists_only_roots(db):
    _org, _p, a, _b, _c, senior, _sec = _chain(db)
    assert {card.user_id for card in get_reports_to_evaluation_queue(db, senior)} == {a.id}


def test_reports_to_reviews_every_root_on_a_flat_team(db):
    """Three top-level members, no central PM — reports_to reviews all three."""
    org = _org_cycle(db)
    senior = _user(db, org.id)
    x = _user(db, org.id)
    y = _user(db, org.id)
    z = _user(db, org.id)
    project = _project(db, org, reports_to=senior)
    for m in (x, y, z):
        _assign(db, org, project, m, primary=True)  # each a root
    db.commit()
    assert {c.user_id for c in get_reports_to_evaluation_queue(db, senior)} == {x.id, y.id, z.id}


def test_reports_to_cannot_submit_for_a_non_root(db):
    _org, project, _a, b, _c, senior, _sec = _chain(db)
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, b.id, _payload(), db, senior)
    assert ei.value.status_code == 404


def test_reports_to_submits_a_root_review(db):
    _org, project, a, _b, _c, senior, _sec = _chain(db)
    resp = submit_reports_to_evaluation(project.id, a.id, _payload(), db, senior)
    assert resp.user_id == a.id
    assert resp.reviewer_id == senior.id
    assert resp.status == ProjectReviewStatus.REVIEWED


def test_reports_to_who_is_also_a_root_skips_the_self_pair(db):
    """When PM Reports To is also a root member, they never review themselves."""
    org = _org_cycle(db)
    a = _user(db, org.id)          # will be BOTH a root and the reports_to
    b = _user(db, org.id)
    project = _project(db, org, reports_to=a)
    _assign(db, org, project, a, primary=True)   # root
    _assign(db, org, project, b, manager=a)      # B -> A
    db.commit()

    # A's reports-to queue excludes A (self); B is A's PM-queue report, not here.
    assert get_reports_to_evaluation_queue(db, a) == []
    with pytest.raises(HTTPException) as ei:
        submit_reports_to_evaluation(project.id, a.id, _payload(), db, a)
    assert ei.value.status_code == 400  # cannot evaluate yourself


# ── Secondary — per-member evaluator ──────────────────────────────────

def test_secondary_routes_to_the_per_member_evaluator(db):
    _org, project, a, b, c, _senior, sec = _chain(db)
    # Both B and C get PM-reviewed so two reviewed rows exist.
    submit_pm_evaluation(project.id, b.id, _payload(), db, a)
    c_review = submit_pm_evaluation(project.id, c.id, _payload(), db, b)

    # sec is only C's secondary — B's review (no secondary) must not appear.
    queue = get_secondary_evaluation_queue(db, sec)
    assert [r.user_id for r in queue] == [c.id]

    out = submit_secondary_evaluation(
        c_review.id, SecondaryEvalSubmit(impact_statement="Strong client impact."), db, sec
    )
    assert out.evaluator_id == sec.id


def test_non_secondary_cannot_submit_secondary(db):
    _org, project, _a, b, c, _senior, _sec = _chain(db)
    c_review = submit_pm_evaluation(project.id, c.id, _payload(), db, b)
    other = _user(db, project.org_id)  # nobody's secondary
    with pytest.raises(HTTPException) as ei:
        submit_secondary_evaluation(
            c_review.id, SecondaryEvalSubmit(impact_statement="x"), db, other
        )
    assert ei.value.status_code == 403
    assert get_secondary_evaluation_queue(db, other) == []
