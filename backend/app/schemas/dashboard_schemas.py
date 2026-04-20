"""
Dashboard Schemas — The Dashboard Page's API Contract.

Goal progress is now tracked entirely through criteria completion —
there is no separate employee-controlled progress state.  The dashboard
therefore summarises yearly goals by APPROVAL state, which reflects
where the goal sits in the mentor-approval workflow.

All fields default to zero/null so the endpoint always returns a valid
response even for brand-new users with no goals or mentees.
"""

from pydantic import BaseModel
from typing import Optional


class DashboardSummary(BaseModel):
    """
    Aggregated widget data for the Dashboard page.

    One GET, one response, all widgets fed at once.
    The frontend conditionally renders widgets based on the user's
    features array (from AuthContext), not from this payload — so we
    always return all fields regardless of enabled features.
    """
    total_goals: int = 0
    # Approval-workflow breakdown of the caller's own yearly goals.
    draft_goals: int = 0
    submitted_goals: int = 0
    approved_goals: int = 0
    changes_requested_goals: int = 0
    # Criteria-driven average completion across approved goals (0–100).
    completion_percent: int = 0
    active_cycle: Optional[str] = None
    mentee_count: int = 0