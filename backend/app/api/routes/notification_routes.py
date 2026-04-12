"""
Notification Routes — The Topbar's Data Feed.

Endpoint:
    GET /api/v1/notifications/summary  →  Any authenticated user

This endpoint is intentionally lightweight — it runs a handful of COUNT
queries against existing tables (goals, users, system_settings) and returns
a flat payload. No dedicated notifications table exists yet.

When a dedicated notifications table is built later (Epic 5), this route
simply switches from computing to reading — the response schema stays
identical, so the frontend needs zero changes.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Manager-only notifications gated by role check
    Layer 4 — Ownership:        Goal counts scoped to current_user.id
"""

from sqlalchemy import func
from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, GoalStatus, ApprovalStatus
from app.models.user_models import User
from app.schemas.notification_schemas import NotificationItem, TopbarSummary

router = APIRouter()


@router.get("/summary", response_model=TopbarSummary)
def get_topbar_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle name and a list of computed notifications
    for the currently authenticated user.
    """
    # ── Active Cycle ─────────────────────────────────────────────────
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    active_cycle = settings.active_cycle_name if settings else None

    # ── Computed Notifications ───────────────────────────────────────
    notifications: list[NotificationItem] = []

    # 1. Goals still in "Pending" progress status (employee hasn't started)
    pending_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.status == GoalStatus.PENDING.value,
    ).scalar() or 0

    if pending_count > 0:
        notifications.append(NotificationItem(
            type="goals_pending",
            message=f"You have {pending_count} goal(s) that haven't been started yet.",
            count=pending_count,
            severity="warning",
        ))

    # 2. Goals sent back by manager with "Changes Requested"
    changes_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.approval_status == ApprovalStatus.CHANGES_REQUESTED.value,
    ).scalar() or 0

    if changes_count > 0:
        notifications.append(NotificationItem(
            type="goals_changes_requested",
            message=f"{changes_count} goal(s) need revisions — check manager feedback.",
            count=changes_count,
            severity="blocking",
        ))

    # 3. Goals in "Draft" that haven't been submitted for approval yet
    draft_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.approval_status == ApprovalStatus.DRAFT.value,
    ).scalar() or 0

    if draft_count > 0:
        notifications.append(NotificationItem(
            type="goals_draft",
            message=f"{draft_count} goal(s) are still in draft — submit for approval.",
            count=draft_count,
            severity="info",
        ))

    # ── Manager-Only Notifications ───────────────────────────────────
    if current_user.role in ("Admin", "Manager", "Principal"):

        # 4. Team goals awaiting this manager's approval
        awaiting_count: int = db.query(func.count(Goal.id)).filter(
            Goal.org_id == current_user.org_id,
            Goal.manager_id == current_user.id,
            Goal.approval_status == ApprovalStatus.SUBMITTED.value,
        ).scalar() or 0

        if awaiting_count > 0:
            notifications.append(NotificationItem(
                type="goals_pending_approval",
                message=f"{awaiting_count} goal(s) from your team await your approval.",
                count=awaiting_count,
                severity="warning",
            ))

    return TopbarSummary(
        active_cycle=active_cycle,
        notifications=notifications,
    )