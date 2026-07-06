"""
Competency framework — additive foundation (PR 1).

Covers three things, all against an in-memory SQLite session:

  1. The migration's data step (``_seed_and_backfill``): seeds the org DEFAULT
     competency set and backfills the exp_* / comment_* values into the new
     JSON columns keyed by competency id — losing nothing.
  2. ``get_competency_set`` resolution: scoped (department, level) set wins;
     otherwise the org default is returned flagged is_default; deleted
     competencies are excluded; ordering is by display_order.
  3. The ``GET /competencies`` endpoint returns the resolved set + is_default.

These are all plain functions, so we call them directly.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import get_competencies
from app.core.database import Base
from app.models.competency_models import Competency
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.models.user_models import User
from app.services.competency_service import get_competency_set


# ── Load the migration module (filename starts with a digit) ─────────────
_MIG_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "d1f7a2c9e4b6_add_competencies_framework.py"
)
_spec = importlib.util.spec_from_file_location("_competency_migration", _MIG_PATH)
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


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


def _org(db, name="Org"):
    o = Organization(name=name, enabled_features=[])
    db.add(o)
    db.flush()
    return o


def _user(db, org_id, *, role="Admin"):
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


def _competency(db, org_id, key, label, order, *, dept_id=None, level=None,
                reviewable=True, deleted=False):
    c = Competency(
        org_id=org_id,
        department_id=dept_id,
        level=level,
        key=key,
        label=label,
        display_order=order,
        is_reviewable=reviewable,
        is_deleted=deleted,
    )
    db.add(c)
    db.flush()
    return c


# ── 1. Migration backfill ────────────────────────────────────────────────

def test_seed_and_backfill_seeds_default_set_and_preserves_data(db):
    org = _org(db)
    dept = Department(org_id=org.id, name="Strategy")
    db.add(dept)
    db.flush()
    desig = Designation(org_id=org.id, department_id=dept.id, name="Consultant", level=1)
    db.add(desig)
    db.flush()

    exp = RoleExpectation(
        org_id=org.id, department_id=dept.id, designation_id=desig.id,
        exp_task_execution="TE text", exp_ownership="OWN text",
        exp_project_management="PM text", exp_client_deliverables="CD text",
        exp_communication="COMM text", exp_mentoring="MENT text",
        exp_firm_growth="FG text", exp_competency_skills="CS text",
    )
    db.add(exp)

    user = _user(db, org.id)
    project = Project(org_id=org.id, project_code="P-1", name="Proj",
                      status=PROJECT_STATUS_ACTIVE)
    db.add(project)
    db.flush()
    review = ProjectReview(
        org_id=org.id, user_id=user.id, project_id=project.id, cycle="H1 FY26-27",
        status=ProjectReviewStatus.REVIEWED.value, is_deleted=False,
        comment_task_execution="c-TE", comment_ownership="c-OWN",
        comment_project_management="c-PM", comment_client_deliverables="c-CD",
        comment_communication="c-COMM", comment_mentoring="c-MENT",
        comment_competency_skills="c-CS",
    )
    db.add(review)
    db.commit()

    migration._seed_and_backfill(db)
    db.commit()

    # 8 default competencies seeded (dept + level NULL), correct order/flags.
    defaults = (
        db.query(Competency)
        .filter(Competency.department_id.is_(None), Competency.level.is_(None))
        .order_by(Competency.display_order)
        .all()
    )
    assert [c.key for c in defaults] == [k for k, _l, _r in migration._DEFAULT_COMPETENCIES]
    assert [c.display_order for c in defaults] == [1, 2, 3, 4, 5, 6, 7, 8]
    fg = next(c for c in defaults if c.key == "firm_growth")
    assert fg.is_reviewable is False
    assert all(c.is_reviewable for c in defaults if c.key != "firm_growth")

    comp_id = {c.key: c.id for c in defaults}

    # role_expectations.expectations backfilled — all 8, keyed by competency id.
    db.refresh(exp)
    assert exp.expectations == {
        str(comp_id["task_execution"]): "TE text",
        str(comp_id["ownership"]): "OWN text",
        str(comp_id["project_management"]): "PM text",
        str(comp_id["client_deliverables"]): "CD text",
        str(comp_id["communication"]): "COMM text",
        str(comp_id["mentoring"]): "MENT text",
        str(comp_id["firm_growth"]): "FG text",
        str(comp_id["competency_skills"]): "CS text",
    }

    # project_reviews.comments backfilled — 7 reviewable (no firm_growth).
    db.refresh(review)
    assert review.comments == {
        str(comp_id["task_execution"]): "c-TE",
        str(comp_id["ownership"]): "c-OWN",
        str(comp_id["project_management"]): "c-PM",
        str(comp_id["client_deliverables"]): "c-CD",
        str(comp_id["communication"]): "c-COMM",
        str(comp_id["mentoring"]): "c-MENT",
        str(comp_id["competency_skills"]): "c-CS",
    }
    assert str(comp_id["firm_growth"]) not in review.comments


def test_seed_and_backfill_is_per_org(db):
    org_a = _org(db, "A")
    org_b = _org(db, "B")
    migration._seed_and_backfill(db)
    db.commit()
    for org in (org_a, org_b):
        n = db.query(Competency).filter(Competency.org_id == org.id).count()
        assert n == len(migration._DEFAULT_COMPETENCIES)


# ── 2. Resolution helper ──────────────────────────────────────────────────

def test_resolution_falls_back_to_default_when_scope_undefined(db):
    org = _org(db)
    _competency(db, org.id, "task_execution", "TE", 1)
    _competency(db, org.id, "ownership", "OWN", 2)
    db.commit()

    comps, is_default = get_competency_set(db, org.id, department_id=99, level=3)
    assert is_default is True
    assert [c.key for c in comps] == ["task_execution", "ownership"]


def test_resolution_prefers_scoped_set(db):
    org = _org(db)
    # default set
    _competency(db, org.id, "task_execution", "TE", 1)
    # scoped set for (dept 5, level 2)
    _competency(db, org.id, "custom_a", "Custom A", 2, dept_id=5, level=2)
    _competency(db, org.id, "custom_b", "Custom B", 1, dept_id=5, level=2)
    db.commit()

    comps, is_default = get_competency_set(db, org.id, department_id=5, level=2)
    assert is_default is False
    # ordered by display_order
    assert [c.key for c in comps] == ["custom_b", "custom_a"]


def test_resolution_excludes_deleted_and_defaults_when_scope_all_deleted(db):
    org = _org(db)
    _competency(db, org.id, "task_execution", "TE", 1)  # default
    # scoped set exists but every row soft-deleted → fall back to default
    _competency(db, org.id, "custom_a", "Custom A", 1, dept_id=5, level=2, deleted=True)
    db.commit()

    comps, is_default = get_competency_set(db, org.id, department_id=5, level=2)
    assert is_default is True
    assert [c.key for c in comps] == ["task_execution"]


def test_resolution_default_when_level_missing(db):
    org = _org(db)
    _competency(db, org.id, "task_execution", "TE", 1)
    _competency(db, org.id, "custom_a", "Custom A", 1, dept_id=5, level=2)
    db.commit()

    # department but no level → cannot scope → default
    comps, is_default = get_competency_set(db, org.id, department_id=5, level=None)
    assert is_default is True
    assert [c.key for c in comps] == ["task_execution"]


def test_resolution_is_org_scoped(db):
    org_a = _org(db, "A")
    org_b = _org(db, "B")
    _competency(db, org_a.id, "task_execution", "TE", 1)
    db.commit()

    comps, is_default = get_competency_set(db, org_b.id, department_id=None, level=None)
    assert comps == []  # org B has no competencies at all
    assert is_default is True


# ── 3. Endpoint ────────────────────────────────────────────────────────────

def test_endpoint_returns_default_set_flagged(db):
    org = _org(db)
    user = _user(db, org.id)
    _competency(db, org.id, "task_execution", "TE", 1)
    _competency(db, org.id, "firm_growth", "Firm Growth", 2, reviewable=False)
    db.commit()

    resp = get_competencies(db, user, department_id=None, level=None)
    assert resp.is_default is True
    assert [c.key for c in resp.competencies] == ["task_execution", "firm_growth"]
    assert resp.competencies[1].is_reviewable is False


def test_endpoint_returns_scoped_set(db):
    org = _org(db)
    user = _user(db, org.id)
    _competency(db, org.id, "task_execution", "TE", 1)  # default
    _competency(db, org.id, "custom_a", "Custom A", 1, dept_id=7, level=4)
    db.commit()

    resp = get_competencies(db, user, department_id=7, level=4)
    assert resp.is_default is False
    assert [c.key for c in resp.competencies] == ["custom_a"]
