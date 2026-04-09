from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, GoalStatus
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings
from app.schemas.dashboard_schemas import DashboardSummaryResponse

router = APIRouter()


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(db: DbSession, current_user: CurrentUser):
    """
    Returns a single aggregated payload for the Dashboard page.
    One endpoint, one round-trip — the frontend never needs to fan out
    multiple requests just to render the landing page.
    """

    # --- Goals (scoped to this user within their org) ---
    # Base query reused for each status filter to avoid redundant joins
    base_goals = db.query(Goal).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
    )

    total_goals      = base_goals.count()
    pending_goals    = base_goals.filter(Goal.status == GoalStatus.PENDING.value).count()
    in_progress_goals = base_goals.filter(Goal.status == GoalStatus.IN_PROGRESS.value).count()
    completed_goals  = base_goals.filter(Goal.status == GoalStatus.COMPLETED.value).count()

    # --- Active Cycle (org-level setting) ---
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()
    active_cycle = settings.active_cycle if settings else None

    # --- Mentees assigned to this user ---
    # Non-zero only for Managers/Admins who have been set as mentor_id on other users
    mentee_count = db.query(User).filter(
        User.mentor_id == current_user.id,
        User.org_id == current_user.org_id,
        User.is_deleted == False,
    ).count()

    return DashboardSummaryResponse(
        total_goals=total_goals,
        pending_goals=pending_goals,
        in_progress_goals=in_progress_goals,
        completed_goals=completed_goals,
        active_cycle=active_cycle,
        mentee_count=mentee_count,
    )