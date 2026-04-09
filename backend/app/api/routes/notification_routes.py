from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, GoalStatus
from app.models.system_settings_models import SystemSettings
from app.schemas.notification_schemas import NotificationItem, TopbarSummaryResponse

router = APIRouter()


@router.get("/summary", response_model=TopbarSummaryResponse)
def get_topbar_summary(db: DbSession, current_user: CurrentUser):
    """
    Lightweight endpoint called once on Topbar mount.
    Returns the active cycle (for the badge) and any actionable alerts
    (for the notification bell) — no Admin role required, any authenticated
    user calls this on every page.
    """

    # --- Active cycle ---
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()
    active_cycle = settings.active_cycle if settings else None

    # --- Notifications ---
    # Each check appends to this list. Adding a new alert type in the future
    # means adding one block here — no schema changes needed.
    notifications: list[NotificationItem] = []

    pending_count = db.query(Goal).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.status == GoalStatus.PENDING.value,
    ).count()

    if pending_count > 0:
        notifications.append(NotificationItem(
            type="pending_goals",
            message=(
                f"You have {pending_count} pending "
                f"{'goal' if pending_count == 1 else 'goals'} to work on."
            ),
            count=pending_count,
            severity="warning",
        ))

    in_progress_count = db.query(Goal).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.status == GoalStatus.IN_PROGRESS.value,
    ).count()

    if in_progress_count > 0:
        notifications.append(NotificationItem(
            type="in_progress_goals",
            message=(
                f"You have {in_progress_count} goal"
                f"{'s' if in_progress_count > 1 else ''} in progress."
            ),
            count=in_progress_count,
            severity="info",
        ))

    return TopbarSummaryResponse(
        active_cycle=active_cycle,
        notifications=notifications,
    )