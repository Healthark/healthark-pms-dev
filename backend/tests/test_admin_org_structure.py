"""
Admin Organization tab — department + designation CRUD (soft-delete via
is_active; designation level owned by the Competency Framework tab; no reparent
in v1). Route functions are called directly against in-memory SQLite.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    create_department,
    create_designation,
    deactivate_department,
    deactivate_designation,
    get_org_structure,
    reactivate_department,
    reactivate_designation,
    rename_department,
    rename_designation,
)
from app.core.cache import departments_cache, designations_cache
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.schemas.admin_schemas import (
    DepartmentCreate,
    DepartmentUpdate,
    DesignationCreate,
    DesignationUpdate,
)


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
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


def _user(db, org_id, *, role="Admin", department_id=None, designation_id=None, deleted=False):
    _n["i"] += 1
    u = User(
        org_id=org_id, employee_code=f"E{_n['i']:04d}", full_name=f"U{_n['i']}",
        email=f"u{_n['i']}@x.com", role=role, password_hash="x", is_deleted=deleted,
        department_id=department_id, designation_id=designation_id,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    admin = _user(db, org.id, role="Admin")
    db.commit()
    return org, admin


# ── Departments ──────────────────────────────────────────────────────────

def test_create_department(db):
    org, admin = _scenario(db)
    out = create_department(DepartmentCreate(name="  Accounts  "), db, admin)
    assert out.name == "Accounts"  # trimmed
    row = db.query(Department).filter_by(org_id=org.id, name="Accounts").one()
    assert row.is_active is True


def test_create_department_duplicate_and_inactive_hint(db):
    org, admin = _scenario(db)
    create_department(DepartmentCreate(name="Accounts"), db, admin)
    # Case-insensitive duplicate → 409.
    with pytest.raises(HTTPException) as ei:
        create_department(DepartmentCreate(name="accounts"), db, admin)
    assert ei.value.status_code == 409
    # Deactivate then re-create → 409 that points to reactivation.
    dept = db.query(Department).filter_by(org_id=org.id, name="Accounts").one()
    deactivate_department(dept.id, db, admin)
    with pytest.raises(HTTPException) as ei:
        create_department(DepartmentCreate(name="Accounts"), db, admin)
    assert ei.value.status_code == 409
    assert "reactivate" in ei.value.detail.lower()


def test_blank_name_rejected(db):
    org, admin = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        create_department(DepartmentCreate(name="   "), db, admin)
    assert ei.value.status_code == 422


def test_rename_department(db):
    org, admin = _scenario(db)
    d = create_department(DepartmentCreate(name="Accounts"), db, admin)
    out = rename_department(d.id, DepartmentUpdate(name="Finance"), db, admin)
    assert out.name == "Finance"
    # Renaming onto an existing name collides.
    create_department(DepartmentCreate(name="Sales"), db, admin)
    with pytest.raises(HTTPException) as ei:
        rename_department(d.id, DepartmentUpdate(name="Sales"), db, admin)
    assert ei.value.status_code == 409


def test_deactivate_department_cascades_to_designations(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    r1 = create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    r2 = create_designation(DesignationCreate(name="Senior Executive", department_id=dep.id), db, admin)

    deactivate_department(dep.id, db, admin)

    assert db.get(Department, dep.id).is_active is False
    assert db.get(Designation, r1.id).is_active is False
    assert db.get(Designation, r2.id).is_active is False
    # Org structure still shows them (inactive), so they can be reactivated.
    struct = get_org_structure(db, admin)
    acct = next(d for d in struct.departments if d.id == dep.id)
    assert acct.is_active is False
    assert {r.is_active for r in acct.designations} == {False}


def test_reactivate_department_does_not_restore_roles(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    r1 = create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    deactivate_department(dep.id, db, admin)
    reactivate_department(dep.id, db, admin)
    assert db.get(Department, dep.id).is_active is True
    assert db.get(Designation, r1.id).is_active is False  # NOT auto-restored


# ── Designations ───────────────────────────────────────────────────────────

def test_create_designation_defaults_level_and_scopes_to_department(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    out = create_designation(DesignationCreate(name="Accounts Executive", department_id=dep.id), db, admin)
    assert out.level == 1  # default
    assert out.department_id == dep.id
    row = db.get(Designation, out.id)
    assert row.is_active is True


def test_create_designation_unknown_department_404(db):
    org, admin = _scenario(db)
    with pytest.raises(HTTPException) as ei:
        create_designation(DesignationCreate(name="X", department_id=9999), db, admin)
    assert ei.value.status_code == 404


def test_designation_duplicate_within_department_409(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    with pytest.raises(HTTPException) as ei:
        create_designation(DesignationCreate(name="executive", department_id=dep.id), db, admin)
    assert ei.value.status_code == 409
    # Same name under a DIFFERENT department is allowed.
    other = create_department(DepartmentCreate(name="Sales"), db, admin)
    ok = create_designation(DesignationCreate(name="Executive", department_id=other.id), db, admin)
    assert ok.department_id == other.id


def test_rename_designation(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    d = create_designation(DesignationCreate(name="Exec", department_id=dep.id), db, admin)
    out = rename_designation(d.id, DesignationUpdate(name="Executive"), db, admin)
    assert out.name == "Executive"


def test_deactivate_and_reactivate_designation(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    d = create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    deactivate_designation(d.id, db, admin)
    assert db.get(Designation, d.id).is_active is False
    reactivate_designation(d.id, db, admin)
    assert db.get(Designation, d.id).is_active is True


def test_reactivate_designation_blocked_while_department_inactive(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    d = create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    deactivate_department(dep.id, db, admin)  # cascades the role to inactive
    with pytest.raises(HTTPException) as ei:
        reactivate_designation(d.id, db, admin)
    assert ei.value.status_code == 409
    assert "department" in ei.value.detail.lower()


# ── Read + counts + guards ─────────────────────────────────────────────────

def test_org_structure_shape_and_active_user_counts(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    role = create_designation(DesignationCreate(name="Executive", department_id=dep.id), db, admin)
    # 2 active users + 1 deleted user on the dept/role → count must be 2.
    _user(db, org.id, role="Staff", department_id=dep.id, designation_id=role.id)
    _user(db, org.id, role="Staff", department_id=dep.id, designation_id=role.id)
    _user(db, org.id, role="Staff", department_id=dep.id, designation_id=role.id, deleted=True)
    db.commit()

    struct = get_org_structure(db, admin)
    acct = next(d for d in struct.departments if d.id == dep.id)
    assert acct.active_user_count == 2
    r = next(x for x in acct.designations if x.id == role.id)
    assert r.active_user_count == 2


def test_unscoped_designations_are_surfaced(db):
    org, admin = _scenario(db)
    # A legacy role with no department (predates scoping).
    legacy = Designation(org_id=org.id, department_id=None, name="Legacy Role", level=1, is_active=True)
    db.add(legacy)
    db.commit()
    struct = get_org_structure(db, admin)
    assert any(d.name == "Legacy Role" for d in struct.unscoped_designations)


def test_admin_guard(db):
    org, admin = _scenario(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()
    with pytest.raises(HTTPException) as ei:
        get_org_structure(db, staff)
    assert ei.value.status_code == 403
    with pytest.raises(HTTPException) as ei:
        create_department(DepartmentCreate(name="X"), db, staff)
    assert ei.value.status_code == 403


# ── Level is not client-settable; parent must be active ─────────────────────

def test_create_designation_never_writes_client_level(db):
    # The Competency Framework tab is level's single writer: the create schema
    # must not even expose `level`, and the route hardcodes the default.
    assert "level" not in DesignationCreate.model_fields
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    # A crafted payload carrying a stray `level` is ignored, not honoured.
    payload = DesignationCreate.model_validate(
        {"name": "Exec", "department_id": dep.id, "level": 9}
    )
    out = create_designation(payload, db, admin)
    assert out.level == 1


def test_create_designation_blocked_when_department_inactive(db):
    org, admin = _scenario(db)
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    deactivate_department(dep.id, db, admin)
    with pytest.raises(HTTPException) as ei:
        create_designation(DesignationCreate(name="Exec", department_id=dep.id), db, admin)
    assert ei.value.status_code == 409
    assert "department" in ei.value.detail.lower()


# ── Tenant isolation ────────────────────────────────────────────────────────

def test_cross_org_isolation(db):
    """An admin of org A can neither read nor mutate org B's structure. Guards
    the org_id filters in the lookup helpers + create_designation against a
    regression that would open an IDOR."""
    _org_a, admin_a = _scenario(db)
    org_b = Organization(name="OrgB", enabled_features=[])
    db.add(org_b)
    db.flush()
    b_dept = Department(org_id=org_b.id, name="B-Dept", is_active=True)
    db.add(b_dept)
    db.flush()
    b_role = Designation(
        org_id=org_b.id, department_id=b_dept.id, name="B-Role", level=1, is_active=True
    )
    db.add(b_role)
    db.commit()

    # Every write path against org B's ids is a 404 for org A's admin.
    for call in (
        lambda: rename_department(b_dept.id, DepartmentUpdate(name="Hacked"), db, admin_a),
        lambda: deactivate_department(b_dept.id, db, admin_a),
        lambda: reactivate_department(b_dept.id, db, admin_a),
        lambda: rename_designation(b_role.id, DesignationUpdate(name="Hacked"), db, admin_a),
        lambda: deactivate_designation(b_role.id, db, admin_a),
        lambda: reactivate_designation(b_role.id, db, admin_a),
        # Cannot attach a role to another org's department either.
        lambda: create_designation(DesignationCreate(name="X", department_id=b_dept.id), db, admin_a),
    ):
        with pytest.raises(HTTPException) as ei:
            call()
        assert ei.value.status_code == 404

    # The read surface returns only the caller's org.
    struct = get_org_structure(db, admin_a)
    dept_ids = {d.id for d in struct.departments}
    assert b_dept.id not in dept_ids
    assert all(r.id != b_role.id for d in struct.departments for r in d.designations)
    assert all(r.id != b_role.id for r in struct.unscoped_designations)


# ── Cache invalidation on writes ────────────────────────────────────────────

def test_write_paths_invalidate_reference_caches(db):
    """The departments/designations dropdown endpoints are TTL-cached; every
    structural write must drop the relevant cache so dropdowns don't serve
    stale data for up to the TTL."""
    departments_cache.clear()
    designations_cache.clear()
    org, admin = _scenario(db)

    # Seed a stale departments entry, then a create must evict it.
    departments_cache.get_or_compute(org.id, lambda: ["STALE"])
    assert departments_cache.get_or_compute(org.id, lambda: ["FRESH"]) == ["STALE"]
    dep = create_department(DepartmentCreate(name="Accounts"), db, admin)
    assert departments_cache.get_or_compute(org.id, lambda: ["FRESH"]) == ["FRESH"]

    # Same for the designations cache on a designation write.
    designations_cache.get_or_compute(org.id, lambda: ["STALE"])
    assert designations_cache.get_or_compute(org.id, lambda: ["FRESH"]) == ["STALE"]
    create_designation(DesignationCreate(name="Exec", department_id=dep.id), db, admin)
    assert designations_cache.get_or_compute(org.id, lambda: ["FRESH"]) == ["FRESH"]

    departments_cache.clear()
    designations_cache.clear()
