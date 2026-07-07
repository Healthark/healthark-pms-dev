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
from app.api.routes.project_review_routes import get_competencies, get_role_expectations
from app.api.routes.user_routes import get_my_role_expectations
from app.core.database import Base
from app.models.competency_models import Competency
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.models.user_models import User
from app.services.competency_service import (
    get_competency_set,
    seed_competency_framework,
)

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
                reviewable=True, deleted=False, expectation=None):
    c = Competency(
        org_id=org_id,
        department_id=dept_id,
        level=level,
        key=key,
        label=label,
        display_order=order,
        is_reviewable=reviewable,
        is_deleted=deleted,
        expectation=expectation,
    )
    db.add(c)
    db.flush()
    return c


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


# ── role-expectations endpoint is sourced from the competency framework ────

def test_role_expectations_sourced_from_framework(db):
    """Expectation text now lives on the framework (dept + level), not the
    legacy RoleExpectation table. The endpoint resolves the framework per
    designation and projects it onto the fixed exp_* shape + id-map."""
    org = _org(db)
    user = _user(db, org.id)
    dept = Department(org_id=org.id, name="Strategy")
    db.add(dept)
    db.flush()
    desig = Designation(org_id=org.id, department_id=dept.id, name="Consultant", level=2)
    db.add(desig)
    db.flush()
    # Framework for (Strategy, level 2) — the source of truth for this role.
    te = _competency(db, org.id, "task_execution", "Task Execution", 1,
                     dept_id=dept.id, level=2, expectation="TE text")
    own = _competency(db, org.id, "ownership", "Ownership", 2,
                      dept_id=dept.id, level=2, expectation=None)
    db.commit()

    results = get_role_expectations(db, user)
    assert len(results) == 1  # one designation → one row
    row = results[0]
    assert row.department_name == "Strategy"
    assert row.designation_name == "Consultant"
    # exp_* fields projected from the framework by canonical key.
    assert row.exp_task_execution == "TE text"
    assert row.exp_ownership is None
    # id-map mirrors the framework (competency id -> expectation), matching the
    # eval form / expectations panel which resolve by id.
    assert row.expectations == {str(te.id): "TE text", str(own.id): None}


def test_role_expectations_falls_back_to_default_for_unmapped_level(db):
    """A designation whose (department, level) has no framework resolves the
    org DEFAULT set — so the panel shows the default ("Not defined") text
    rather than nothing."""
    org = _org(db)
    user = _user(db, org.id)
    dept = Department(org_id=org.id, name="Marketing")
    db.add(dept)
    db.flush()
    # Designation level 5 has no scoped framework; only a default set exists.
    desig = Designation(org_id=org.id, department_id=dept.id, name="Lead", level=5)
    db.add(desig)
    db.flush()
    _competency(db, org.id, "task_execution", "Task Execution", 1,
                expectation="Not defined")
    db.commit()

    results = get_role_expectations(db, user)
    assert len(results) == 1
    assert results[0].exp_task_execution == "Not defined"


def test_my_expectations_sourced_from_framework(db):
    """/me/expectations resolves the current user's (department, level)
    framework and projects it onto the fixed exp_* fields; unset competencies
    fall back to the non-null sentinel the schema requires."""
    org = _org(db)
    dept = Department(org_id=org.id, name="IDT")
    db.add(dept)
    db.flush()
    desig = Designation(org_id=org.id, department_id=dept.id, name="Analyst", level=3)
    db.add(desig)
    db.flush()
    user = _user(db, org.id)
    user.department_id = dept.id
    user.designation_id = desig.id
    db.flush()
    te = _competency(db, org.id, "task_execution", "Task Execution", 1,
                     dept_id=dept.id, level=3, expectation="Do the task well")
    db.commit()

    resp = get_my_role_expectations(db, user)
    assert resp.department_name == "IDT"
    assert resp.designation_name == "Analyst"
    assert resp.exp_task_execution == "Do the task well"
    # Competencies with no expectation text (and keys absent from the framework)
    # fall back to the sentinel — the response schema is non-null.
    assert resp.exp_ownership == "Role expectation not defined"
    # id-map carries the framework competency ids.
    assert resp.expectations == {str(te.id): "Do the task well"}


# ── PR 6b: seed the department/level competency framework ──────────────────

def _seed_depts(db, org):
    for name in ("IDT", "Strategy", "RWE", "Marketing"):
        db.add(Department(org_id=org.id, name=name))
    db.flush()


