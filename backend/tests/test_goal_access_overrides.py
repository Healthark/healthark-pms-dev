"""
Tests for per-employee goal-access overrides (PR 1).

Covers the two admin capabilities + the gate they override, exercised by
calling the plain route functions directly against an in-memory SQLite session
(same style as test_goal_notifications):

    - the annual-goal gate now honours a per-employee grant when the org-wide
      half is closed (create → allow_create, edit/delete → allow_edit);
    - the admin throw-a-goal-back-to-draft action (approved-only) reverts the
      goal, clears the approval lock, and auto-grants the owner edit access;
    - grant / revoke / list / detail admin endpoints;
    - the self-scoped GET /goals/my-access reflection.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    get_goal_access_for_user,
    list_goal_access_grants,
    revert_goal_to_draft,
    revoke_goal_access,
    set_goal_access_for_user,
)
from app.api.routes.goal_routes import create_goal, get_my_goal_access, update_goal
from app.core.database import Base
from app.models.goal_access_override_models import GoalAccessOverride
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.schemas.admin_schemas import GoalAccessGrantUpdate, GoalAccessRevokeRequest
from app.schemas.goal_schemas import GoalCreate, GoalUpdate

ACTIVE_HALF = "H1 FY26-27"   # active cycle for the tests
GOAL_CYCLE = "H1 2026"        # how an annual goal stamps that half


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


def _setup(db, *, gate_open=False):
    """Org + settings (active H1 FY26-27) + admin, mentor, and a mentee who
    reports to the mentor. `gate_open` opens the org-wide half gate."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name=ACTIVE_HALF,
            cycle_type="half_yearly",
            fiscal_start_month=4,
        )
    )
    if gate_open:
        db.add(
            SystemSettingsYearOverride(
                org_id=org.id,
                period_label=ACTIVE_HALF,
                annual_goals_edit_enabled=True,
            )
        )
    admin = _user(db, org.id, role="Admin")
    mentor = _user(db, org.id, role="Manager")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    db.commit()
    return org, admin, mentor, mentee


def _goal(db, org, owner, *, status, cycle_name=GOAL_CYCLE, title="Goal X"):
    g = Goal(
        org_id=org.id,
        user_id=owner.id,
        manager_id=owner.mentor_id,
        title=title,
        goal_type=GoalType.ANNUAL.value,
        approval_status=status,
        cycle_name=cycle_name,
    )
    db.add(g)
    db.flush()
    return g


def _grant(db, org, user, *, period=ACTIVE_HALF, allow_create=False, allow_edit=False):
    ov = GoalAccessOverride(
        org_id=org.id,
        user_id=user.id,
        period_label=period,
        allow_create=allow_create,
        allow_edit=allow_edit,
    )
    db.add(ov)
    db.commit()
    return ov


# ── Gate: create ─────────────────────────────────────────────────────


def test_create_blocked_when_half_closed_and_no_grant(db):
    _org, _admin, _mentor, mentee = _setup(db, gate_open=False)
    with pytest.raises(HTTPException) as exc:
        create_goal(GoalCreate(title="G", goal_type=GoalType.ANNUAL), db, mentee)
    assert exc.value.status_code == 403


def test_create_allowed_with_allow_create_grant(db):
    org, _admin, _mentor, mentee = _setup(db, gate_open=False)
    _grant(db, org, mentee, allow_create=True)

    create_goal(GoalCreate(title="G", goal_type=GoalType.ANNUAL), db, mentee)

    g = db.query(Goal).filter(Goal.user_id == mentee.id).one()
    assert g.approval_status == ApprovalStatus.DRAFT.value
    assert g.cycle_name == GOAL_CYCLE


def test_create_still_blocked_with_only_edit_grant(db):
    # An edit grant must NOT let the employee create brand-new goals.
    org, _admin, _mentor, mentee = _setup(db, gate_open=False)
    _grant(db, org, mentee, allow_edit=True)
    with pytest.raises(HTTPException) as exc:
        create_goal(GoalCreate(title="G", goal_type=GoalType.ANNUAL), db, mentee)
    assert exc.value.status_code == 403


# ── Gate: edit ───────────────────────────────────────────────────────


def test_edit_blocked_when_half_closed_and_no_grant(db):
    org, _admin, _mentor, mentee = _setup(db, gate_open=False)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_goal(g.id, GoalUpdate(title="new title"), db, mentee)
    assert exc.value.status_code == 403


def test_edit_allowed_with_allow_edit_grant(db):
    org, _admin, _mentor, mentee = _setup(db, gate_open=False)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()
    _grant(db, org, mentee, allow_edit=True)

    update_goal(g.id, GoalUpdate(title="new title"), db, mentee)

    db.refresh(g)
    assert g.title == "new title"


# ── Throw a goal back to draft ───────────────────────────────────────


