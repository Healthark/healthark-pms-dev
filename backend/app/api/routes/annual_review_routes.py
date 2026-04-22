"""
AnnualReview Routes — The 3-Stage Appraisal Workflow.

Endpoints:
    ── Stage 1: Employee ──
    POST  /annual-reviews/self              → Create + submit self-appraisal
    PATCH /annual-reviews/{id}/draft        → Save draft (partial, no status change)
    GET   /annual-reviews/mine              → Get current user's review for active cycle

    ── Stage 2: Mentor ──
    GET   /annual-reviews/mentees           → List reviews pending mentor evaluation
    PATCH /annual-reviews/{id}/mentor-eval  → Submit mentor evaluation

    ── Stage 3: Management ──
    GET   /annual-reviews/calibration       → Calibration grid (all org reviews)
    PATCH /annual-reviews/{id}/finalize     → Set final rating + publish

    ── Shared ──
    GET   /annual-reviews/{id}              → Get single review by ID

Security Layers Applied:
    Layer 1 — Authentication:     CurrentUser dependency
    Layer 2 — Tenant Isolation:   All queries filter by org_id
    Layer 3 — Role Authorization: Admin endpoints gated (Mentors use relationship checks)
    Layer 4 — Ownership:          Stage-specific identity checks
"""

from typing import List
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.annual_review_schemas import (
    SelfAppraisalCreate,
    SelfAppraisalDraft,
    MentorEvalUpdate,
    ManagementFinalize,
    AnnualReviewResponse,
    CalibrationRow,
    MenteeAnnualReview,
)
router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """Return the admin-configured active cycle name from SystemSettings."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()

    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured. Contact your HR administrator.",
        )

    return settings.active_cycle_name


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can perform this action.",
        )


# =====================================================================
# STAGE 1 — EMPLOYEE SELF-APPRAISAL
# =====================================================================

@router.post("/self", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal(
    payload: SelfAppraisalCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create and submit the employee's self-appraisal.

    This is a one-shot operation: the review is created with all 6
    competency descriptions + self_stars, and the status immediately
    moves to PENDING_MENTOR. The employee cannot edit after submission.

    The cycle_name is stamped from the active SystemSettings — the
    employee cannot choose which cycle to submit for.
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)

    # Guard: one review per user per cycle
    existing = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You have already submitted a self-appraisal for {cycle_name}.",
        )

    # Resolve the employee's assigned mentor
    mentor_id = current_user.mentor_id

    review = AnnualReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        mentor_id=mentor_id,
        cycle_name=cycle_name,
        status=ReviewStatus.PENDING_MENTOR.value,
        # Stage 1 fields
        self_desc_ownership=payload.self_desc_ownership,
        self_desc_productivity=payload.self_desc_productivity,
        self_desc_communication=payload.self_desc_communication,
        self_desc_leadership=payload.self_desc_leadership,
        self_desc_adaptability=payload.self_desc_adaptability,
        self_desc_time_management=payload.self_desc_time_management,
        self_stars=payload.self_stars,
    )

    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.patch("/{review_id}/draft", response_model=AnnualReviewResponse)
def save_draft(
    review_id: int,
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Save a partial draft — employee can fill in competencies one at a time.
    Only works while the review is in DRAFT status.
    """
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
    ).first()

    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    if review.status != ReviewStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft reviews can be edited.",
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return review


@router.get("/mine", response_model=AnnualReviewResponse)
def get_my_review(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get the current user's annual review for the active cycle.
    Returns 404 if no review exists yet (employee hasn't started).
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)

    review = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No annual review found for the current cycle.",
        )

    # If the review is completed but not published, hide mentor/management data
    # from the employee until final_rating_enabled is True
    if review.user_id == current_user.id and not review.final_rating_enabled:
        if review.status in (ReviewStatus.PENDING_MANAGEMENT.value, ReviewStatus.COMPLETED.value):
            # Employee can see their own self-descriptions but not mentor scores yet
            review.mentor_stars = None
            review.management_stars = None
            review.final_stars = None
            review.management_comments = None

    return review


# =====================================================================
# STAGE 2 — MENTOR EVALUATION
# =====================================================================

