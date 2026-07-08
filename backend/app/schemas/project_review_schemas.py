"""
Project Review Schemas — Revised PM-Centric Evaluation.

No self-review. The PM writes the evaluation directly.

Schema Map:
    PMEvaluationSubmit       → PM fills 7 competency comments + performance group + impact
    SecondaryEvalSubmit      → Secondary writes impact statement only
    ProjectReviewResponse    → Full review with PM evaluation + secondary feedback
    MyProjectCard            → Employee's view — project info + review status
    PMPendingReviewCard      → PM's queue — team members awaiting evaluation
    RoleExpectationResponse  → Reference data shown to PM during evaluation

7 Competencies:
    1. Task Execution & Problem Solving
    2. Ownership & Accountability
    3. Project Management and Risk Mitigation
    4. Building Client-Ready Deliverables
    5. Communication & Client/Stakeholder Management
    6. Mentoring and Team Development
    7. Competency and Skills
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.project_review_models import (
    PerformanceGroup,
    ProjectReviewStatus,
)

# =====================================================================
# PM EVALUATION
# =====================================================================

class PMEvaluationSubmit(BaseModel):
    """
    PM fills this for each team member. performance_group + impact required.

    Competency comments arrive one of two ways (completeness is enforced in the
    route, since the applicable competencies are department/level-specific):
      - `comments`: the dynamic {competency_id: text} map (the current client) —
        required for custom per-department/level competencies;
      - the legacy fixed comment_* fields (older clients) — still accepted.
    """
    performance_group: PerformanceGroup
    impact_statement: str = Field(..., min_length=1, max_length=5000)
    comments: Optional[dict[int, str]] = None
    comment_task_execution: Optional[str] = Field(default=None, max_length=5000)
    comment_ownership: Optional[str] = Field(default=None, max_length=5000)
    comment_project_management: Optional[str] = Field(default=None, max_length=5000)
    comment_client_deliverables: Optional[str] = Field(default=None, max_length=5000)
    comment_communication: Optional[str] = Field(default=None, max_length=5000)
    comment_mentoring: Optional[str] = Field(default=None, max_length=5000)
    comment_competency_skills: Optional[str] = Field(default=None, max_length=5000)


class PMEvaluationDraft(BaseModel):
    """Partial save for the PM's evaluation. Every field optional so the PM
    can park work mid-thought and pick up later. `comments` is the dynamic
    {competency_id: text} map (current client); the legacy fixed comment_*
    fields are still accepted."""
    performance_group: Optional[PerformanceGroup] = None
    impact_statement: Optional[str] = Field(default=None, max_length=5000)
    comments: Optional[dict[int, str]] = None
    comment_task_execution: Optional[str] = Field(default=None, max_length=5000)
    comment_ownership: Optional[str] = Field(default=None, max_length=5000)
    comment_project_management: Optional[str] = Field(default=None, max_length=5000)
    comment_client_deliverables: Optional[str] = Field(default=None, max_length=5000)
    comment_communication: Optional[str] = Field(default=None, max_length=5000)
    comment_mentoring: Optional[str] = Field(default=None, max_length=5000)
    comment_competency_skills: Optional[str] = Field(default=None, max_length=5000)


# =====================================================================
# SECONDARY EVALUATOR
# =====================================================================

class SecondaryEvalSubmit(BaseModel):
    """Secondary evaluator writes one impact statement only."""
    impact_statement: str = Field(..., min_length=1, max_length=5000)


class SecondaryEvalDraft(BaseModel):
    """Partial save — secondary evaluator can park their impact statement
    mid-thought and resume later."""
    impact_statement: Optional[str] = Field(default=None, max_length=5000)


# =====================================================================
# RESPONSE SCHEMAS
# =====================================================================

class SecondaryEvalResponse(BaseModel):
    """Single secondary evaluator's feedback."""
    id: int
    evaluator_id: int
    evaluator_name: str
    impact_statement: Optional[str] = None
    # "draft" while the evaluator has saved but not yet submitted; "submitted"
    # once finalised. Frontend gates editability on this.
    status: str = "submitted"
    created_at: datetime


