from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.goal_models import GoalStatus, ApprovalStatus


class GoalBase(BaseModel):
    title:       str            = Field(..., description="The main objective of the goal")
    description: Optional[str] = None
    status:      GoalStatus     = GoalStatus.PENDING
    start_date:  Optional[datetime] = None
    due_date:    Optional[datetime] = None


class GoalCreate(GoalBase):
    user_id:    int
    manager_id: Optional[int] = None
    # approval_status intentionally omitted — backend always initialises to DRAFT


class GoalUpdate(BaseModel):
    title:          Optional[str]        = None
    description:    Optional[str]        = None
    status:         Optional[GoalStatus] = None
    start_date:     Optional[datetime]   = None
    due_date:       Optional[datetime]   = None
    progress_notes: Optional[str]        = None


class GoalApprovalUpdate(BaseModel):
    """
    Payload for the manager approval endpoint.
    Only APPROVED and CHANGES_REQUESTED are valid targets — the route
    enforces this; the schema accepts the full enum for clarity.
    """
    approval_status: ApprovalStatus
    feedback:        Optional[str] = None


class GoalResponse(GoalBase):
    id:              int
    org_id:          int
    user_id:         int
    manager_id:      Optional[int] = None
    approval_status: str
    manager_feedback: Optional[str] = None
    created_at:      datetime
    updated_at:      Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class TeamGoalResponse(GoalResponse):
    """Extended response for the manager's Team Goals view."""
    owner_name: str