@router.get("/mentees", response_model=List[MenteeAnnualReview])
def get_mentee_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all reviews for the current user's direct mentees across all
    cycles and statuses (DRAFT and above). Each row is enriched with
    employee_name / department / designation so the Mentee Review and
    Team Review tabs can render without additional lookups.
    """
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.mentor_id == current_user.id,
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )

    user_ids = [r.user_id for r in reviews]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    rows: list[MenteeAnnualReview] = []
    for r in reviews:
        u = users.get(r.user_id)
        base = AnnualReviewResponse.model_validate(r).model_dump()
        rows.append(MenteeAnnualReview(
            **base,
            employee_name=u.full_name if u else f"Employee #{r.user_id}",
            employee_email=u.email if u else None,
            department=u.department.name if u and u.department else None,
            designation=u.designation.name if u and u.designation else None,
        ))

    return rows


@router.patch("/{review_id}/mentor-eval", response_model=AnnualReviewResponse)
def submit_mentor_evaluation(
    review_id: int,
    payload: MentorEvalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor submits their evaluation for a mentee's self-appraisal.
    Status advances from PENDING_MENTOR → PENDING_MANAGEMENT.
    """
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    if review.status != ReviewStatus.PENDING_MENTOR.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This review is not in the mentor evaluation stage.",
        )

    # Verify the caller is the assigned mentor
    if review.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this review.",
        )

    # Write mentor columns
    review.mentor_comment_ownership = payload.mentor_comment_ownership
    review.mentor_comment_productivity = payload.mentor_comment_productivity
    review.mentor_comment_communication = payload.mentor_comment_communication
    review.mentor_comment_leadership = payload.mentor_comment_leadership
    review.mentor_comment_adaptability = payload.mentor_comment_adaptability
    review.mentor_comment_time_management = payload.mentor_comment_time_management
    review.mentor_stars = payload.mentor_stars

    # Advance status
    review.status = ReviewStatus.PENDING_MANAGEMENT.value

    db.commit()
    db.refresh(review)
    return review


# =====================================================================
# STAGE 3 — MANAGEMENT CALIBRATION & FINALIZATION
# =====================================================================

@router.get("/calibration", response_model=List[CalibrationRow])
def get_calibration_grid(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return all reviews for the active cycle in a simplified grid format
    for HR calibration. Only accessible by Admin role.

    Shows: employee name, department, designation, self/mentor/final stars.
    """
    _require_admin(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
            AnnualReview.status.in_([
                ReviewStatus.PENDING_MANAGEMENT.value,
                ReviewStatus.COMPLETED.value,
            ]),
        )
        .order_by(AnnualReview.created_at.asc())
        .all()
    )

    # Build name/dept/desig map from users
    user_ids = [r.user_id for r in reviews]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    rows: list[CalibrationRow] = []
    for r in reviews:
        u = users.get(r.user_id)
        rows.append(CalibrationRow(
            review_id=r.id,
            user_id=r.user_id,
            employee_name=u.full_name if u else "Unknown",
            department=u.department.name if u and u.department else None,
            designation=u.designation.name if u and u.designation else None,
            self_stars=r.self_stars,
            mentor_stars=r.mentor_stars,
            management_stars=r.management_stars,
            final_stars=r.final_stars,
            status=r.status,
            final_rating_enabled=r.final_rating_enabled,
        ))

    return rows


@router.patch("/{review_id}/finalize", response_model=AnnualReviewResponse)
def finalize_review(
    review_id: int,
    payload: ManagementFinalize,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    HR Admin sets the final rating and publishes the review.

    When final_rating_enabled flips to True:
    - Status changes to COMPLETED
    - The employee can now see all scores (self, mentor, final)
    - The review is permanently locked
    """
    _require_admin(current_user)

    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    if review.status != ReviewStatus.PENDING_MANAGEMENT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only reviews in the management stage can be finalized.",
        )

    review.management_stars = payload.management_stars
    review.final_stars = payload.final_stars
    review.management_comments = payload.management_comments
    review.final_rating_enabled = True
    review.status = ReviewStatus.COMPLETED.value

    db.commit()
    db.refresh(review)
    return review


# =====================================================================
# SHARED — Single Review Lookup
# =====================================================================

@router.get("/{review_id}", response_model=AnnualReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single review by ID. Access control:
    - Employees can see their own review (with score visibility rules)
    - Mentors can see reviews assigned to them
    - Admins can see any review in their org
    """
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    # Access check
    is_owner = review.user_id == current_user.id
    is_mentor = review.mentor_id == current_user.id
    is_admin = current_user.role == "Admin"

    if not (is_owner or is_mentor or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    # Hide mentor/management scores from the employee until published
    if is_owner and not is_admin and not review.final_rating_enabled:
        review.mentor_stars = None
        review.management_stars = None
        review.final_stars = None
        review.management_comments = None

    return review