class ProjectReviewResponse(BaseModel):
    """
    Full review record. The PM's evaluation is directly on this object
    (not nested in an evaluator sub-record).
    """
    id: int
    org_id: int
    user_id: int
    project_id: int
    reviewer_id: Optional[int] = None
    cycle: str
    status: ProjectReviewStatus

    # Resolved names
    employee_name: str
    reviewer_name: Optional[str] = None
    project_name: str
    project_code: str

    # PM's 7 competency comments (null while pending)
    comment_task_execution: Optional[str] = None
    comment_ownership: Optional[str] = None
    comment_project_management: Optional[str] = None
    comment_client_deliverables: Optional[str] = None
    comment_communication: Optional[str] = None
    comment_mentoring: Optional[str] = None
    comment_competency_skills: Optional[str] = None

    # Dynamic competency comments — {competency_id: text}. The department/
    # level-aware source of truth; the frontend renders boxes from this keyed
    # by the resolved competency set. Mirrors the legacy comment_* fields above
    # for the default set (both are populated). Null on empty placeholder rows;
    # individual values may be null for competencies left blank.
    comments: Optional[dict[str, Optional[str]]] = None

    # The competencies THIS review was written against, resolved by the ids
    # stored in `comments` (so a review always renders by its own framework,
    # including competencies later soft-deleted or re-scoped). Ordered by
    # display_order. Empty for a review with no comments yet — a fresh eval
    # uses the current (department, level) set from GET /competencies instead.
    competencies: "list[CompetencyResponse]" = []

    # PM's summary
    performance_group: Optional[str] = None
    impact_statement: Optional[str] = None

    # Secondary feedback
    secondary_evaluations: list[SecondaryEvalResponse] = []

    created_at: datetime
    updated_at: Optional[datetime] = None


class MyProjectCard(BaseModel):
    """
    Employee's view — their assigned projects with review status.
    No self-review action; just shows pending/reviewed + feedback once available.
    """
    review_id: Optional[int] = None
    project_id: int
    project_name: str
    project_code: str
    project_start_date: Optional[date] = None
    project_expected_end_date: Optional[date] = None
    assigned_date: Optional[date] = None
    assignment_role: Optional[str] = None
    designation_name: Optional[str] = None
    department_name: Optional[str] = None
    # Reviewee's department id + designation level — lets the frontend fetch the
    # applicable competency set (GET /project-reviews/competencies) for this row.
    department_id: Optional[int] = None
    level: Optional[int] = None
    review_status: Optional[str] = None  # null = no review yet, "pending", "reviewed"
    performance_group: Optional[str] = None
    pm_name: Optional[str] = None
    # The secondary evaluator who writes the impact statement (per-member in
    # multi-PM mode, else the project-level secondary). Null when none is set.
    secondary_evaluator_name: Optional[str] = None
    cycle: Optional[str] = None
    has_secondary_submission: bool = False


class PMPendingReviewCard(BaseModel):
    """
    PM's evaluation queue — one card per team member needing evaluation.
    Includes employee info + their role expectations for reference.
    """
    review_id: Optional[int] = None  # null if review row doesn't exist yet
    project_id: int
    project_name: str
    project_code: str
    user_id: int
    employee_name: str
    assignment_role: Optional[str] = None
    department_name: Optional[str] = None
    designation_name: Optional[str] = None
    # Reviewee's department id + designation level — lets the frontend fetch the
    # applicable competency set (GET /project-reviews/competencies) for this row.
    department_id: Optional[int] = None
    level: Optional[int] = None
    assigned_date: Optional[date] = None
    review_status: Optional[str] = None
    performance_group: Optional[str] = None
    # The secondary evaluator who writes the impact statement for this reviewee
    # (per-member in multi-PM mode, else the project-level secondary).
    secondary_evaluator_name: Optional[str] = None
    cycle: Optional[str] = None
    # True iff the row is pending AND the PM has typed any content into
    # it (rating, impact statement, or any per-competency comment). Pre-
    # seeded placeholder pending rows have review_id != null but no
    # content, so the existence of the row alone isn't a draft signal.
    has_draft_content: bool = False


