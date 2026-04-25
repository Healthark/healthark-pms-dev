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
from app.models.goal_models import ApprovalStatus, GoalType
from app.models.goal_self_review_models import SelfReviewCycleHalf


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
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None


class GoalCreate(GoalBase):
    # Ownership is server-determined: the goal is always stamped with
    # current_user.id, OR with the ?user_id= query param when a mentor/Admin
    # explicitly creates on behalf of a mentee (validated in the route).
    # Intentionally NOT accepted in the body — a body-level user_id would
    # let a caller silently re-home a goal to another user.
    # "annual" goals are gate-controlled by annual_goals_edit_enabled.
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


class GoalNotifyPayload(BaseModel):
    """
    Payload for the mentor → mentee Notify action.
    action_requested: short label for what the mentor needs (e.g. "Please submit self-review").
    description: longer explanation visible in the mentee's notification bell.
    """
    action_requested: str = Field(..., min_length=1, max_length=200)
    description:      str = Field(..., min_length=1)


class GoalMentorReviewSubmit(BaseModel):
    """
    Payload the mentor submits when reviewing a mentee's self-review for one
    fiscal-year half.  cycle_half comes from the URL path param, not the body.
    One-shot per (goal_id, cycle_half) — enforced at DB level.
    """
    mentor_comment_task_execution:      str = Field(..., min_length=1)
    mentor_comment_ownership:           str = Field(..., min_length=1)
    mentor_comment_client_deliverables: str = Field(..., min_length=1)
    mentor_comment_communication:       str = Field(..., min_length=1)
    mentor_comment_project_management:  str = Field(..., min_length=1)
    mentor_comment_mentoring:           str = Field(..., min_length=1)
    mentor_comment_firm_growth:         str = Field(..., min_length=1)
    mentor_comment_competency_skills:   str = Field(..., min_length=1)


class GoalMentorReviewResponse(BaseModel):
    """One half's mentor review on an approved goal.  0–2 per goal."""
    id: int
    goal_id: int
    cycle_half: SelfReviewCycleHalf
    submitted_at: datetime
    mentor_comment_task_execution:      str
    mentor_comment_ownership:           str
    mentor_comment_client_deliverables: str
    mentor_comment_communication:       str
    mentor_comment_project_management:  str
    mentor_comment_mentoring:           str
    mentor_comment_firm_growth:         str
    mentor_comment_competency_skills:   str

    model_config = ConfigDict(from_attributes=True)


class GoalSelfReviewSubmit(BaseModel):
    """
    Payload the goal owner submits when reflecting on an APPROVED goal
    for ONE half of the fiscal year (H1 or H2).  The cycle_half comes
    from the URL path parameter, not the body.

    Each submission is one-shot — once persisted for a given
    (goal_id, cycle_half) it cannot be re-submitted.
    """
    self_desc_task_execution:      str = Field(..., min_length=1)
    self_desc_ownership:           str = Field(..., min_length=1)
    self_desc_client_deliverables: str = Field(..., min_length=1)
    self_desc_communication:       str = Field(..., min_length=1)
    self_desc_project_management:  str = Field(..., min_length=1)
    self_desc_mentoring:           str = Field(..., min_length=1)
    self_desc_firm_growth:         str = Field(..., min_length=1)
    self_desc_competency_skills:   str = Field(..., min_length=1)


class GoalSelfReviewResponse(BaseModel):
    """
    One half's self-review on an approved goal.  A goal has 0–2 of these
    attached (keyed by cycle_half = "H1" or "H2").
    """
    id: int
    goal_id: int
    cycle_half: SelfReviewCycleHalf
    submitted_at: datetime
    self_desc_task_execution:      str
    self_desc_ownership:           str
    self_desc_client_deliverables: str
    self_desc_communication:       str
    self_desc_project_management:  str
    self_desc_mentoring:           str
    self_desc_firm_growth:         str
    self_desc_competency_skills:   str

    model_config = ConfigDict(from_attributes=True)


class GoalResponse(GoalBase):
    id: int
    org_id: int
    user_id: int
    manager_id: Optional[int] = None
    # Display name of the goal's assigned mentor — populated from
    # Goal.manager.full_name via the `manager_name` property on the model.
    # None when the owner has no mentor (frontend renders "No Mentor Assigned").
    manager_name: Optional[str] = None
    goal_type: str
    # Bare FY label stamped at creation for annual goals (e.g. "FY26").
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

    # ── Self-reviews ─────────────────────────────────────────────────
    self_reviews: list[GoalSelfReviewResponse] = []

    # ── Mentor reviews ───────────────────────────────────────────────
    # 0–2 rows, one per fiscal-year half, filled by the mentor after
    # reading the mentee's self-review for that half.
    mentor_reviews: list[GoalMentorReviewResponse] = []

    # Nested criteria — populated from the SQLAlchemy relationship
    criteria: list[CriterionResponse] = []

    @computed_field
    @property
    def fy_year(self) -> Optional[int]:
        """
        4-digit fiscal start year extracted from cycle_name ("H1 2026" → 2026).
        None for regular goals or annual goals created before this field existed.
        Used by the frontend Year filter on the Annual Goals page.
        """
        if not self.cycle_name:
            return None
        for token in self.cycle_name.split():
            if token.isdigit() and len(token) == 4:
                return int(token)
        return None

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