def test_revert_reverts_clears_lock_and_grants_edit(db):
    org, admin, mentor, mentee = _setup(db, gate_open=False)
    g = _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value)
    g.approved_at = datetime.now(timezone.utc)
    db.commit()

    revert_goal_to_draft(g.id, db, admin, BackgroundTasks())

    db.refresh(g)
    assert g.approval_status == ApprovalStatus.DRAFT.value
    assert g.approved_at is None

    ov = (
        db.query(GoalAccessOverride)
        .filter(GoalAccessOverride.user_id == mentee.id)
        .one()
    )
    assert ov.allow_edit is True
    assert ov.period_label == ACTIVE_HALF
    assert ov.revoked_at is None
    assert ov.granted_by_id == admin.id

    # Employee + mentor both notified.
    assert db.query(Notification).filter(
        Notification.type == "goal_reverted_to_draft",
        Notification.recipient_id == mentee.id,
    ).count() == 1
    assert db.query(Notification).filter(
        Notification.type == "goal_reverted_to_draft_mentor",
        Notification.recipient_id == mentor.id,
    ).count() == 1


def test_revert_rejects_non_approved_goal(db):
    org, admin, _mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        revert_goal_to_draft(g.id, db, admin, BackgroundTasks())
    assert exc.value.status_code == 400


def test_revert_rejects_in_review_goal(db):
    org, admin, _mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.H1_SELF_REVIEWED.value)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        revert_goal_to_draft(g.id, db, admin, BackgroundTasks())
    assert exc.value.status_code == 400
    assert "review phase" in exc.value.detail


def test_revert_requires_admin(db):
    org, _admin, mentor, mentee = _setup(db)
    g = _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value)
    db.commit()
    # The mentee (non-admin) cannot throw their own goal back.
    with pytest.raises(HTTPException) as exc:
        revert_goal_to_draft(g.id, db, mentee, BackgroundTasks())
    assert exc.value.status_code == 403
    # Neither can a plain Manager mentor.
    with pytest.raises(HTTPException) as exc2:
        revert_goal_to_draft(g.id, db, mentor, BackgroundTasks())
    assert exc2.value.status_code == 403


# ── Grant / revoke admin endpoints ───────────────────────────────────


def test_set_grant_then_revoke(db):
    org, admin, _mentor, mentee = _setup(db)

    detail = set_goal_access_for_user(
        mentee.id, GoalAccessGrantUpdate(allow_create=True), db, admin
    )
    assert any(g.allow_create for g in detail.grants)
    assert db.query(Notification).filter(
        Notification.type == "goal_access_granted",
        Notification.recipient_id == mentee.id,
    ).count() == 1

    revoke_goal_access(mentee.id, GoalAccessRevokeRequest(), db, admin)

    ov = (
        db.query(GoalAccessOverride)
        .filter(GoalAccessOverride.user_id == mentee.id)
        .one()
    )
    assert ov.allow_create is False
    assert ov.revoked_at is not None
    assert ov.revoked_by_id == admin.id


def test_revoke_without_active_grant_404s(db):
    _org, admin, _mentor, mentee = _setup(db)
    with pytest.raises(HTTPException) as exc:
        revoke_goal_access(mentee.id, GoalAccessRevokeRequest(), db, admin)
    assert exc.value.status_code == 404


def test_list_grants_overview(db):
    org, admin, _mentor, mentee = _setup(db)
    _grant(db, org, mentee, allow_create=True)
    rows = list_goal_access_grants(db, admin)
    assert len(rows) == 1
    assert rows[0].user_id == mentee.id
    assert rows[0].allow_create is True


def test_list_grants_excludes_revoked(db):
    org, admin, _mentor, mentee = _setup(db)
    set_goal_access_for_user(mentee.id, GoalAccessGrantUpdate(allow_create=True), db, admin)
    revoke_goal_access(mentee.id, GoalAccessRevokeRequest(), db, admin)
    assert list_goal_access_grants(db, admin) == []


def test_get_detail_lists_revertible_goals(db):
    org, admin, _mentor, mentee = _setup(db)
    _goal(db, org, mentee, status=ApprovalStatus.APPROVED.value, title="Approved one")
    _goal(db, org, mentee, status=ApprovalStatus.DRAFT.value, title="Draft one")
    db.commit()

    detail = get_goal_access_for_user(mentee.id, db, admin)
    by_title = {g.title: g for g in detail.goals}
    assert by_title["Approved one"].can_revert is True
    assert by_title["Draft one"].can_revert is False


# ── Self-scoped my-access ────────────────────────────────────────────


def test_my_access_empty_by_default(db):
    _org, _admin, _mentor, mentee = _setup(db)
    resp = get_my_goal_access(db, mentee)
    assert resp.allow_create is False
    assert resp.allow_edit is False
    assert resp.edit_period_labels == []
    assert resp.active_period_label == ACTIVE_HALF


def test_my_access_reflects_grant(db):
    org, _admin, _mentor, mentee = _setup(db)
    _grant(db, org, mentee, allow_create=True, allow_edit=True)
    resp = get_my_goal_access(db, mentee)
    assert resp.allow_create is True
    assert resp.allow_edit is True
    assert ACTIVE_HALF in resp.edit_period_labels