class SecondaryEvalCard(BaseModel):
    """Secondary evaluator's queue — one card per member they must write an
    Impact Statement for.

    Unlike the PM queue, a Secondary can write BEFORE the PM starts, so
    ``review_id`` is None until a ProjectReview row exists (created lazily on
    the first draft/submit). ``review_status`` / ``has_draft_content`` /
    ``existing_impact`` describe the SECONDARY's own progress on this member,
    NOT the PM's review.
    """
    project_id: int
    project_name: str
    project_code: str
    user_id: int
    employee_name: str
    cycle: str
    review_id: Optional[int] = None
    # The secondary's own submission state: "submitted" once they finalise,
    # else "pending" (no impact yet, or only a saved draft).
    review_status: str = "pending"
    # True iff the secondary has a saved-but-unsubmitted draft.
    has_draft_content: bool = False
    # The secondary's own impact text (draft or submitted), for modal prefill.
    existing_impact: Optional[str] = None
    # The reviewed member's department on this project (from their assignment),
    # shown in the queue's Department column.
    department_name: Optional[str] = None
    # The PM's rating. As a reviewer (not the rated employee), the Secondary
    # sees it once the PM finalises the review (status=reviewed); the PM's
    # unsubmitted draft rating stays hidden. Shown as display context.
    performance_group: Optional[str] = None
    # True once the member's PM evaluation is in (review REVIEWED). The
    # Secondary can save a draft anytime but can only SUBMIT after this flips
    # true — the frontend disables Submit (with a note) until then, and the
    # backend enforces the same gate on POST /secondary/{user_id}.
    pm_submitted: bool = False


# =====================================================================
# ROLE EXPECTATIONS
# =====================================================================

class RoleExpectationResponse(BaseModel):
    """
    Reference data shown to the PM while evaluating.
    Contains expected behaviors per competency for a specific
    department × designation combination.
    """
    id: int
    department_name: str
    designation_name: str
    exp_task_execution: Optional[str] = None
    exp_ownership: Optional[str] = None
    exp_project_management: Optional[str] = None
    exp_client_deliverables: Optional[str] = None
    exp_communication: Optional[str] = None
    exp_mentoring: Optional[str] = None
    exp_firm_growth: Optional[str] = None
    exp_competency_skills: Optional[str] = None
    # Dynamic expectations — {competency_id: text}. The frontend matches these
    # to the resolved competency set by id (rather than the fixed exp_* keys),
    # so custom per-department/level competencies can carry their own text.
    # Mirrors the exp_* fields above for the default set; values may be null.
    expectations: Optional[dict[str, Optional[str]]] = None


# =====================================================================
# COMPETENCY FRAMEWORK (department/level-aware)
# =====================================================================

class CompetencyResponse(BaseModel):
    """One competency in a resolved framework set."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    label: str
    display_order: int
    is_reviewable: bool
    # Role-expectation text for this competency at its (department, level).
    # "Not defined" for the org default set (undefined departments).
    expectation: Optional[str] = None


class CompetencySetResponse(BaseModel):
    """The competency set that applies to a (department, level).

    ``is_default`` is True when this (department, level) has no framework of its
    own and the org default set is being returned — the UI surfaces that as
    "not defined for this role (using default)".
    """
    is_default: bool
    competencies: list[CompetencyResponse]


# ProjectReviewResponse.competencies is a forward reference to CompetencyResponse
# (defined above), so resolve it now that the target type exists.
ProjectReviewResponse.model_rebuild()


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

class AdminMemberReviewRow(BaseModel):
    """One row per team member in the admin per-cycle management view."""
    review_id: Optional[int] = None
    user_id: int
    employee_name: str
    assignment_role: Optional[str] = None
    department_name: Optional[str] = None
    review_status: str          # "pending" | "reviewed" | "not_started"
    performance_group: Optional[str] = None


class AdminProjectSummary(BaseModel):
    """Per-project summary card for admin per-cycle management view."""
    project_id: int
    project_name: str
    project_code: str
    pm_name: Optional[str] = None
    total_members: int
    reviewed_count: int
    members: list[AdminMemberReviewRow]
