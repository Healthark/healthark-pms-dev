"""
Dashboard Routes — The Landing Page's Data Feed.

Endpoint:
    GET /api/v1/dashboard/summary  →  Any authenticated user

Returns aggregated widget data in a single round-trip:
    - Goal counts broken down by progress status
    - Active cycle name (for the ActiveCycleWidget)
    - Mentee count (for the MenteesWidget)

Performance Note:
    Goal counts use a single GROUP BY query instead of four separate
    COUNT queries. This is O(1) round-trips regardless of how many
    status values exist.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Not needed (all users see their own data)
    Layer 4 — Ownership:        Goals scoped to current_user.id
"""

from datetime import date
from sqlalchemy import func
from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, GoalStatus
from app.models.user_models import User
from app.schemas.dashboard_schemas import DashboardSummary
from app.core.cycle_utils import get_current_cycle_info

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return aggregated counts for all dashboard widgets in one shot.
    """
    # ── Active Cycle ─────────────────────────────────────────────────
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    # Dynamically calculate the active cycle based on the org's cadence
    if settings:
        active_cycle = get_current_cycle_info(
            current_date=date.today(),
            cycle_type=settings.cycle_type,
            fiscal_start_month=settings.fiscal_start_month
        )
    else:
        active_cycle = None

    # ── Goal Counts (Single Query) ───────────────────────────────────
    # Returns rows like: [("pending", 3), ("in_progress", 2), ("completed", 1)]
    status_rows = (
        db.query(Goal.status, func.count(Goal.id))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
        )
        .group_by(Goal.status)
        .all()
    )

    # Convert to a dict for easy lookup — missing statuses default to 0
    counts: dict[str, int] = dict(status_rows)

    total_goals       = sum(counts.values())
    pending_goals     = counts.get(GoalStatus.PENDING.value, 0)
    in_progress_goals = counts.get(GoalStatus.IN_PROGRESS.value, 0)
    completed_goals   = counts.get(GoalStatus.COMPLETED.value, 0)

    # ── Mentee Count ─────────────────────────────────────────────────
    # How many active users list the current user as their mentor.
    # This powers the MenteesWidget — only meaningful for Managers,
    # but we always return it; the frontend gates visibility via hasFeature().
    mentee_count: int = db.query(func.count(User.id)).filter(
        User.mentor_id == current_user.id,
        User.is_deleted == False,  # noqa: E712 — SQLAlchemy requires == for filter
    ).scalar() or 0

    return DashboardSummary(
        total_goals=total_goals,
        pending_goals=pending_goals,
        in_progress_goals=in_progress_goals,
        completed_goals=completed_goals,
        active_cycle=active_cycle,
        mentee_count=mentee_count,
    )