def test_seed_framework_default_set_and_per_department(db):
    org = _org(db)
    _seed_depts(db, org)
    db.commit()

    seed_competency_framework(db, org.id)
    db.commit()

    # Org DEFAULT set: 8 competencies, dept/level NULL, "Not defined".
    defaults = (
        db.query(Competency)
        .filter(Competency.department_id.is_(None), Competency.level.is_(None))
        .all()
    )
    assert len(defaults) == 8
    assert all(c.expectation == "Not defined" for c in defaults)
    fg = next(c for c in defaults if c.key == "firm_growth")
    assert fg.is_reviewable is False

    # IDT: 7 levels, 8 competencies each, real expectation text.
    idt = db.query(Department).filter_by(org_id=org.id, name="IDT").one()
    idt_comps = db.query(Competency).filter_by(org_id=org.id, department_id=idt.id).all()
    assert {c.level for c in idt_comps} == {1, 2, 3, 4, 5, 6, 7}
    assert len(idt_comps) == 7 * 8
    l3_te = next(
        c for c in idt_comps
        if c.level == 3 and c.key == "task_execution"
    )
    assert l3_te.expectation and l3_te.expectation != "Not defined"

    # RWE + Strategy: 3 levels each.
    for name in ("RWE", "Strategy"):
        d = db.query(Department).filter_by(org_id=org.id, name=name).one()
        comps = db.query(Competency).filter_by(org_id=org.id, department_id=d.id).all()
        assert {c.level for c in comps} == {1, 2, 3}
        assert len(comps) == 3 * 8


def test_seed_framework_resolution_and_fallback(db):
    org = _org(db)
    _seed_depts(db, org)
    db.commit()
    seed_competency_framework(db, org.id)
    db.commit()

    idt = db.query(Department).filter_by(org_id=org.id, name="IDT").one()
    mkt = db.query(Department).filter_by(org_id=org.id, name="Marketing").one()

    # IDT level 3 → its own set, with expectation text.
    comps, is_default = get_competency_set(db, org.id, idt.id, level=3)
    assert is_default is False
    assert len(comps) == 8
    assert all(c.expectation for c in comps)

    # Marketing (no framework) → org default set, "Not defined".
    comps, is_default = get_competency_set(db, org.id, mkt.id, level=1)
    assert is_default is True
    assert all(c.expectation == "Not defined" for c in comps)


def test_seed_framework_is_idempotent(db):
    org = _org(db)
    _seed_depts(db, org)
    db.commit()
    seed_competency_framework(db, org.id)
    db.commit()
    n1 = db.query(Competency).filter_by(org_id=org.id).count()
    seed_competency_framework(db, org.id)
    db.commit()
    n2 = db.query(Competency).filter_by(org_id=org.id).count()
    assert n1 == n2 == 8 + 7 * 8 + 3 * 8 + 3 * 8  # default + IDT + RWE + Strategy


def test_seed_matches_verbosely_named_departments(db):
    """The framework keys are short (IDT/RWE/Strategy) but real departments are
    often named more verbosely. The seed must still match them by the embedded
    abbreviation/word, and must NOT seed unrelated departments."""
    org = _org(db)
    idt = Department(org_id=org.id, name="Information Data Technology (IDT)")
    rwe = Department(org_id=org.id, name="Real-World Evidence (RWE)")
    strat = Department(org_id=org.id, name="Strategy Consulting")
    other = Department(org_id=org.id, name="Accounts")
    db.add_all([idt, rwe, strat, other])
    db.commit()

    seed_competency_framework(db, org.id)
    db.commit()

    # IDT framework (7 levels) landed on the verbosely-named IDT department,
    # with real expectation text.
    idt_comps = db.query(Competency).filter_by(org_id=org.id, department_id=idt.id).all()
    assert {c.level for c in idt_comps} == {1, 2, 3, 4, 5, 6, 7}
    l1_te = next(c for c in idt_comps if c.level == 1 and c.key == "task_execution")
    assert l1_te.expectation and l1_te.expectation != "Not defined"

    # RWE + Strategy matched too (3 levels each).
    for dept in (rwe, strat):
        levels = {
            c.level
            for c in db.query(Competency).filter_by(
                org_id=org.id, department_id=dept.id
            )
        }
        assert levels == {1, 2, 3}

    # An unrelated department gets no scoped framework.
    assert (
        db.query(Competency)
        .filter_by(org_id=org.id, department_id=other.id)
        .count()
        == 0
    )


def test_seed_backfills_blank_expectation_but_preserves_edits(db):
    """A dept competency row left blank (e.g. added via the admin UI before the
    framework was seeded) gets its expectation backfilled from the framework;
    text an admin already entered is never overwritten."""
    org = _org(db)
    idt = Department(org_id=org.id, name="Information Data Technology (IDT)")
    db.add(idt)
    db.flush()
    # A blank row (like a manual UI add whose key collided with a canonical one)
    # and an admin-edited row, both at IDT level 1.
    blank = _competency(db, org.id, "task_execution", "Task Execution", 1,
                        dept_id=idt.id, level=1, expectation=None)
    edited = _competency(db, org.id, "ownership", "Ownership", 2,
                         dept_id=idt.id, level=1, expectation="ADMIN EDIT")
    db.commit()

    seed_competency_framework(db, org.id)
    db.commit()

    db.refresh(blank)
    db.refresh(edited)
    assert blank.expectation and blank.expectation.strip()   # backfilled
    assert edited.expectation == "ADMIN EDIT"                # preserved
