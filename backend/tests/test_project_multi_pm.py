"""
Multi-PM hierarchy — PR1 (data capture).

A project can split its team into a PM hierarchy: each member carries its own
manager_id (the PM who evaluates them) and an optional per-member
secondary_evaluator_id. The top PM (no manager) is flagged evaluator_type
"Primary" so the existing "the project's PM" display resolvers keep working.

These cover the schema validators (multi-PM only), the create route's
persistence, and the single-PM manager_id backfill that keeps the per-member
link populated in both modes. Routes are plain functions, called directly
against in-memory SQLite (mirrors test_project_secondary_evaluator.py).
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
    create_project,
    update_assignment,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import ProjectAssignment
from app.models.user_models import User
from app.schemas.project_schemas import (
    AssignmentCreate,
    AssignmentUpdate,
    ProjectCreate,
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


def _org_with_users(db, n):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    admin = _user(db, org.id, role="Admin")
    users = [_user(db, org.id) for _ in range(n)]
    db.commit()
    return org, admin, users


def _rows_by_user(db, project_id):
    return {
        a.user_id: a
        for a in db.query(ProjectAssignment).filter_by(project_id=project_id)
    }


# ── Schema validation (multi-PM only) ────────────────────────────────

def _multi(reports_to_id, assignments):
    return ProjectCreate(
        project_code="P1",
        name="P",
        reports_to_id=reports_to_id,
        multi_pm_enabled=True,
        assignments=assignments,
    )


def test_schema_rejects_self_manage():
    with pytest.raises(ValidationError, match="own Project Manager"):
        _multi(999, [
            AssignmentCreate(user_id=1),
            AssignmentCreate(user_id=2, manager_id=2),
        ])


def test_schema_allows_non_member_manager():
    # PR2: a member's PM may be any org user, not just an existing project
    # member (org membership is validated at the route layer instead).
    p = _multi(999, [
        AssignmentCreate(user_id=1),
        AssignmentCreate(user_id=2, manager_id=77),
    ])
    assert p.multi_pm_enabled is True


def test_schema_rejects_cycle():
    # One valid root (user 1) but 2↔3 form a cycle among the non-root members,
    # so the root check passes and cycle detection is what fires.
    with pytest.raises(ValidationError, match="cycle"):
        _multi(999, [
            AssignmentCreate(user_id=1),
            AssignmentCreate(user_id=2, manager_id=3),
            AssignmentCreate(user_id=3, manager_id=2),
        ])


def test_schema_allows_multiple_roots():
    # PR2: several top-level members (each with no PM) are valid — "PM Reports
    # To" reviews every root, e.g. a flat team with no central PM above it.
    p = _multi(999, [
        AssignmentCreate(user_id=1),  # root
        AssignmentCreate(user_id=2),  # also root
    ])
    assert p.multi_pm_enabled is True


def test_schema_allows_reports_to_equals_a_pm():
    # PR2: "PM Reports To" may also be one of the project's PMs (used to chain a
    # member-PM up to a top reviewer). Self-pairs are skipped at routing time,
    # not rejected here.
    p = _multi(1, [  # reports_to == the root (user 1)
        AssignmentCreate(user_id=1),
        AssignmentCreate(user_id=2, manager_id=1),
    ])
    assert p.multi_pm_enabled is True


def test_schema_rejects_own_secondary():
    with pytest.raises(ValidationError, match="own Secondary"):
        _multi(999, [
            AssignmentCreate(user_id=1),
            AssignmentCreate(user_id=2, manager_id=1, secondary_evaluator_id=2),
        ])


def test_schema_accepts_valid_hierarchy():
    p = _multi(999, [
        AssignmentCreate(user_id=1),                                # A (root)
        AssignmentCreate(user_id=2, manager_id=1),                  # B → A
        AssignmentCreate(user_id=3, manager_id=1, secondary_evaluator_id=888),  # C → A
        AssignmentCreate(user_id=4, manager_id=2),                  # X → B
    ])
    assert p.multi_pm_enabled is True


# ── Create route — persistence ───────────────────────────────────────

def test_create_multi_pm_persists_hierarchy(db):
    org, admin, users = _org_with_users(db, 4)
    a, b, c, x = users  # A root; B,C → A; X → B
    reports_to = _user(db, org.id)
    sec = _user(db, org.id)
    db.commit()

    payload = ProjectCreate(
        project_code="MP-1",
        name="Multi",
        reports_to_id=reports_to.id,
        multi_pm_enabled=True,
        assignments=[
            AssignmentCreate(user_id=a.id),
            AssignmentCreate(user_id=b.id, manager_id=a.id),
            AssignmentCreate(user_id=c.id, manager_id=a.id, secondary_evaluator_id=sec.id),
            AssignmentCreate(user_id=x.id, manager_id=b.id),
        ],
    )
    detail = create_project(payload, db, admin, BackgroundTasks())
    assert detail.multi_pm_enabled is True
    # The headline PM resolves to the top PM (root), for display back-compat.
    assert detail.pm_id == a.id

    rows = _rows_by_user(db, detail.id)
    assert rows[a.id].evaluator_type == "Primary"   # root is flagged Primary
    assert rows[a.id].manager_id is None
    assert rows[b.id].evaluator_type is None
    assert rows[b.id].manager_id == a.id
    assert rows[c.id].manager_id == a.id
    assert rows[c.id].secondary_evaluator_id == sec.id
    assert rows[x.id].manager_id == b.id
    # Project-level secondary is unused in multi-PM mode.
    project = detail
    assert project.secondary_evaluator_id is None


def test_create_multi_pm_allows_multiple_top_pms(db):
    # Same-level PMs: several members with no manager are all top-level PMs,
    # each reviewed by "PM Reports To". There is no "exactly one top PM" rule —
    # the create route flags every root Primary and persists them all.
    org, admin, users = _org_with_users(db, 3)
    pm1, pm2, member = users  # pm1 & pm2 are peers (roots); member → pm1
    reports_to = _user(db, org.id)
    db.commit()

    payload = ProjectCreate(
        project_code="MP-2",
        name="Flat",
        reports_to_id=reports_to.id,
        multi_pm_enabled=True,
        assignments=[
            AssignmentCreate(user_id=pm1.id),                 # root / top PM
            AssignmentCreate(user_id=pm2.id),                 # also root / top PM
            AssignmentCreate(user_id=member.id, manager_id=pm1.id),
        ],
    )
    detail = create_project(payload, db, admin, BackgroundTasks())
    assert detail.multi_pm_enabled is True
    # Headline PM resolves to one of the two roots (display back-compat).
    assert detail.pm_id in (pm1.id, pm2.id)

    rows = _rows_by_user(db, detail.id)
    # BOTH roots are flagged Primary and have no manager.
    assert rows[pm1.id].evaluator_type == "Primary"
    assert rows[pm1.id].manager_id is None
    assert rows[pm2.id].evaluator_type == "Primary"
    assert rows[pm2.id].manager_id is None
    # The managed member links to their chosen PM.
    assert rows[member.id].evaluator_type is None
    assert rows[member.id].manager_id == pm1.id


# ── Single-PM regression — manager_id backfilled to the Primary ──────

def test_create_single_pm_links_members_to_primary(db):
    org, admin, users = _org_with_users(db, 2)
    pm, member = users
    reports_to = _user(db, org.id)
    db.commit()

    payload = ProjectCreate(
        project_code="SP-1",
        name="Single",
        reports_to_id=reports_to.id,
        assignments=[
            AssignmentCreate(user_id=pm.id, evaluator_type="Primary"),
            AssignmentCreate(user_id=member.id),
        ],
    )
    detail = create_project(payload, db, admin, BackgroundTasks())
    assert detail.multi_pm_enabled is False

    rows = _rows_by_user(db, detail.id)
    assert rows[pm.id].evaluator_type == "Primary"
    assert rows[pm.id].manager_id is None
    # The member is linked to the single PM so the per-member link exists in
    # both modes (keeps the future unified queue simple).
    assert rows[member.id].manager_id == pm.id


# ── Add / Update routes — multi-PM allows many Primaries ─────────────
# Regression for: "assigning a Secondary Evaluator fails with 'This project
# already has a Primary evaluator.'" The single-Primary guard on the add /
# update assignment routes must NOT fire in multi-PM mode, where every
# top-level PM is legitimately flagged Primary.

def _make_multi_pm_project(db, org, admin, assignments, *, code="MP-X"):
    reports_to = _user(db, org.id)
    db.commit()
    return create_project(
        ProjectCreate(
            project_code=code,
            name="Multi",
            reports_to_id=reports_to.id,
            multi_pm_enabled=True,
            assignments=assignments,
        ),
        db,
        admin,
        BackgroundTasks(),
    )


def test_update_top_pm_secondary_in_multi_pm_allowed(db):
    # Repro of the reported bug: a multi-PM project with two top PMs. Editing
    # one top PM to add a per-member Secondary Evaluator re-sends
    # evaluator_type="Primary" (that's what the modal does for every top-PM
    # edit). This must succeed despite the OTHER top PM also being Primary.
    org, admin, users = _org_with_users(db, 3)
    pm1, pm2, member = users
    sec = _user(db, org.id)
    detail = _make_multi_pm_project(
        db, org, admin,
        [
            AssignmentCreate(user_id=pm1.id),                    # top PM
            AssignmentCreate(user_id=pm2.id),                    # another top PM
            AssignmentCreate(user_id=member.id, manager_id=pm1.id),
        ],
        code="MP-SEC",
    )

    pm1_row = _rows_by_user(db, detail.id)[pm1.id]
    update_assignment(
        pm1_row.id,
        AssignmentUpdate(evaluator_type="Primary", secondary_evaluator_id=sec.id),
        db,
        admin,
    )

    rows = _rows_by_user(db, detail.id)
    assert rows[pm1.id].secondary_evaluator_id == sec.id
    assert rows[pm1.id].evaluator_type == "Primary"
    # The other top PM is untouched and still Primary.
    assert rows[pm2.id].evaluator_type == "Primary"


def test_add_second_top_pm_in_multi_pm_allowed(db):
    # A multi-PM project may gain additional top-level PMs after creation.
    org, admin, users = _org_with_users(db, 2)
    pm1, member = users
    new_pm = _user(db, org.id)
    detail = _make_multi_pm_project(
        db, org, admin,
        [
            AssignmentCreate(user_id=pm1.id),
            AssignmentCreate(user_id=member.id, manager_id=pm1.id),
        ],
        code="MP-ADD",
    )

    add_assignment(
        detail.id,
        AssignmentCreate(user_id=new_pm.id, evaluator_type="Primary"),
        db,
        admin,
        BackgroundTasks(),
    )

    rows = _rows_by_user(db, detail.id)
    assert rows[new_pm.id].evaluator_type == "Primary"
    assert rows[new_pm.id].manager_id is None


# ── Single-PM regression — the single-Primary guard still holds ──────

def _make_single_pm_project(db, org, admin, pm, member, *, code="SP-X"):
    reports_to = _user(db, org.id)
    db.commit()
    return create_project(
        ProjectCreate(
            project_code=code,
            name="Single",
            reports_to_id=reports_to.id,
            assignments=[
                AssignmentCreate(user_id=pm.id, evaluator_type="Primary"),
                AssignmentCreate(user_id=member.id),
            ],
        ),
        db,
        admin,
        BackgroundTasks(),
    )


def test_add_second_primary_blocked_in_single_pm(db):
    org, admin, users = _org_with_users(db, 2)
    pm, member = users
    extra = _user(db, org.id)
    detail = _make_single_pm_project(db, org, admin, pm, member, code="SP-ADD")

    with pytest.raises(HTTPException) as exc:
        add_assignment(
            detail.id,
            AssignmentCreate(user_id=extra.id, evaluator_type="Primary"),
            db,
            admin,
            BackgroundTasks(),
        )
    assert "already has a Primary evaluator" in exc.value.detail


def test_promote_second_primary_blocked_in_single_pm(db):
    org, admin, users = _org_with_users(db, 2)
    pm, member = users
    detail = _make_single_pm_project(db, org, admin, pm, member, code="SP-UP")

    member_row = _rows_by_user(db, detail.id)[member.id]
    with pytest.raises(HTTPException) as exc:
        update_assignment(
            member_row.id,
            AssignmentUpdate(evaluator_type="Primary"),
            db,
            admin,
        )
    assert "already has a Primary evaluator" in exc.value.detail
