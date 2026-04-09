from pydantic import BaseModel
from typing import Optional


class DashboardSummaryResponse(BaseModel):
    # Goals — scoped to the logged-in user
    total_goals: int
    pending_goals: int
    in_progress_goals: int
    completed_goals: int

    # Pulled from system_settings for the user's org
    active_cycle: Optional[str] = None

    # Mentees assigned to this user (0 if not a mentor)
    mentee_count: int