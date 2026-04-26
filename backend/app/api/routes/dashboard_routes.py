"""
Dashboard Routes — The Landing Page's Data Feed.

Endpoint:
    GET /api/v1/dashboard/summary  →  Any authenticated user

Returns aggregated widget data in a single round-trip:
    - Annual goal counts broken down by approval state
    - Criteria-driven completion average across approved annual goals
    - Active cycle name (for the ActiveCycleWidget)
    - Mentee count (for the MenteesWidget)

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Not needed (all users see their own data)
    Layer 4 — Ownership:        Goals scoped to current_user.id
"""

from sqlalchemy import func, Integer, cast
from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, GoalType, ApprovalStatus, POST_APPROVAL_STATES
from app.models.goal_criteria_models import GoalCriterion
from app.models.user_models import User
from app.schemas.dashboard_schemas import DashboardSummary

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

    active_cycle = settings.active_cycle_name if settings else None

    # ── Annual Goal Counts by Approval State (single GROUP BY) ───────
    approval_rows = (
        db.query(Goal.approval_status, func.count(Goal.id))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .group_by(Goal.approval_status)
        .all()
    )
    counts: dict[str, int] = dict(approval_rows)

    draft_goals             = counts.get(ApprovalStatus.DRAFT.value, 0)
    submitted_goals         = counts.get(ApprovalStatus.PENDING_APPROVAL.value, 0)
    # Roll the 4 post-approval review states under the "approved" bucket so
    # the dashboard widget keeps rendering a single consolidated count.
    approved_goals          = sum(counts.get(s, 0) for s in POST_APPROVAL_STATES)
    changes_requested_goals = counts.get(ApprovalStatus.CHANGES_REQUESTED.value, 0)
    total_goals             = sum(counts.values())

    # ── Criteria-driven completion across approved annual goals ─────
    # Progress is no longer an employee-controlled field — it falls out
    # of (completed criteria / total criteria).  We average this over the
    # caller's approved annual goals, because draft/submitted goals don't
    # have meaningful progress yet.
    criteria_totals = (
        db.query(
            func.count(GoalCriterion.id).label("total"),
            func.sum(cast(GoalCriterion.is_completed, Integer)).label("done"),
        )
        .join(Goal, Goal.id == GoalCriterion.goal_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status.in_(POST_APPROVAL_STATES),
        )
        .one()
    )
    total_criteria = int(criteria_totals.total or 0)
    done_criteria  = int(criteria_totals.done or 0)
    completion_percent = (
        round((done_criteria / total_criteria) * 100) if total_criteria > 0 else 0
    )

    # ── Mentee Count ─────────────────────────────────────────────────
    # How many active users list the current user as their mentor.
    mentee_count: int = db.query(func.count(User.id)).filter(
        User.mentor_id == current_user.id,
        User.is_deleted == False,  # noqa: E712 — SQLAlchemy requires == for filter
    ).scalar() or 0

    return DashboardSummary(
        total_goals=total_goals,
        draft_goals=draft_goals,
        submitted_goals=submitted_goals,
        approved_goals=approved_goals,
        changes_requested_goals=changes_requested_goals,
        completion_percent=completion_percent,
        active_cycle=active_cycle,
        mentee_count=mentee_count,
    )