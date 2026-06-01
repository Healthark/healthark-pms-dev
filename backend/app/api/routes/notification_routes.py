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
    Layer 3 — Role Awareness:   The "team awaiting approval" count is scoped to
                                the user's DIRECT mentees (mentor_id) regardless
                                of role — there is no Admin org-wide bypass, so
                                the count matches the Team Goals tab exactly.
    Layer 4 — Ownership:        Personal goal counts scoped to current_user.id
"""

from datetime import date
from sqlalchemy import func
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, ApprovalStatus, GoalType
from app.models.user_models import User
from app.models.goal_notification_models import GoalNotification
from app.schemas.notification_schemas import NotificationItem, UserNotificationItem, TopbarSummary
from app.core.cycle_utils import get_current_cycle_info, resolve_today

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

    # Dynamically calculate the active cycle based on the org's cadence
    if settings:
        active_cycle = get_current_cycle_info(
            current_date=resolve_today(settings),
            cycle_type=settings.cycle_type,
            fiscal_start_month=settings.fiscal_start_month
        )
    else:
        active_cycle = None

    # ── Computed Notifications ───────────────────────────────────────
    # Every goal notification below deep-links to the Annual Goals page, whose
    # My Goals and Team Goals tabs are ANNUAL-only. So each count is scoped to
    # goal_type == "annual" — otherwise a pending/draft *regular* goal would
    # inflate the bell with a number the page can never surface (a false
    # alarm). See GET /goals (My Goals) and GET /goals/team (Team Goals).
    notifications: list[NotificationItem] = []

    # 1. Goals sent back by manager with "Changes Requested"
    changes_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.goal_type == GoalType.ANNUAL.value,
        Goal.approval_status == ApprovalStatus.CHANGES_REQUESTED.value,
    ).scalar() or 0

    if changes_count > 0:
        notifications.append(NotificationItem(
            type="goals_changes_requested",
            message=f"{changes_count} goal(s) need revisions — check manager feedback.",
            count=changes_count,
            severity="blocking",
        ))

    # 2. Goals in "Draft" that haven't been submitted for approval yet
    draft_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.goal_type == GoalType.ANNUAL.value,
        Goal.approval_status == ApprovalStatus.DRAFT.value,
    ).scalar() or 0

    if draft_count > 0:
        notifications.append(NotificationItem(
            type="goals_draft",
            message=f"{draft_count} goal(s) are still in draft — submit for approval.",
            count=draft_count,
            severity="info",
        ))

    # ── Mentor Notifications ─────────────────────────────────────────
    # Scoped to the user's DIRECT mentees (mentor_id), mirroring the Team
    # Goals tab's data source (GET /goals/team → _mentee_ids_for). There is
    # deliberately NO Admin org-wide bypass here: that tab has none, so an
    # Admin who relied on it would see a count they could never clear. A user
    # who mentors nobody gets an empty list — and no "team" notification — by
    # design. Mentor/mentee behaviour is unchanged: this matches what the
    # non-Admin branch already did.
    mentee_ids = [
        row[0] for row in db.query(User.id).filter(
            User.mentor_id == current_user.id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        ).all()
    ]

    if mentee_ids:
        awaiting_count: int = db.query(func.count(Goal.id)).filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(mentee_ids),
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status == ApprovalStatus.PENDING_APPROVAL.value,
        ).scalar() or 0

        if awaiting_count > 0:
            notifications.append(NotificationItem(
                type="goals_pending_approval",
                message=f"{awaiting_count} goal(s) from your team await your approval.",
                count=awaiting_count,
                severity="warning",
            ))

    # ── Direct User Notifications (mentor → mentee via Notify button) ──
    raw_user_notifs = (
        db.query(GoalNotification)
        .filter(
            GoalNotification.recipient_id == current_user.id,
            GoalNotification.org_id == current_user.org_id,
        )
        .order_by(GoalNotification.created_at.desc())
        .limit(20)
        .all()
    )

    user_notifications = [
        UserNotificationItem(
            id=n.id,
            message=n.message,
            goal_id=n.goal_id,
            created_at=n.created_at,
            is_read=n.is_read,
        )
        for n in raw_user_notifs
    ]

    return TopbarSummary(
        active_cycle=active_cycle,
        notifications=notifications,
        user_notifications=user_notifications,
    )


@router.post("/{notification_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Mark a single direct notification as read.

    Scoped to the current user (recipient) + tenant, so a user can only ever
    flip their own notifications. A missing/foreign id returns 404 rather than
    silently succeeding. Only the computed `user_notifications` (stored
    GoalNotification rows) carry a read state — the system-computed
    `notifications` clear themselves when the underlying goals are resolved.
    """
    notif = db.query(GoalNotification).filter(
        GoalNotification.id == notification_id,
        GoalNotification.recipient_id == current_user.id,
        GoalNotification.org_id == current_user.org_id,
    ).first()

    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    if not notif.is_read:
        notif.is_read = True
        db.commit()
    return None


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    db: DbSession,
    current_user: CurrentUser,
):
    """Mark all of the current user's direct notifications as read."""
    db.query(GoalNotification).filter(
        GoalNotification.recipient_id == current_user.id,
        GoalNotification.org_id == current_user.org_id,
        GoalNotification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return None