"""
Mentee-facing rating visibility on annual reviews.

`_strip_private_ratings` mutates a review in place before it is returned to the
mentee. Two INDEPENDENT per-FY gates drive what they see:

  - annual_review_mentor_rating_visible → the mentor's rating (once submitted).
  - annual_review_final_rating_visible  → the management (final) rating, STRICT
    (never falls back to the mentor rating) and additionally gated by the
    per-row final_rating_enabled publish flag.

Past-FY reviews bypass both toggles; mentor drafts are always stripped. The
gates are plain functions, so we call _strip_private_ratings directly against an
in-memory SQLite session with fabricated rows.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.annual_review_routes import _strip_private_ratings
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User

ACTIVE_FY = "FY26-27"


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
    db.flush()
    return org


def _user(db, org_id):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role="Staff",
        password_hash="x",
    )
    db.add(u)
    db.flush()
    return u


def _review(
    db,
    org_id,
    user_id,
    cycle=ACTIVE_FY,
    *,
    status=ReviewStatus.COMPLETED.value,
    mentor=3,
    mgmt=4,
    final_rating_enabled=True,
    mentor_review_text="Strong delivery this year.",
):
    r = AnnualReview(
        org_id=org_id,
        user_id=user_id,
        cycle_name=cycle,
        status=status,
        self_performance_rating=2,
        mentor_performance_rating=mentor,
        mentor_overall_review=mentor_review_text,
        mentor_overall_review_draft="draft text",
        mentor_performance_rating_draft=5,
        management_performance_rating=mgmt,
        final_rating_enabled=final_rating_enabled,
    )
    db.add(r)
    db.flush()
    return r


def _override(db, org_id, period_label, *, mentor_visible=False, final_visible=False):
    row = SystemSettingsYearOverride(
        org_id=org_id,
        period_label=period_label,
        annual_review_mentor_rating_visible=mentor_visible,
        annual_review_final_rating_visible=final_visible,
    )
    db.add(row)
    db.flush()
    return row


def test_both_gates_closed_hide_everything(db):
    org = _org(db)
    emp = _user(db, org.id)
    r = _review(db, org.id, emp.id)  # no override row → default-deny
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating is None
    assert r.final_performance_rating is None
    assert r.management_performance_rating is None
    # Drafts are always wiped, regardless of the gates.
    assert r.mentor_overall_review_draft is None
    assert r.mentor_performance_rating_draft is None


def test_mentor_gate_open_reveals_only_mentor(db):
    org = _org(db)
    emp = _user(db, org.id)
    _override(db, org.id, ACTIVE_FY, mentor_visible=True, final_visible=False)
    r = _review(db, org.id, emp.id, mentor=3, mgmt=4)
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating == 3
    assert r.final_performance_rating is None  # management gate still closed


def test_final_gate_open_reveals_strict_management(db):
    org = _org(db)
    emp = _user(db, org.id)
    _override(db, org.id, ACTIVE_FY, mentor_visible=False, final_visible=True)
    r = _review(db, org.id, emp.id, mentor=3, mgmt=4)
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating is None  # mentor gate closed
    assert r.final_performance_rating == 4  # strict management value


def test_final_rating_never_falls_back_to_mentor(db):
    """With the final gate open but management not yet rated, the final column
    shows nothing — the old `management ?? mentor` fallback is gone now that the
    mentor rating has its own gated column."""
    org = _org(db)
    emp = _user(db, org.id)
    _override(db, org.id, ACTIVE_FY, mentor_visible=True, final_visible=True)
    r = _review(db, org.id, emp.id, mentor=3, mgmt=None)
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating == 3
    assert r.final_performance_rating is None  # NOT the mentor's 3


def test_final_gate_open_but_unpublished_row_hides_final(db):
    org = _org(db)
    emp = _user(db, org.id)
    _override(db, org.id, ACTIVE_FY, final_visible=True)
    r = _review(db, org.id, emp.id, mgmt=4, final_rating_enabled=False)
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.final_performance_rating is None  # per-row publish flag is off


def test_written_mentor_review_survives_while_rating_gated(db):
    """The mentor's WRITTEN review reaches the mentee as soon as the mentor
    submits — it is NOT stripped by the rating gate. Only the numeric mentor
    rating stays gated. (Feeds the mentee "My Review" → detail modal, which now
    renders the written review even while the rating reads "Hidden".)"""
    org = _org(db)
    emp = _user(db, org.id)
    # No override row → mentor rating gate closed (default-deny).
    r = _review(
        db,
        org.id,
        emp.id,
        mentor=3,
        mentor_review_text="You owned the migration end-to-end.",
    )
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating is None  # numeric rating gated off
    assert r.mentor_overall_review == "You owned the migration end-to-end."
    # In-progress mentor draft text is still always wiped.
    assert r.mentor_overall_review_draft is None


def test_past_fy_bypasses_both_gates(db):
    org = _org(db)
    emp = _user(db, org.id)
    # Current FY is fully closed (no override row); a PAST-FY review still shows
    # both ratings — closing the current year never retroactively hides history.
    r = _review(db, org.id, emp.id, cycle="FY25-26", mentor=3, mgmt=4)
    _strip_private_ratings(db, org.id, r, ACTIVE_FY)
    assert r.mentor_performance_rating == 3
    assert r.final_performance_rating == 4
