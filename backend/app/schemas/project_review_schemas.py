"""
Project Review Schemas — Self-Assessment and Evaluator Feedback Contract.

Schema Map:
    ── Employee ──
    SelfReviewCreate      → Create + submit (all 8 competencies required)
    SelfReviewDraft       → Partial save (all fields optional)

    ── Primary Evaluator ──
    PrimaryEvalSubmit     → 8 comment columns + performance_group + impact_statement

    ── Secondary/Peer Evaluator ──
    SecondaryPeerSubmit   → impact_statement only

    ── Responses ──
    EvaluatorResponse     → Single evaluator record with name
    ProjectReviewResponse → Full review with nested evaluators
    MyProjectReview       → Employee's view with project info + assignment date

8 Competencies:
    1. Task Execution & Problem Solving
    2. Ownership & Accountability
    3. Project Management and Risk Mitigation
    4. Building Client-Ready Deliverables
    5. Communication & Client/Stakeholder Management
    6. Mentoring and Team Development
    7. Firm Growth
    8. Competency and Skills
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import date, datetime
from app.models.project_review_models import (
    ProjectReviewStatus,
    EvaluatorStatus,
    PerformanceGroup,
)


# =====================================================================
# EMPLOYEE — Self-Review
# =====================================================================

class SelfReviewCreate(BaseModel):
    """
    Full self-review submission. All 8 competencies required.
    project_id and cycle are required; org_id and user_id forced server-side.
    """
    project_id: int
    self_desc_task_execution: str = Field(..., min_length=1, max_length=5000)
    self_desc_ownership: str = Field(..., min_length=1, max_length=5000)
    self_desc_project_management: str = Field(..., min_length=1, max_length=5000)
    self_desc_client_deliverables: str = Field(..., min_length=1, max_length=5000)
    self_desc_communication: str = Field(..., min_length=1, max_length=5000)
    self_desc_mentoring: str = Field(..., min_length=1, max_length=5000)
    self_desc_firm_growth: str = Field(..., min_length=1, max_length=5000)
    self_desc_competency_skills: str = Field(..., min_length=1, max_length=5000)


class SelfReviewDraft(BaseModel):
    """Partial save — employee can fill in competencies one at a time."""
    self_desc_task_execution: Optional[str] = None
    self_desc_ownership: Optional[str] = None
    self_desc_project_management: Optional[str] = None
    self_desc_client_deliverables: Optional[str] = None
    self_desc_communication: Optional[str] = None
    self_desc_mentoring: Optional[str] = None
    self_desc_firm_growth: Optional[str] = None
    self_desc_competency_skills: Optional[str] = None


# =====================================================================
# PRIMARY EVALUATOR
# =====================================================================

class PrimaryEvalSubmit(BaseModel):
    """
    Primary evaluator's full submission — 8 competency comments
    shown side-by-side with the employee's self-descriptions,
    plus a performance group and impact statement.
    """
    performance_group: PerformanceGroup
    impact_statement: str = Field(..., min_length=1, max_length=5000)
    comment_task_execution: str = Field(..., min_length=1, max_length=5000)
    comment_ownership: str = Field(..., min_length=1, max_length=5000)
    comment_project_management: str = Field(..., min_length=1, max_length=5000)
    comment_client_deliverables: str = Field(..., min_length=1, max_length=5000)
    comment_communication: str = Field(..., min_length=1, max_length=5000)
    comment_mentoring: str = Field(..., min_length=1, max_length=5000)
    comment_firm_growth: str = Field(..., min_length=1, max_length=5000)
    comment_competency_skills: str = Field(..., min_length=1, max_length=5000)


# =====================================================================
# SECONDARY / PEER EVALUATOR
# =====================================================================

class SecondaryPeerSubmit(BaseModel):
    """
    Secondary and Peer evaluators only write one impact statement.
    No competency-level comments — lighter feedback.
    """
    impact_statement: str = Field(..., min_length=1, max_length=5000)


# =====================================================================
# RESPONSE SCHEMAS
# =====================================================================

class EvaluatorResponse(BaseModel):
    """Single evaluator record with resolved name."""
    id: int
    evaluator_id: int
    evaluator_name: str
    evaluator_type: str  # Primary, Secondary, Peer
    status: EvaluatorStatus

    performance_group: Optional[str] = None
    impact_statement: Optional[str] = None

    # 8 comment columns — only populated for Primary
    comment_task_execution: Optional[str] = None
    comment_ownership: Optional[str] = None
    comment_project_management: Optional[str] = None
    comment_client_deliverables: Optional[str] = None
    comment_communication: Optional[str] = None
    comment_mentoring: Optional[str] = None
    comment_firm_growth: Optional[str] = None
    comment_competency_skills: Optional[str] = None

    created_at: datetime


class ProjectReviewResponse(BaseModel):
    """
    Full review record with nested evaluator list.
    Used by all views — the route controls which evaluator data
    is included based on the caller's role and visibility rules.
    """
    id: int
    org_id: int
    user_id: int
    project_id: int
    cycle: str
    status: ProjectReviewStatus

    # Employee info (resolved from relationship)
    employee_name: str

    # Project info (resolved from relationship)
    project_name: str
    project_code: str

    # 8 Self-descriptions
    self_desc_task_execution: Optional[str] = None
    self_desc_ownership: Optional[str] = None
    self_desc_project_management: Optional[str] = None
    self_desc_client_deliverables: Optional[str] = None
    self_desc_communication: Optional[str] = None
    self_desc_mentoring: Optional[str] = None
    self_desc_firm_growth: Optional[str] = None
    self_desc_competency_skills: Optional[str] = None

    # Nested evaluator records (visibility-controlled by route)
    evaluators: list[EvaluatorResponse] = []

    is_deleted: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None


class MyProjectReviewCard(BaseModel):
    """
    Lightweight card for the employee's "My Reviews" list.
    Shows project info + assignment context + review status.
    """
    review_id: Optional[int] = None  # null if no review started yet
    project_id: int
    project_name: str
    project_code: str
    project_start_date: Optional[date] = None
    project_end_date: Optional[date] = None
    assigned_date: Optional[date] = None  # When the employee joined the project
    assignment_role: Optional[str] = None
    review_status: Optional[str] = None  # null if no review, "draft" or "submitted"
    primary_submitted: bool = False  # True if Primary evaluator has submitted
    cycle: Optional[str] = None