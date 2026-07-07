"""
Admin competency-framework editor — CRUD over the department/level framework
+ the role→level mapping. Plain functions called directly against SQLite.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_competency_routes import (
    add_level,
    bulk_save_framework,
    create_competency,
    delete_competency,
    get_framework,
    set_designation_level,
    update_cell,
    update_competency,
)
from app.core.database import Base
from app.models.competency_models import Competency
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.schemas.admin_schemas import (
    DesignationLevelUpdate,
    FrameworkBulkCell,
    FrameworkBulkCompetency,
    FrameworkBulkDesignation,
    FrameworkBulkSave,
    FrameworkCellUpdate,
    FrameworkCompetencyCreate,
    FrameworkCompetencyUpdate,
    FrameworkLevelAdd,
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


def _user(db, org_id, *, role):
    _n["i"] += 1
    u = User(
        org_id=org_id, employee_code=f"E{_n['i']:04d}", full_name=f"U{_n['i']}",
        email=f"u{_n['i']}@x.com", role=role, password_hash="x", is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db):
    """Org + admin + IDT dept with two designations at levels 2 and 3."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    admin = _user(db, org.id, role="Admin")
    dept = Department(org_id=org.id, name="IDT", is_active=True)
    db.add(dept)
    db.flush()
    db.add(Designation(org_id=org.id, department_id=dept.id, name="Analyst", level=2, is_active=True))
    db.add(Designation(org_id=org.id, department_id=dept.id, name="Senior", level=3, is_active=True))
    db.commit()
    return org, admin, dept


def test_create_competency_spans_department_levels(db):
    org, admin, dept = _scenario(db)
    fw = create_competency(
        FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"),
        db, admin,
    )
    assert fw.is_default is False
    assert fw.levels == [2, 3]  # from the two designations
    assert len(fw.competencies) == 1
    comp = fw.competencies[0]
    assert comp.key == "task_execution"
    assert set(comp.cells.keys()) == {"2", "3"}  # a cell per level
    assert comp.is_reviewable is True


def test_update_cell_sets_only_that_level(db):
    org, admin, dept = _scenario(db)
    fw = create_competency(
        FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin
    )
    cell_l2 = fw.competencies[0].cells["2"].competency_id
    fw2 = update_cell(cell_l2, FrameworkCellUpdate(expectation="L2 text"), db, admin)
    comp = fw2.competencies[0]
    assert comp.cells["2"].expectation == "L2 text"
    assert comp.cells["3"].expectation is None  # untouched


def test_update_competency_applies_across_levels(db):
    org, admin, dept = _scenario(db)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin)
    fw = update_competency(
        FrameworkCompetencyUpdate(
            department_id=dept.id, key="task_execution", label="Renamed", is_reviewable=False
        ),
        db, admin,
    )
    comp = fw.competencies[0]
    assert comp.label == "Renamed"
    assert comp.is_reviewable is False
    # both level rows updated
    rows = db.query(Competency).filter_by(org_id=org.id, key="task_execution").all()
    assert all(r.label == "Renamed" and r.is_reviewable is False for r in rows)


def test_add_level_creates_cells_for_existing_competencies(db):
    org, admin, dept = _scenario(db)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin)
    fw = add_level(FrameworkLevelAdd(department_id=dept.id, level=4), db, admin)
    assert 4 in fw.levels
    assert "4" in fw.competencies[0].cells


def test_delete_competency_is_soft(db):
    org, admin, dept = _scenario(db)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin)
    fw = delete_competency(db, admin, key="task_execution", department_id=dept.id)
    assert fw.competencies == []  # gone from the editor
    # but the rows still exist (soft-deleted) so historical reviews resolve
    rows = db.query(Competency).filter_by(org_id=org.id, key="task_execution").all()
    assert len(rows) == 2
    assert all(r.is_deleted for r in rows)


def test_default_set_single_cell(db):
    org, admin, dept = _scenario(db)
    fw = create_competency(FrameworkCompetencyCreate(department_id=None, label="Ownership"), db, admin)
    assert fw.is_default is True
    assert fw.levels == []
    comp = fw.competencies[0]
    assert list(comp.cells.keys()) == ["default"]


def test_set_designation_level(db):
    org, admin, dept = _scenario(db)
    desig = db.query(Designation).filter_by(org_id=org.id, name="Analyst").one()
    result = set_designation_level(desig.id, DesignationLevelUpdate(level=5), db, admin)
    assert result.level == 5
    db.refresh(desig)
    assert desig.level == 5


def test_unique_key_avoids_soft_deleted_collision(db):
    org, admin, dept = _scenario(db)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin)
    delete_competency(db, admin, key="task_execution", department_id=dept.id)
    # Re-adding the same label must NOT reuse the soft-deleted key.
    fw = create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin)
    assert fw.competencies[0].key == "task_execution_2"


def test_new_competency_appends_without_order_collision(db):
    """After a soft-delete frees an order, a new competency still gets a
    distinct order (max+1), not a colliding one."""
    org, admin, dept = _scenario(db)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="A"), db, admin)
    create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="B"), db, admin)
    delete_competency(db, admin, key="a", department_id=dept.id)
    fw = create_competency(FrameworkCompetencyCreate(department_id=dept.id, label="C"), db, admin)
    orders = {c.key: c.display_order for c in fw.competencies}
    assert orders["b"] != orders["c"]
    assert orders["c"] > orders["b"]


