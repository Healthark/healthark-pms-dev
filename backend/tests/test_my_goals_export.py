"""
Self-service "export my goals" (GET /exports/my-goals).

Unlike the HR/management exports this is open to every user but strictly
scoped to their own goals, and it must honour the SAME mentor-review embargo
the My Goals screen applies — a user must never see unpublished mentor
feedback in the file. The endpoints are plain functions, so we call them
directly against an in-memory SQLite session.
"""
from __future__ import annotations

import pytest
from fastapi.responses import StreamingResponse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.export_routes import _my_goals_for_export, download_my_goals
from app.core.database import Base
from app.models.export_audit_log_models import ExportAuditLog
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.services import exporters


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


class _Req:
    """Minimal stand-in for the FastAPI Request the audit helper reads."""

    headers: dict = {}
    client = None
    query_params: dict = {}


def _user(db, org_id, *, role="Staff", mentor_id=None):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _setup(db):
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
    mentor = _user(db, org.id, role="Admin")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    return org, mentor, mentee


def _goal(db, org, owner, *, status, cycle_name=None, title="Goal X"):
    g = Goal(
        org_id=org.id,
        user_id=owner.id,
        title=title,
        goal_type=GoalType.ANNUAL.value,
        approval_status=status,
        cycle_name=cycle_name,
    )
    db.add(g)
    db.flush()
    return g


def _col(ws, header: str) -> int:
    for col in range(1, ws.max_column + 1):
        if ws.cell(row=1, column=col).value == header:
            return col
    raise AssertionError(f"{header!r} column not found")


# ── Not HR-gated + audited ───────────────────────────────────────────


def test_staff_user_can_export_own_goals(db):
    """A plain Staff user (no HR dept, not management) gets a workbook back —
    NOT the 403 the HR/management export endpoints raise."""
    org, _mentor, mentee = _setup(db)
    _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value, cycle_name="H1 2026")
    db.commit()

    resp = download_my_goals(db, mentee, _Req(), fy=None)

    assert isinstance(resp, StreamingResponse)
    assert "spreadsheet" in resp.media_type

    audit = db.query(ExportAuditLog).filter_by(export_type="my_goals").one()
    assert audit.target_user_id == mentee.id
    assert audit.status == "succeeded"
    assert audit.row_count == 1


# ── Strictly self-scoped ─────────────────────────────────────────────


def test_export_is_scoped_to_caller(db):
    org, _mentor, mentee = _setup(db)
    other = _user(db, org.id, role="Staff")
    _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value, cycle_name="H1 2026", title="Mine A")
    _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value, cycle_name="H1 2026", title="Mine B")
    _goal(db, org, other, status=ApprovalStatus.APPROVED.value, cycle_name="H1 2026", title="Theirs")
    db.commit()

    goals = _my_goals_for_export(db, mentee, None)
    titles = {g.title for g in goals}
    assert titles == {"Mine A", "Mine B"}  # never the other user's goal


# ── FY filter (current-year vs all) ──────────────────────────────────


def test_fy_filter_limits_to_one_year(db):
    org, _mentor, mentee = _setup(db)
    _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value, cycle_name="H1 2026", title="This year")
    _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value, cycle_name="H1 2025", title="Last year")
    db.commit()

    current = _my_goals_for_export(db, mentee, "FY26-27")
    assert {g.title for g in current} == {"This year"}

    all_years = _my_goals_for_export(db, mentee, None)
    assert {g.title for g in all_years} == {"This year", "Last year"}


# ── Embargo: unpublished mentor reviews must NOT leak ────────────────


def _approved_goal_with_mentor_review(db, org, mentee):
    g = _goal(
        db, org, mentee,
        status=ApprovalStatus.APPROVED.value,
        cycle_name="H1 2026",
        title="Reviewed goal",
    )
    db.add(
        GoalMentorReview(
            goal_id=g.id,
            org_id=org.id,
            cycle_half="H1",
            mentor_overall_review="Confidential mentor verdict",
            is_draft=False,
        )
    )
    db.commit()
    return g


def test_unpublished_mentor_review_is_not_exported(db):
    org, _mentor, mentee = _setup(db)
    _approved_goal_with_mentor_review(db, org, mentee)
    # No override row → the active half is unpublished (default-deny).

    goals = _my_goals_for_export(db, mentee, None)
    assert goals[0].mentor_reviews == []  # embargoed upstream

    wb, _ = exporters.build_my_goals_workbook(goals, db, org.id)
    ws = wb["My Annual Goals"]
    assert ws.cell(row=2, column=_col(ws, "H1 Mentor Review")).value in (None, "")


def test_published_mentor_review_is_exported(db):
    org, _mentor, mentee = _setup(db)
    _approved_goal_with_mentor_review(db, org, mentee)
    db.add(
        SystemSettingsYearOverride(
            org_id=org.id,
            period_label="H1 FY26-27",
            annual_goals_final_rating_visible=True,
        )
    )
    db.commit()

    goals = _my_goals_for_export(db, mentee, None)
    assert len(goals[0].mentor_reviews) == 1  # now visible

    wb, _ = exporters.build_my_goals_workbook(goals, db, org.id)
    ws = wb["My Annual Goals"]
    assert (
        ws.cell(row=2, column=_col(ws, "H1 Mentor Review")).value
        == "Confidential mentor verdict"
    )
