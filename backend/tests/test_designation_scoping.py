"""
Tests for app.services.designation_scoping — the logic shared by the
department-scoped-roles migration and the seeds.

Exercised against an in-memory SQLite session: build the OLD shape (global
designations with department_id NULL, shared across departments via users +
role_expectations), run the scoping, and assert each role split into one
per-department row with everything repointed.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.models.user_models import User
from app.services.designation_scoping import (
    scope_designations_for_org,
    unscope_designations_for_org,
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


def _org(db):
    o = Organization(name="Org", enabled_features=[])
    db.add(o)
    db.flush()
    return o


def _dept(db, org, name):
    d = Department(org_id=org.id, name=name)
    db.add(d)
    db.flush()
    return d


def _desig(db, org, name, *, level=1, department_id=None):
    d = Designation(org_id=org.id, name=name, level=level, department_id=department_id)
    db.add(d)
    db.flush()
    return d


def _user(db, org, dept, desig):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org.id,
        employee_code=f"E{i:04d}",
        full_name=f"U{i}",
        email=f"u{i}@x.com",
        role="Staff",
        password_hash="x",
        department_id=dept.id if dept else None,
        designation_id=desig.id if desig else None,
    )
    db.add(u)
    db.flush()
    return u


def _get(db, desig_id):
    return db.query(Designation).filter(Designation.id == desig_id).first()


def test_shared_role_splits_per_department(db):
    org = _org(db)
    strategy = _dept(db, org, "Strategy")
    rwe = _dept(db, org, "RWE")
    consultant = _desig(db, org, "Consultant", level=2)  # global, shared
    u1 = _user(db, org, strategy, consultant)
    u2 = _user(db, org, rwe, consultant)
    db.commit()

    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    db.expire_all()

    rows = db.query(Designation).filter(Designation.name == "Consultant").all()
    assert {d.department_id for d in rows} == {strategy.id, rwe.id}  # split + global gone
    assert all(d.level == 2 for d in rows)  # level carried over
    db.refresh(u1)
    db.refresh(u2)
    assert _get(db, u1.designation_id).department_id == strategy.id
    assert _get(db, u2.designation_id).department_id == rwe.id


def test_role_expectation_repointed(db):
    org = _org(db)
    idt = _dept(db, org, "IDT")
    eng = _desig(db, org, "Engineer", level=2)
    re = RoleExpectation(
        org_id=org.id,
        department_id=idt.id,
        designation_id=eng.id,
        exp_task_execution="x",
    )
    db.add(re)
    db.commit()

    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    db.expire_all()

    db.refresh(re)
    scoped = _get(db, re.designation_id)
    assert scoped.department_id == idt.id
    assert scoped.name == "Engineer"


def test_user_without_department_kept_as_legacy(db):
    org = _org(db)
    strategy = _dept(db, org, "Strategy")
    consultant = _desig(db, org, "Consultant")
    u_scoped = _user(db, org, strategy, consultant)
    u_nodept = _user(db, org, None, consultant)
    db.commit()

    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    db.expire_all()

    db.refresh(u_scoped)
    db.refresh(u_nodept)
    # Scoped user moved to Strategy's row; the no-department user stays on the
    # original global row (preserved, not deleted).
    assert _get(db, u_scoped.designation_id).department_id == strategy.id
    assert _get(db, u_nodept.designation_id).department_id is None


def test_scope_is_idempotent(db):
    org = _org(db)
    strategy = _dept(db, org, "Strategy")
    consultant = _desig(db, org, "Consultant")
    _user(db, org, strategy, consultant)
    db.commit()

    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    first = db.query(Designation).count()
    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    assert db.query(Designation).count() == first  # re-run is a no-op


def test_unscope_collapses_back(db):
    org = _org(db)
    strategy = _dept(db, org, "Strategy")
    rwe = _dept(db, org, "RWE")
    consultant = _desig(db, org, "Consultant")
    u1 = _user(db, org, strategy, consultant)
    u2 = _user(db, org, rwe, consultant)
    db.commit()
    scope_designations_for_org(db.connection(), org.id)
    db.commit()
    db.expire_all()
    assert db.query(Designation).filter(Designation.name == "Consultant").count() == 2

    unscope_designations_for_org(db.connection(), org.id)
    db.commit()
    db.expire_all()

    rows = db.query(Designation).filter(Designation.name == "Consultant").all()
    assert len(rows) == 1
    assert rows[0].department_id is None
    db.refresh(u1)
    db.refresh(u2)
    assert u1.designation_id == rows[0].id
    assert u2.designation_id == rows[0].id
