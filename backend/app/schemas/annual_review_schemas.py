"""
AnnualReview Schemas — The API Contract for the 3-Stage Appraisal.

Schema Map:
    SelfAppraisalCreate   → Stage 1: Employee submits self-descriptions + self_stars
    MentorEvalUpdate      → Stage 2: Mentor submits comments + mentor_stars
    ManagementFinalize    → Stage 3: HR sets final_stars and publishes
    AnnualReviewResponse  → What the frontend receives (all stages)
    CalibrationRow        → Simplified row for the HR calibration grid

The 6 core competencies are:
    1. Ownership          4. Leadership
    2. Productivity       5. Adaptability
    3. Communication      6. Time Management
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.annual_review_models import ReviewStatus


# ── Competency Container (Reusable) ─────────────────────────────────

class SelfDescriptions(BaseModel):
    """The 6 competency self-descriptions written by the employee."""
    self_desc_ownership: str = Field(..., min_length=1, max_length=5000)
    self_desc_productivity: str = Field(..., min_length=1, max_length=5000)
    self_desc_communication: str = Field(..., min_length=1, max_length=5000)
    self_desc_leadership: str = Field(..., min_length=1, max_length=5000)
    self_desc_adaptability: str = Field(..., min_length=1, max_length=5000)
    self_desc_time_management: str = Field(..., min_length=1, max_length=5000)


class MentorComments(BaseModel):
    """The 6 competency comments written by the mentor."""
    mentor_comment_ownership: str = Field(..., min_length=1, max_length=5000)
    mentor_comment_productivity: str = Field(..., min_length=1, max_length=5000)
    mentor_comment_communication: str = Field(..., min_length=1, max_length=5000)
    mentor_comment_leadership: str = Field(..., min_length=1, max_length=5000)
    mentor_comment_adaptability: str = Field(..., min_length=1, max_length=5000)
    mentor_comment_time_management: str = Field(..., min_length=1, max_length=5000)


# ── Stage 1: Employee Self-Appraisal ────────────────────────────────

class SelfAppraisalCreate(SelfDescriptions):
    """
    Payload from the AnnualReviewForm when the employee submits.
    org_id, user_id, mentor_id, and cycle_name are forced server-side.
    """
    self_stars: int = Field(..., ge=1, le=5, description="Self-rating on a 1–5 scale")


class SelfAppraisalDraft(BaseModel):
    """
    Partial save — employee can save progress without submitting.
    All fields are optional so they can save after filling just 2 of 6.
    """
    self_desc_ownership: Optional[str] = None
    self_desc_productivity: Optional[str] = None
    self_desc_communication: Optional[str] = None
    self_desc_leadership: Optional[str] = None
    self_desc_adaptability: Optional[str] = None
    self_desc_time_management: Optional[str] = None
    self_stars: Optional[int] = Field(default=None, ge=1, le=5)


# ── Stage 2: Mentor Evaluation ──────────────────────────────────────

class MentorEvalUpdate(MentorComments):
    """
    Payload from the Mentor's split-screen evaluation form.
    The mentor sees the employee's self-descriptions alongside their own
    input boxes and provides a mentor_stars rating.
    """
    mentor_stars: int = Field(..., ge=1, le=5, description="Mentor rating on a 1–5 scale")


# ── Stage 3: Management Calibration ─────────────────────────────────

class ManagementFinalize(BaseModel):
    """
    Payload from the HR Calibration Grid when Leadership clicks "Publish".
    management_stars is optional (only used if overriding the mentor's score).
    final_stars is the official, locked-in rating.
    """
    management_stars: Optional[int] = Field(default=None, ge=1, le=5)
    final_stars: int = Field(..., ge=1, le=5, description="The official final rating")
    management_comments: Optional[str] = None


# ── Response Schemas ─────────────────────────────────────────────────

class AnnualReviewResponse(BaseModel):
    """
    Full review record returned to the frontend.
    Used by all three stages — the frontend conditionally renders
    sections based on the status field.
    """
    id: int
    org_id: int
    user_id: int
    mentor_id: Optional[int] = None
    cycle_name: str
    status: ReviewStatus

    # Stage 1
    self_desc_ownership: Optional[str] = None
    self_desc_productivity: Optional[str] = None
    self_desc_communication: Optional[str] = None
    self_desc_leadership: Optional[str] = None
    self_desc_adaptability: Optional[str] = None
    self_desc_time_management: Optional[str] = None
    self_stars: Optional[int] = None

    # Stage 2
    mentor_comment_ownership: Optional[str] = None
    mentor_comment_productivity: Optional[str] = None
    mentor_comment_communication: Optional[str] = None
    mentor_comment_leadership: Optional[str] = None
    mentor_comment_adaptability: Optional[str] = None
    mentor_comment_time_management: Optional[str] = None
    mentor_stars: Optional[int] = None

    # Stage 3
    management_stars: Optional[int] = None
    final_stars: Optional[int] = None
    management_comments: Optional[str] = None
    final_rating_enabled: bool = False

    # Metadata
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CalibrationRow(BaseModel):
    """
    Simplified row for the HR Calibration Grid datatable.
    One row per employee — shows names and all three scores side-by-side.
    """
    review_id: int
    user_id: int
    employee_name: str
    department: Optional[str] = None
    designation: Optional[str] = None
    self_stars: Optional[int] = None
    mentor_stars: Optional[int] = None
    management_stars: Optional[int] = None
    final_stars: Optional[int] = None
    status: ReviewStatus
    final_rating_enabled: bool = False


class MenteeAnnualReview(AnnualReviewResponse):
    """
    A mentee's review enriched with employee display info. Used by the
    Mentee Review and Team Review tabs so the mentor can see names,
    department, and designation alongside the review state.
    """
    employee_name: str
    employee_email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None