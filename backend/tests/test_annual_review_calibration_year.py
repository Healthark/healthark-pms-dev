"""
Route-level tests for the calibration grid's Year filter.

The calibration endpoints are plain functions, so we call them directly with
an in-memory SQLite session and fabricated User/AnnualReview rows. Covers the
year-scoping contract: default → active cycle, a specific FY label → that year,
"all" → every year; plus the filter-options year list.

Calling the route directly bypasses FastAPI's dependency resolution, so the
Query(...) defaults must be passed explicitly (otherwise they arrive as Query
objects, not None).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.annual_review_routes import (
    get_calibration_filter_options,
    get_calibration_grid,
)
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
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


def _user(db, org_id, *, role="Staff", is_management=False, mentor_id=None, name=None):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=name or f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_management=is_management,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _review(db, org_id, user_id, cycle, *, mentor_id=None, status=ReviewStatus.COMPLETED.value):
    r = AnnualReview(
        org_id=org_id,
        user_id=user_id,
        mentor_id=mentor_id,
        cycle_name=cycle,
        status=status,
        self_performance_rating=2,
        mentor_performance_rating=2,
    )
    db.add(r)
    db.flush()
    return r


def _setup(db):
    """Org with active cycle FY26-27, a management user, and one calibration
    review in the current year (FY26-27) + one in a past year (FY25-26)."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name="H1 FY26-27",
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    mgmt = _user(db, org.id, role="Admin", is_management=True, name="Manager")
    emp_cur = _user(db, org.id, name="Current Emp")
    emp_past = _user(db, org.id, name="Past Emp")
    _review(db, org.id, emp_cur.id, "FY26-27", mentor_id=mgmt.id)
    _review(db, org.id, emp_past.id, "FY25-26", mentor_id=mgmt.id)
    db.commit()
    return org, mgmt, emp_cur, emp_past


def _grid(db, user, *, year=None, mentor=None, sort_by=None, sort_dir="asc"):
    pg = PaginationParams(page=1, per_page=25)
    return get_calibration_grid(
        db,
        user,
        pg,
        employee=None,
        department=None,
        designation=None,
        mentor=mentor,
        status_filter=None,
        year=year,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


def test_default_year_scopes_to_active_cycle(db):
    _org, mgmt, _c, _p = _setup(db)
    page = _grid(db, mgmt, year=None)
    # 1 completed review + synthetic not_started rows for the two active
    # employees with no FY26-27 review (the manager and the past-year employee).
    assert page.total == 3
    assert {row.cycle_name for row in page.items} == {"FY26-27"}


def test_pending_rows_are_visible_to_management(db):
    """Self-pending (not started) and mentor-pending reviews appear in the grid
    so management sees the whole pipeline — not just rows that already reached
    the management stage."""
    org, mgmt, _c, _p = _setup(db)
    mentee = _user(db, org.id, name="Mentor Pending", mentor_id=mgmt.id)
    _review(
        db, org.id, mentee.id, "FY26-27",
        mentor_id=mgmt.id, status=ReviewStatus.PENDING_MENTOR.value,
    )
    db.commit()

    page = _grid(db, mgmt, year="FY26-27")
    by_user = {r.user_id: r for r in page.items}
    # Mentor-pending review is present (was hidden before).
    assert by_user[mentee.id].status == ReviewStatus.PENDING_MENTOR.value
    # The manager never started → surfaced as a synthetic not_started row.
    assert by_user[mgmt.id].status == ReviewStatus.NOT_STARTED.value
    assert by_user[mgmt.id].review_id is None


def test_specific_past_year(db):
    _org, mgmt, _c, _p = _setup(db)
    page = _grid(db, mgmt, year="FY25-26")
    assert page.total == 1
    assert {row.cycle_name for row in page.items} == {"FY25-26"}


def test_all_years_spans_every_cycle(db):
    _org, mgmt, _c, _p = _setup(db)
    page = _grid(db, mgmt, year="all")
    # 2 real reviews (FY26-27 + FY25-26) + 2 synthetic not_started for the
    # active cycle (manager + past-year employee, who have no FY26-27 row).
    assert page.total == 4
    assert {row.cycle_name for row in page.items} == {"FY26-27", "FY25-26"}


def test_filter_options_lists_years_newest_first(db):
    _org, mgmt, _c, _p = _setup(db)
    opts = get_calibration_filter_options(db, mgmt)
    assert opts.active_year == "FY26-27"
    assert opts.years == ["FY26-27", "FY25-26"]


def test_filter_options_includes_active_year_with_no_reviews(db):
    org = Organization(name="EmptyOrg", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name="H1 FY26-27",
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    mgmt = _user(db, org.id, role="Admin", is_management=True)
    db.commit()

    opts = get_calibration_filter_options(db, mgmt)
    assert opts.active_year == "FY26-27"
    assert opts.years == ["FY26-27"]


def test_non_management_user_forbidden(db):
    _org, _mgmt, _c, _p = _setup(db)
    staff = _user(db, _org.id, role="Staff")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        _grid(db, staff, year=None)
    assert exc.value.status_code == 403


def test_sort_by_year_orders_by_cycle_name(db):
    _org, mgmt, _c, _p = _setup(db)
    page = _grid(db, mgmt, year="all", sort_by="cycle_name", sort_dir="asc")
    # FY25-26 (the one past review) sorts before the FY26-27 rows (the current
    # review + the two synthetic not_started rows).
    assert [r.cycle_name for r in page.items] == [
        "FY25-26", "FY26-27", "FY26-27", "FY26-27",
    ]


def test_deactivated_mentor_hidden_and_treated_as_unmentored(db):
    """A mentee whose mentor was deactivated: the departed mentor is hidden in
    the grid (name → None), dropped from the filter options, and the row is
    matched by the '(No mentor)' filter (the mentor alias is NULL)."""
    org, mgmt, _c, _p = _setup(db)
    gone = _user(db, org.id, role="Staff", name="Gone Mentor")
    mentee = _user(db, org.id, name="Orphaned Mentee", mentor_id=gone.id)
    _review(db, org.id, mentee.id, "FY26-27", mentor_id=gone.id)
    gone.is_deleted = True
    db.commit()

    page = _grid(db, mgmt, year="FY26-27")
    orphan = next(r for r in page.items if r.user_id == mentee.id)
    assert orphan.mentor_name is None

    opts = get_calibration_filter_options(db, mgmt)
    assert "Gone Mentor" not in opts.mentors

    no_mentor = _grid(db, mgmt, year="FY26-27", mentor="(No mentor)")
    assert mentee.id in {r.user_id for r in no_mentor.items}
