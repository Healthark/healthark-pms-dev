"""
Dashboard Schemas — The Dashboard Page's API Contract.

This schema mirrors the TypeScript DashboardSummary interface in
dashboard.service.ts exactly:

    { total_goals, pending_goals, in_progress_goals, completed_goals,
      active_cycle, mentee_count }

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
    pending_goals: int = 0
    in_progress_goals: int = 0
    completed_goals: int = 0
    active_cycle: Optional[str] = None
    mentee_count: int = 0