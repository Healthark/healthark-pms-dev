"""
Route-level tests for the paginated GET /projects/ + /projects/filter-options.

Same harness as test_project_soft_delete.py: call the route functions directly
against an in-memory SQLite session. We assert the Page envelope, server-side
filtering/sorting/slicing, the filter-options distinctness, the admin gate, and
— critically — that soft-deleted assignments are excluded from member counts
and PM resolution (the reconciliation with PR #35).
"""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_routes import (
    list_projects,
    projects_filter_options,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import (
    PROJECT_STATUS_ACTIVE,
    PROJECT_STATUS_COMPLETED,
    Project,
    ProjectAssignment,
)
from app.models.user_models import User
from app.schemas.pagination import PaginationParams


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


def _user(db, org_id, *, role="Staff", name=None):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=name or f"User {i}",
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


def _project(
    db,
    org,
    *,
    code=None,
    name="Proj",
    status=PROJECT_STATUS_ACTIVE,
    start_date=None,
    reports_to_id=None,
):
    _n["i"] += 1
    p = Project(
        org_id=org.id,
        project_code=code or f"P-{_n['i']:04d}",
        name=name,
        status=status,
        start_date=start_date,
        reports_to_id=reports_to_id,
    )
    db.add(p)
    db.flush()
    return p


def _assign(db, org, project, user, *, evaluator_type=None, is_deleted=False):
    a = ProjectAssignment(
        org_id=org.id,
        project_id=project.id,
        user_id=user.id,
        evaluator_type=evaluator_type,
        is_deleted=is_deleted,
    )
    db.add(a)
    db.flush()
    return a


def _list(db, admin, *, page=1, per_page=25, search=None, status=None,
          year=None, pm=None, sort_by=None, sort_dir="asc"):
    """Thin wrapper so tests don't repeat the long positional signature."""
    return list_projects(
        db,
        admin,
        PaginationParams(page=page, per_page=per_page),
        search=search,
        status_filter=status,
        year=year,
        pm=pm,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


# ── Envelope + slicing ───────────────────────────────────────────────


def test_returns_page_envelope(db):
    org, admin = _setup(db)
    for _ in range(3):
        _project(db, org)
    db.commit()

    res = _list(db, admin, page=1, per_page=2)
    assert res.total == 3
    assert res.page == 1
    assert res.per_page == 2
    assert len(res.items) == 2


def test_pages_do_not_overlap(db):
    org, admin = _setup(db)
    for _ in range(5):
        _project(db, org)
    db.commit()

    p1 = _list(db, admin, page=1, per_page=2)
    p2 = _list(db, admin, page=2, per_page=2)
    p3 = _list(db, admin, page=3, per_page=2)
    ids = [i.id for i in p1.items + p2.items + p3.items]
    assert len(ids) == 5
    assert len(set(ids)) == 5  # no duplicates across pages


# ── Filters ──────────────────────────────────────────────────────────


def test_search_matches_name_or_code(db):
    org, admin = _setup(db)
    _project(db, org, code="ALPHA-1", name="Alpha")
    _project(db, org, code="BETA-1", name="Beta")
    db.commit()

    by_name = _list(db, admin, search="alph")
    assert {p.name for p in by_name.items} == {"Alpha"}
    by_code = _list(db, admin, search="beta-1")
    assert {p.name for p in by_code.items} == {"Beta"}


def test_status_filter(db):
    org, admin = _setup(db)
    _project(db, org, status=PROJECT_STATUS_ACTIVE)
    _project(db, org, status=PROJECT_STATUS_COMPLETED)
    db.commit()

    active = _list(db, admin, status=PROJECT_STATUS_ACTIVE)
    assert active.total == 1 and active.items[0].status == PROJECT_STATUS_ACTIVE
    completed = _list(db, admin, status=PROJECT_STATUS_COMPLETED)
    assert completed.total == 1
    # status="all" (or None) → both
    assert _list(db, admin, status="all").total == 2


def test_year_filter_uses_start_date_range(db):
    org, admin = _setup(db)
    _project(db, org, start_date=date(2025, 6, 1))
    _project(db, org, start_date=date(2026, 1, 15))
    db.commit()

    res = _list(db, admin, year=2026)
    assert res.total == 1
    assert res.items[0].start_date == date(2026, 1, 15)


def test_pm_filter(db):
    org, admin = _setup(db)
    pm_a = _user(db, org.id, name="PM Alice")
    pm_b = _user(db, org.id, name="PM Bob")
    proj_a = _project(db, org)
    proj_b = _project(db, org)
    _assign(db, org, proj_a, pm_a, evaluator_type="Primary")
    _assign(db, org, proj_b, pm_b, evaluator_type="Primary")
    db.commit()

    res = _list(db, admin, pm="PM Alice")
    assert res.total == 1
    assert res.items[0].id == proj_a.id
    assert res.items[0].pm_name == "PM Alice"


# ── Sorting ──────────────────────────────────────────────────────────


def test_sort_by_name(db):
    org, admin = _setup(db)
    _project(db, org, name="Charlie")
    _project(db, org, name="Alpha")
    _project(db, org, name="Bravo")
    db.commit()

    asc = _list(db, admin, sort_by="name", sort_dir="asc")
    assert [p.name for p in asc.items] == ["Alpha", "Bravo", "Charlie"]
    desc = _list(db, admin, sort_by="name", sort_dir="desc")
    assert [p.name for p in desc.items] == ["Charlie", "Bravo", "Alpha"]


def test_sort_by_member_count_join_dependent(db):
    org, admin = _setup(db)
    few = _project(db, org, name="Few")
    many = _project(db, org, name="Many")
    _assign(db, org, few, _user(db, org.id))
    for _ in range(3):
        _assign(db, org, many, _user(db, org.id))
    db.commit()

    desc = _list(db, admin, sort_by="member_count", sort_dir="desc")
    assert [p.name for p in desc.items] == ["Many", "Few"]
    assert desc.items[0].member_count == 3


def test_sort_by_pm_name_join_dependent(db):
    org, admin = _setup(db)
    p1 = _project(db, org, name="P1")
    p2 = _project(db, org, name="P2")
    _assign(db, org, p1, _user(db, org.id, name="Zara"), evaluator_type="Primary")
    _assign(db, org, p2, _user(db, org.id, name="Anna"), evaluator_type="Primary")
    db.commit()

    asc = _list(db, admin, sort_by="pm_name", sort_dir="asc")
    assert [p.pm_name for p in asc.items] == ["Anna", "Zara"]


def test_unknown_sort_by_falls_back(db):
    org, admin = _setup(db)
    _project(db, org)
    db.commit()
    # Should not raise — falls back to created_at ordering.
    res = _list(db, admin, sort_by="garbage")
    assert res.total == 1


# ── Soft-delete reconciliation (the PR #35 interaction) ──────────────


def test_member_count_excludes_soft_deleted(db):
    org, admin = _setup(db)
    project = _project(db, org)
    _assign(db, org, project, _user(db, org.id))  # active
    _assign(db, org, project, _user(db, org.id), is_deleted=True)  # removed
    db.commit()

    res = _list(db, admin)
    assert res.items[0].member_count == 1  # removed member not counted


def test_removed_primary_excluded_from_pm_resolution(db):
    org, admin = _setup(db)
    pm = _user(db, org.id, name="Ghost PM")
    project = _project(db, org)
    _assign(db, org, project, pm, evaluator_type="Primary", is_deleted=True)
    db.commit()

    res = _list(db, admin)
    assert res.items[0].pm_name is None  # removed PM doesn't show
    # ...and filtering by that name returns nothing.
    assert _list(db, admin, pm="Ghost PM").total == 0


# ── filter-options ───────────────────────────────────────────────────


def test_filter_options_distinct(db):
    org, admin = _setup(db)
    pm = _user(db, org.id, name="PM One")
    p1 = _project(db, org, start_date=date(2025, 3, 1))
    _project(db, org, start_date=date(2026, 3, 1))
    _project(db, org, start_date=date(2025, 9, 1))  # same year as p1
    _assign(db, org, p1, pm, evaluator_type="Primary")
    db.commit()

    opts = projects_filter_options(db, admin)
    assert opts.years == [2026, 2025]  # distinct, descending
    assert opts.pms == ["PM One"]


def test_filter_options_excludes_removed_pm(db):
    org, admin = _setup(db)
    pm = _user(db, org.id, name="Removed PM")
    project = _project(db, org, start_date=date(2026, 1, 1))
    _assign(db, org, project, pm, evaluator_type="Primary", is_deleted=True)
    db.commit()

    opts = projects_filter_options(db, admin)
    assert opts.pms == []  # soft-deleted Primary not offered


# ── Admin gate ───────────────────────────────────────────────────────


def test_non_admin_forbidden(db):
    org, admin = _setup(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _list(db, staff)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc2:
        projects_filter_options(db, staff)
    assert exc2.value.status_code == 403