def test_admin_guard(db):
    org, admin, dept = _scenario(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()
    with pytest.raises(HTTPException) as ei:
        get_framework(db, staff, department_id=dept.id)
    assert ei.value.status_code == 403
    with pytest.raises(HTTPException) as ei:
        create_competency(
            FrameworkCompetencyCreate(department_id=dept.id, label="X"), db, staff
        )
    assert ei.value.status_code == 403


# ── Bulk save (the Save-button endpoint) ─────────────────────────────────

def test_bulk_create_update_delete_and_designations(db):
    org, admin, dept = _scenario(db)  # levels 2, 3 from designations
    create_competency(
        FrameworkCompetencyCreate(department_id=dept.id, label="Task Execution"), db, admin
    )
    create_competency(
        FrameworkCompetencyCreate(department_id=dept.id, label="Ownership"), db, admin
    )
    before = get_framework(db, admin, department_id=dept.id)
    analyst = next(d for d in before.designations if d.name == "Analyst")  # L2

    out = bulk_save_framework(
        FrameworkBulkSave(
            department_id=dept.id,
            competencies=[
                # update: rename, retoggle, set the L2 cell
                FrameworkBulkCompetency(
                    key="task_execution", label="Task Exec (renamed)",
                    is_reviewable=False, display_order=1,
                    cells=[
                        FrameworkBulkCell(level=2, expectation="L2 text"),
                        FrameworkBulkCell(level=3, expectation=None),
                    ],
                ),
                # soft-delete
                FrameworkBulkCompetency(
                    key="ownership", label="Ownership", is_reviewable=True,
                    display_order=2, is_deleted=True,
                    cells=[FrameworkBulkCell(level=2), FrameworkBulkCell(level=3)],
                ),
                # create
                FrameworkBulkCompetency(
                    key=None, label="Communication", is_reviewable=True, display_order=3,
                    cells=[
                        FrameworkBulkCell(level=2, expectation="comm L2"),
                        FrameworkBulkCell(level=3, expectation="comm L3"),
                    ],
                ),
            ],
            designations=[FrameworkBulkDesignation(id=analyst.id, level=4)],
        ),
        db, admin,
    )

    keys = {c.key for c in out.competencies}
    assert "communication" in keys
    assert "ownership" not in keys  # soft-deleted, dropped from the live set

    te = next(c for c in out.competencies if c.key == "task_execution")
    assert te.label == "Task Exec (renamed)"
    assert te.is_reviewable is False
    assert te.cells["2"].expectation == "L2 text"

    comm = next(c for c in out.competencies if c.key == "communication")
    assert comm.cells["2"].expectation == "comm L2"
    assert comm.cells["3"].expectation == "comm L3"

    # Analyst re-leveled to 4 → the column set now includes it.
    assert 4 in out.levels
    assert next(d for d in out.designations if d.id == analyst.id).level == 4


def test_bulk_new_competencies_get_unique_keys(db):
    org, admin, dept = _scenario(db)
    out = bulk_save_framework(
        FrameworkBulkSave(
            department_id=dept.id,
            competencies=[
                FrameworkBulkCompetency(
                    key=None, label="Skills", is_reviewable=True, display_order=1,
                    cells=[FrameworkBulkCell(level=2), FrameworkBulkCell(level=3)],
                ),
                FrameworkBulkCompetency(
                    key=None, label="Skills", is_reviewable=True, display_order=2,
                    cells=[FrameworkBulkCell(level=2), FrameworkBulkCell(level=3)],
                ),
            ],
        ),
        db, admin,
    )
    assert sorted(c.key for c in out.competencies) == ["skills", "skills_2"]


def test_bulk_leaves_absent_competency_untouched(db):
    """A competency absent from the payload is NOT deleted — deletion is
    explicit only, so a partial payload can't wipe data."""
    org, admin, dept = _scenario(db)
    create_competency(
        FrameworkCompetencyCreate(department_id=dept.id, label="Keep Me"), db, admin
    )
    out = bulk_save_framework(
        FrameworkBulkSave(department_id=dept.id, competencies=[]), db, admin
    )
    assert any(c.key == "keep_me" for c in out.competencies)


def test_bulk_default_set_single_cell(db):
    org, admin, dept = _scenario(db)
    out = bulk_save_framework(
        FrameworkBulkSave(
            department_id=None,
            competencies=[
                FrameworkBulkCompetency(
                    key=None, label="Task Execution", is_reviewable=True, display_order=1,
                    cells=[FrameworkBulkCell(level=None, expectation="default text")],
                ),
            ],
        ),
        db, admin,
    )
    assert out.is_default is True
    comp = out.competencies[0]
    assert set(comp.cells.keys()) == {"default"}
    assert comp.cells["default"].expectation == "default text"


def test_bulk_admin_guard(db):
    org, admin, dept = _scenario(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()
    with pytest.raises(HTTPException) as ei:
        bulk_save_framework(
            FrameworkBulkSave(department_id=dept.id, competencies=[]), db, staff
        )
    assert ei.value.status_code == 403
