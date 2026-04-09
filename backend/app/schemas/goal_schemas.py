from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.goal_models import GoalStatus

# 1. The Base Schema (Shared properties)
class GoalBase(BaseModel):
    title: str = Field(..., description="The main objective of the goal")
    description: Optional[str] = None
    status: GoalStatus = GoalStatus.PENDING
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

# 2. What the React Frontend sends us when CREATING a goal
class GoalCreate(GoalBase):
    # The employee this goal belongs to
    user_id: int
    # Optional: If a manager assigned it
    manager_id: Optional[int] = None

# 3. What the React Frontend sends us when UPDATING a goal (Everything is optional)
class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[GoalStatus] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

# 4. What we send BACK to the React Frontend
class GoalResponse(GoalBase):
    id: int
    org_id: int
    user_id: int
    manager_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    # Architect Note: This is crucial! It tells Pydantic to read data 
    # directly from the SQLAlchemy database objects instead of just standard dictionaries.
    model_config = ConfigDict(from_attributes=True)