"""
Goal Schemas — Updated for Story 3.1 (Criteria Breakdown) and 3.3 (Progress Tracking).

Changes from previous version:
    - Added CriterionCreate, CriterionUpdate, CriterionResponse
    - GoalCreate now accepts an optional `criteria` array for transactional insert
    - GoalResponse now includes nested `criteria` list + computed `progress_percent`
    - TeamGoalResponse inherits the new criteria fields automatically
"""

from pydantic import BaseModel, Field, ConfigDict, computed_field
from typing import Optional
from datetime import datetime
from app.models.goal_models import GoalStatus, ApprovalStatus, GoalType


# =====================================================================
# CRITERION SCHEMAS
# =====================================================================

class CriterionCreate(BaseModel):
    """A single key result sent inside the GoalCreate payload."""
    title: str = Field(..., min_length=1, max_length=500)
    sort_order: int = 0


class CriterionUpdate(BaseModel):
    """
    Update a single criterion — used for both metadata edits
    and completion toggling (Story 3.3).
    """
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    sort_order: Optional[int] = None
    is_completed: Optional[bool] = None
    proof_comments: Optional[str] = None


class CriterionResponse(BaseModel):
    """What the frontend receives for each criterion."""
    id: int
    goal_id: int
    title: str
    sort_order: int
    is_completed: bool
    completed_at: Optional[datetime] = None
    proof_comments: Optional[str] = None
    proof_attachment_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# =====================================================================
# GOAL SCHEMAS
# =====================================================================

class GoalBase(BaseModel):
    title: str = Field(..., description="The main objective of the goal")
    description: Optional[str] = None
    status: GoalStatus = GoalStatus.PENDING
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None


class GoalCreate(GoalBase):
    user_id: int
    manager_id: Optional[int] = None
    # "yearly" goals are gate-controlled by yearly_goals_edit_enabled.
    # "regular" goals follow the normal project-cycle submission rules.
    goal_type: GoalType = GoalType.REGULAR
    # Optional external reference (e.g. Google Drive folder URL).
    attachment_url: Optional[str] = None
    # Optional criteria array — if provided, backend inserts them
    # transactionally with the parent goal in a single commit.
    criteria: list[CriterionCreate] = []


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    attachment_url: Optional[str] = None
    status: Optional[GoalStatus] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    progress_notes: Optional[str] = None


class GoalApprovalUpdate(BaseModel):
    """
    Payload for the manager approval endpoint.
    Only APPROVED and CHANGES_REQUESTED are valid targets.
    """
    approval_status: ApprovalStatus
    feedback: Optional[str] = None


class GoalResponse(GoalBase):
    id: int
    org_id: int
    user_id: int
    manager_id: Optional[int] = None
    goal_type: str
    # Bare FY label stamped at creation for yearly goals (e.g. "FY26").
    # None for regular goals.
    cycle_name: Optional[str] = None
    attachment_url: Optional[str] = None
    approval_status: str
    manager_feedback: Optional[str] = None
    progress_notes: Optional[str] = None
    # Timestamps for differentiating goals by lifecycle stage.
    # created_at  — when the goal was first saved (always present)
    # updated_at  — when it was last modified (auto-managed by SQLAlchemy)
    # approved_at — set the moment approval_status transitions to APPROVED;
    #               None until then. Enables future filters like
    #               "goals approved in H1 FY26".
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Nested criteria — populated from the SQLAlchemy relationship
    criteria: list[CriterionResponse] = []

    @computed_field
    @property
    def progress_percent(self) -> int:
        """
        Computed progress: (completed criteria / total criteria) * 100.
        Returns 0 if no criteria exist (avoids division by zero).
        The frontend uses this for progress bars and the dashboard widget.
        """
        if not self.criteria:
            return 0
        completed = sum(1 for c in self.criteria if c.is_completed)
        return round((completed / len(self.criteria)) * 100)

    model_config = ConfigDict(from_attributes=True)


class TeamGoalResponse(GoalResponse):
    """Extended response for the manager's Team Goals view."""
    owner_name: str