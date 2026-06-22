"""
AnnualReview Routes — The 3-Stage Appraisal Workflow.

Endpoints:
    ── Stage 1: Employee ──
    POST  /annual-reviews/self              → Create + submit self-review
    PATCH /annual-reviews/{id}/draft        → Save draft (partial, no status change)
    GET   /annual-reviews/mine              → Active-cycle review (404 if none)
    GET   /annual-reviews/mine/history      → All reviews owned by current user

    ── Stage 2: Mentor ──
    GET   /annual-reviews/mentees           → Reviews for mentor's direct mentees
    PATCH /annual-reviews/{id}/mentor-eval  → Submit mentor evaluation

    ── Stage 3: Management ──
    GET   /annual-reviews/calibration            → Calibration grid (all org reviews)
    PATCH /annual-reviews/{id}/management-rating → Set/override management rating inline

    ── Shared ──
    GET   /annual-reviews/{id}              → Get single review by ID

Security Layers:
    Layer 1 — Authentication:     CurrentUser dependency
    Layer 2 — Tenant Isolation:   All queries filter by org_id
    Layer 3 — Role Authorization: Admin endpoints gated
    Layer 4 — Ownership:          Stage-specific identity checks
    Layer 5 — Visibility Gate:    final_performance_rating is hidden from the
                                   employee unless BOTH the per-row
                                   final_rating_enabled AND the org-wide
                                   annual_review_final_rating_visible flags
                                   are True.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from app.api.dependencies import CurrentUser, DbSession
from app.core.cycle_utils import (
    _fy_label_of_review,
    extract_fy_label,
    get_year_override,
)
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.notification_models import NotificationCategory
from app.models.reference_models import Department, Designation
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.services.notifications import create_notification
from app.schemas.annual_review_schemas import (
    AnnualReviewFunnel,
    AnnualReviewResponse,
    CalibrationFilterOptions,
    CalibrationRow,
    ManagementRatingUpdate,
    MenteeAnnualReview,
    MentorEvalDraft,
    MentorEvalUpdate,
    SelfAppraisalCreate,
    SelfAppraisalDraft,
)
from app.schemas.pagination import Page, PaginationParams

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_settings(db: DbSession, org_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured. Contact your HR administrator.",
        )
    return settings


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """
    Annual reviews are always yearly regardless of the org's cadence, so we
    strip any H1/H2/Q1–Q4 prefix and return just the fiscal-year label
    (e.g. "H1 FY26" → "FY26"). This also enforces the one-review-per-year
    rule that the UI and unique index depend on.
    """
    return extract_fy_label(_get_settings(db, org_id).active_cycle_name)


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can perform this action.",
        )


def _require_management(current_user: User) -> None:
    """Management sub-role — always paired with Admin. Gates the Management
    Review tab's read/write endpoints so that regular admins (HR ops) cannot
    set or override management ratings."""
    if current_user.role != "Admin" or not bool(current_user.is_management):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only management users can perform this action.",
        )


def _require_reviews_open(db: DbSession, org_id: int, fy_label: Optional[str]) -> None:
    """Raise 403 when annual-review writes are closed for `fy_label` (per-FY).

    Net-new gate (decision #5): EVERY state-changing review endpoint —
    self-review create / draft / submit, mentor evaluation submit / draft,
    and the management rating publish — checks this for the review's own FY.
      - No resolvable fy_label → 400.
      - Missing override row OR annual_reviews_enabled False → 403
        (default-deny: a year is closed until an Admin opens it).
    """
    if not fy_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot determine the fiscal year for this review.",
        )
    override = get_year_override(db, org_id, fy_label)
    if override is None or not override.annual_reviews_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Annual review submissions for {fy_label} are currently closed. "
                "Please wait for the Admin to open the review window."
            ),
        )


def _final_rating_visible(
    db: DbSession,
    org_id: int,
    review: AnnualReview,
    active_fy_label: str,
) -> bool:
    """Per-FY visibility of an employee's final rating.

    - Current FY (review's FY == the active FY): visible only when this
      FY's `annual_review_final_rating_visible` toggle is True.
    - Past (or any other) FY: always passes through — closing the current
      year never retroactively hides a finalized prior year.

    The per-row `final_rating_enabled` flag is enforced separately by the
    caller, so this answers only the per-FY visibility question.
    """
    review_fy = _fy_label_of_review(review)
    if review_fy == active_fy_label:
        override = get_year_override(db, org_id, review_fy)
        return bool(override and override.annual_review_final_rating_visible)
    return True


def _strip_private_ratings(
    db: DbSession,
    org_id: int,
    review: AnnualReview,
    active_fy_label: str,
) -> None:
    """
    Mutates `review` in-place to hide ratings an employee shouldn't see yet.

    User-side display rule: final_performance_rating in the response is
    synthesized as management_performance_rating ?? mentor_performance_rating
    — the stored final_performance_rating column (HR's legacy override path)
    is not surfaced. The fallback is gated by the per-row
    final_rating_enabled AND the per-FY visibility decision (see
    `_final_rating_visible`) so unfinalized / closed-year reviews never leak.

    Mentor draft text/rating are ALWAYS stripped — the mentee should not
    see in-progress mentor work, regardless of FY.
    """
    mgmt = review.management_performance_rating
    mentor = review.mentor_performance_rating
    review.mentor_performance_rating = None
    review.management_performance_rating = None
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None
    final_visible = _final_rating_visible(db, org_id, review, active_fy_label)
    if review.final_rating_enabled and final_visible:
        review.final_performance_rating = mgmt if mgmt is not None else mentor
    else:
        review.final_performance_rating = None


# =====================================================================
# STAGE 1 — EMPLOYEE SELF-REVIEW
# =====================================================================

def _notify_annual_self_submitted(
    db: DbSession, employee: User, review: AnnualReview
) -> None:
    """In-app notice to the review's mentor that a self-review awaits their
    evaluation. No-op when the review has no mentor on record."""
    if review.mentor_id is None:
        return
    create_notification(
        db,
        org_id=review.org_id,
        recipient_id=review.mentor_id,
        category=NotificationCategory.PERSONAL.value,
        type="annual_self_submitted",
        title="Annual self-review submitted",
        body=(
            f"{employee.full_name} submitted their {review.cycle_name} "
            f"self-review — your evaluation is needed."
        ),
        link="/annual-reviews?tab=team",
        entity_type="annual_review",
        entity_id=review.id,
        actor_id=employee.id,
    )


@router.post("/self", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal(
    payload: SelfAppraisalCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Submit the employee's self-review. If a draft row already exists for
    the user/cycle, promote it to PENDING_MENTOR with the submitted payload.
    Otherwise create a new row directly in PENDING_MENTOR.

    cycle_name is stamped from SystemSettings — the employee cannot pick.
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)
    _require_reviews_open(db, current_user.org_id, cycle_name)

    existing = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()
    if existing and existing.status != ReviewStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You have already submitted a self-review for {cycle_name}.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.self_overall_review = payload.self_overall_review
        existing.self_performance_rating = payload.self_performance_rating
        existing.status = ReviewStatus.PENDING_MENTOR.value
        _notify_annual_self_submitted(db, current_user, existing)
        db.commit()
        db.refresh(existing)
        return existing

    mentor_id = current_user.mentor_id
    review = AnnualReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        mentor_id=mentor_id,
        cycle_name=cycle_name,
        status=ReviewStatus.PENDING_MENTOR.value,
        self_overall_review=payload.self_overall_review,
        self_performance_rating=payload.self_performance_rating,
    )
    db.add(review)
    try:
        db.flush()  # assign review.id before the notification references it
        _notify_annual_self_submitted(db, current_user, review)
        db.commit()
    except IntegrityError:
        # A concurrent submit raced us to the unique (org, user, cycle) row.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You have already submitted a self-review for {cycle_name}.",
        )
    db.refresh(review)
    return review


@router.post("/self/draft", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal_draft(
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create a new annual self-review in DRAFT state. The employee can
    revisit it via PATCH /draft and submit later via POST /self.

    409 if a row already exists for the user/cycle (use the PATCH /draft
    endpoint to update an existing draft).
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)
    _require_reviews_open(db, current_user.org_id, cycle_name)

    existing = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A review for {cycle_name} already exists; use PATCH /draft "
                f"to update an in-progress draft."
            ),
        )

    review = AnnualReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        mentor_id=current_user.mentor_id,
        cycle_name=cycle_name,
        status=ReviewStatus.DRAFT.value,
        self_overall_review=payload.self_overall_review,
        self_performance_rating=payload.self_performance_rating,
    )
    db.add(review)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request created the row first (unique org/user/cycle).
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A review for {cycle_name} already exists; use PATCH /draft "
                f"to update an in-progress draft."
            ),
        )
    db.refresh(review)
    return review


@router.patch("/{review_id}/draft", response_model=AnnualReviewResponse)
def save_draft(
    review_id: int,
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """Save a partial draft. Only works while status is DRAFT."""
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
    _require_reviews_open(db, current_user.org_id, _fy_label_of_review(review))

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
    Current user's review for the active cycle. 404 if not started yet.
    Ratings are filtered per the visibility rules above.
    """
    settings = _get_settings(db, current_user.org_id)
    cycle_name = extract_fy_label(settings.active_cycle_name)
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

    _strip_private_ratings(db, current_user.org_id, review, cycle_name)
    return review


@router.get("/mine/history", response_model=List[AnnualReviewResponse])
def get_my_review_history(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    All annual reviews owned by the current user, sorted newest-first.
    Used by the "My Review" tab to show past cycles alongside the current one.
    Ratings are filtered per visibility rules.
    """
    settings = _get_settings(db, current_user.org_id)
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.user_id == current_user.id,
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )
    active_fy = extract_fy_label(settings.active_cycle_name)
    for r in reviews:
        _strip_private_ratings(db, current_user.org_id, r, active_fy)
    return reviews


# =====================================================================
# STAGE 2 — MENTOR EVALUATION
# =====================================================================

def _is_current_mentor(db: DbSession, review: AnnualReview, current_user: User) -> bool:
    """True iff the caller is the mentee's CURRENT mentor (live relationship),
    regardless of who was stamped on the review at submit time.

    Access follows the live mentor link so a reassigned mentor immediately
    inherits the mentee's in-flight AND historical reviews — exactly like a
    regular mentor. `review.mentor_id` is kept only as attribution of who
    actually evaluated, not as the access gate."""
    mentee = db.query(User).filter(User.id == review.user_id).first()
    return mentee is not None and mentee.mentor_id == current_user.id


@router.get("/mentees", response_model=List[MenteeAnnualReview])
def get_mentee_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    All reviews for the current user's direct mentees across every cycle/status.
    Each row is enriched with employee_name / department / designation.
    Final ratings are nulled when the org-wide visibility flag is off so the
    Mentee Review tab can conditionally hide the Ratings column.

    Listed by the mentee's LIVE `User.mentor_id` (not the frozen
    `AnnualReview.mentor_id`), so a newly-assigned mentor sees their mentees'
    full review history and a former mentor stops seeing ex-mentees.
    """
    settings = _get_settings(db, current_user.org_id)
    reviews = (
        db.query(AnnualReview)
        .join(User, User.id == AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            User.mentor_id == current_user.id,
            User.is_deleted == False,  # noqa: E712 — hide deactivated mentees
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )

    user_ids = [r.user_id for r in reviews]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    active_fy = extract_fy_label(settings.active_cycle_name)
    rows: list[MenteeAnnualReview] = []
    for r in reviews:
        base = AnnualReviewResponse.model_validate(r).model_dump()
        if not _final_rating_visible(db, current_user.org_id, r, active_fy):
            base["final_performance_rating"] = None
            base["management_performance_rating"] = None
        u = users.get(r.user_id)
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
    background_tasks: BackgroundTasks,
):
    """Mentor submits their evaluation. Status: PENDING_MENTOR → PENDING_MANAGEMENT.
    Any saved mentor draft is cleared; the submitted payload becomes final."""
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
    if not _is_current_mentor(db, review, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the current mentor for this employee.",
        )
    _require_reviews_open(db, current_user.org_id, _fy_label_of_review(review))

    review.mentor_overall_review = payload.mentor_overall_review
    review.mentor_performance_rating = payload.mentor_performance_rating
    # Stamp the actual evaluator (attribution) — may differ from the mentor
    # stamped at self-submit time if the mentee was reassigned mid-cycle.
    review.mentor_id = current_user.id
    # Clear any draft scratchpad — the final cols are now authoritative.
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None

    review.status = ReviewStatus.PENDING_MANAGEMENT.value

    # Notify the employee their mentor evaluation is in (in-app + email).
    # Generic body — the mentee must NOT see the rating/text yet.
    employee = db.query(User).filter(User.id == review.user_id).first()
    create_notification(
        db,
        org_id=review.org_id,
        recipient_id=review.user_id,
        category=NotificationCategory.PERSONAL.value,
        type="annual_mentor_eval_submitted",
        title="Mentor evaluation submitted",
        body=(
            f"{current_user.full_name} completed your {review.cycle_name} "
            f"mentor evaluation. It's now with management for calibration."
        ),
        link="/annual-reviews",
        entity_type="annual_review",
        entity_id=review.id,
        actor_id=current_user.id,
        email=True,
        background_tasks=background_tasks,
        recipient_email=employee.email if employee else None,
        cta_label="View review",
        email_subject=(
            f"Mentor Evaluation Submitted: {current_user.full_name} "
            f"({review.cycle_name})"
        ),
        recipient_name=employee.full_name if employee else None,
        email_intro=(
            f"{current_user.full_name} has completed your {review.cycle_name} "
            f"mentor evaluation. It is now with management for calibration."
        ),
        email_details=[
            ("Submitted By", current_user.full_name),
            ("Review Cycle", review.cycle_name),
            ("Submitted On", datetime.now(timezone.utc).strftime("%b %d, %Y")),
            ("Status", "Pending Management Calibration"),
        ],
        snapshot_title="Evaluation Snapshot",
    )

    db.commit()
    db.refresh(review)
    return review


@router.patch("/{review_id}/mentor-draft", response_model=AnnualReviewResponse)
def save_mentor_draft(
    review_id: int,
    payload: MentorEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor saves an in-progress evaluation without submitting. Writes only
    the *_draft columns; the row's `status` stays PENDING_MENTOR so the
    mentee never sees premature mentor content. The Submit endpoint
    (PATCH /mentor-eval) clears these and advances status.
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
    if not _is_current_mentor(db, review, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the current mentor for this employee.",
        )
    _require_reviews_open(db, current_user.org_id, _fy_label_of_review(review))

    # Stamp the current mentor as the working evaluator (attribution stays
    # truthful after a mid-cycle reassignment).
    review.mentor_id = current_user.id

    # Apply only fields the client included so partial saves don't wipe
    # work the mentor previously stored.
    data = payload.model_dump(exclude_unset=True)
    if "mentor_overall_review" in data:
        review.mentor_overall_review_draft = data["mentor_overall_review"]
    if "mentor_performance_rating" in data:
        review.mentor_performance_rating_draft = data["mentor_performance_rating"]

    db.commit()
    db.refresh(review)
    return review


# =====================================================================
# STAGE 3 — MANAGEMENT CALIBRATION & FINALIZATION
# =====================================================================

# Maps the FE `sort_by` query value to a callable returning the SQL
# column to sort on, given the (Employee, Mentor) aliases. `department`
# is handled separately in the route because it sorts on the joined
# Department alias. Anything not in this map (or `department`) falls back
# to the default created_at order — so a bad sort_by never 500s.
_CALIBRATION_SORT_COLUMNS = {
    "employee_name": lambda E, M: E.full_name,
    "employee_email": lambda E, M: E.email,
    "mentor_name": lambda E, M: M.full_name,
    "self_performance_rating": lambda E, M: AnnualReview.self_performance_rating,
    "mentor_performance_rating": lambda E, M: AnnualReview.mentor_performance_rating,
    "management_performance_rating": lambda E, M: AnnualReview.management_performance_rating,
}


def _calibration_base_query(db, org_id: int, cycle_name: Optional[str]):
    """Base calibration query joined to employee + mentor + employee's
    department/designation via aliases, so we can filter/sort/search on
    the resolved display names in SQL (not post-query in Python).

    `cycle_name` scopes to one fiscal year; pass None for every year (the
    "all" view, used by the year filter and by the dropdown-options query).

    Returns (query, Employee, Mentor, EmpDept, EmpDesig) so callers can
    reference the aliases for filtering and ordering.
    """
    Employee = aliased(User)
    Mentor = aliased(User)
    EmpDept = aliased(Department)
    EmpDesig = aliased(Designation)

    query = (
        db.query(AnnualReview, Employee, Mentor, EmpDept, EmpDesig)
        .join(Employee, AnnualReview.user_id == Employee.id)
        .outerjoin(Mentor, AnnualReview.mentor_id == Mentor.id)
        .outerjoin(EmpDept, Employee.department_id == EmpDept.id)
        .outerjoin(EmpDesig, Employee.designation_id == EmpDesig.id)
        .filter(
            AnnualReview.org_id == org_id,
            Employee.is_deleted == False,  # noqa: E712 — exclude deactivated employees
            AnnualReview.status.in_([
                ReviewStatus.PENDING_MANAGEMENT.value,
                ReviewStatus.COMPLETED.value,
            ]),
        )
    )
    if cycle_name is not None:
        query = query.filter(AnnualReview.cycle_name == cycle_name)
    return query, Employee, Mentor, EmpDept, EmpDesig


def _resolve_calibration_cycle(
    db: DbSession, org_id: int, year: Optional[str]
) -> Optional[str]:
    """Map the calibration `year` query param to a cycle_name filter.

        None / ""  → the active cycle's FY label (default view).
        "all"      → None  (no year filter — every fiscal year).
        "FY25-26"  → that label, as stored on AnnualReview.cycle_name.
    """
    if not year:
        return _get_active_cycle(db, org_id)
    if year.strip().lower() == "all":
        return None
    return year.strip()


# Mentor-filter sentinel: matches reviews whose employee has no mentor.
_NO_MENTOR_SENTINEL = "(No mentor)"


@router.get("/calibration", response_model=Page[CalibrationRow])
def get_calibration_grid(
    db: DbSession,
    current_user: CurrentUser,
    pg: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Matches employee name/email, mentor, or department"),
    employee: Optional[str] = Query(None, description="Exact employee name"),
    department: Optional[str] = Query(None, description="Exact department name"),
    designation: Optional[str] = Query(None, description="Exact designation name"),
    mentor: Optional[str] = Query(
        None, description="Exact mentor name, or '(No mentor)' for unmentored employees"
    ),
    status_filter: Optional[str] = Query(
        None, alias="status", description="all | pending | rated"
    ),
    year: Optional[str] = Query(
        None,
        description="FY label (e.g. 'FY25-26') | 'all' | omitted (active cycle)",
    ),
    sort_by: Optional[str] = Query(None, description="CalibrationRow field name"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    """
    Paginated calibration grid (pending_management + completed reviews).
    Management-only.

    Scoped to the active cycle by default; pass `year=<FY label>` to view a
    past year or `year=all` to span every fiscal year. Server-side search /
    department / mentor / status filtering + sort + offset pagination so the
    FE never holds the full org review set in memory. Filter-dropdown option
    lists (incl. the year list) come from GET /calibration/filter-options.
    """
    _require_management(current_user)
    cycle_name = _resolve_calibration_cycle(db, current_user.org_id, year)

    query, Employee, Mentor, EmpDept, EmpDesig = _calibration_base_query(
        db, current_user.org_id, cycle_name
    )

    # ── Filters (applied in SQL, BEFORE pagination) ──────────────────
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Employee.full_name.ilike(term),
                Employee.email.ilike(term),
                Mentor.full_name.ilike(term),
                EmpDept.name.ilike(term),
            )
        )
    if employee:
        query = query.filter(Employee.full_name == employee)
    if department:
        query = query.filter(EmpDept.name == department)
    if designation:
        query = query.filter(EmpDesig.name == designation)
    if mentor == _NO_MENTOR_SENTINEL:
        query = query.filter(AnnualReview.mentor_id.is_(None))
    elif mentor:
        query = query.filter(Mentor.full_name == mentor)
    if status_filter == "pending":
        query = query.filter(AnnualReview.management_performance_rating.is_(None))
    elif status_filter == "rated":
        query = query.filter(AnnualReview.management_performance_rating.isnot(None))

    # Total across all pages (after filtering, before offset/limit).
    total = query.order_by(None).count()

    # ── Sort (with a stable `id` tiebreaker so offset paging is
    # deterministic across requests) ─────────────────────────────────
    sort_col = None
    if sort_by == "department":
        sort_col = EmpDept.name
    elif sort_by in _CALIBRATION_SORT_COLUMNS:
        sort_col = _CALIBRATION_SORT_COLUMNS[sort_by](Employee, Mentor)
    if sort_col is not None:
        direction = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
        query = query.order_by(direction, AnnualReview.id.asc())
    else:
        # Default order mirrors the pre-pagination behaviour.
        query = query.order_by(AnnualReview.created_at.asc(), AnnualReview.id.asc())

    # ── Page slice ───────────────────────────────────────────────────
    rows_raw = query.offset(pg.offset).limit(pg.limit).all()

    items = [
        CalibrationRow(
            review_id=r.id,
            user_id=r.user_id,
            cycle_name=r.cycle_name,
            employee_name=emp.full_name if emp else "Unknown",
            employee_email=emp.email if emp else None,
            mentor_name=men.full_name if men else None,
            department=dept.name if dept else None,
            designation=desig.name if desig else None,
            self_performance_rating=r.self_performance_rating,
            mentor_performance_rating=r.mentor_performance_rating,
            management_performance_rating=r.management_performance_rating,
            final_performance_rating=r.final_performance_rating,
            status=r.status,
            final_rating_enabled=r.final_rating_enabled,
        )
        for (r, emp, men, dept, desig) in rows_raw
    ]

    return Page[CalibrationRow](
        items=items, total=total, page=pg.page, per_page=pg.per_page
    )


@router.get("/calibration/filter-options", response_model=CalibrationFilterOptions)
def get_calibration_filter_options(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Distinct department + mentor names + fiscal years across the org's
    calibration set. Drives the grid's filter dropdowns. Management-only.

    Spans ALL years (cycle_name=None) so the department/mentor/year lists
    stay valid no matter which year the grid is filtered to. The active
    cycle's FY label is always included in `years` (and returned as
    `active_year`) so the default selection always has a matching option.
    """
    _require_management(current_user)
    active_year = _get_active_cycle(db, current_user.org_id)

    query, Employee, Mentor, EmpDept, EmpDesig = _calibration_base_query(
        db, current_user.org_id, None
    )
    rows = query.with_entities(
        Employee.full_name,
        EmpDept.name,
        EmpDesig.name,
        Mentor.full_name,
        AnnualReview.cycle_name,
    ).all()

    employees = sorted({e for (e, _d, _g, _m, _c) in rows if e})
    departments = sorted({d for (_e, d, _g, _m, _c) in rows if d})
    designations = sorted({g for (_e, _d, g, _m, _c) in rows if g})
    mentors = sorted({m for (_e, _d, _g, m, _c) in rows if m})
    # Newest year first. Include the active year even if it has no reviews
    # yet so the dropdown's default option always renders.
    year_set = {c for (_e, _d, _g, _m, c) in rows if c}
    year_set.add(active_year)
    years = sorted(year_set, reverse=True)
    return CalibrationFilterOptions(
        employees=employees,
        departments=departments,
        designations=designations,
        mentors=mentors,
        years=years,
        active_year=active_year,
    )


@router.get("/all", response_model=List[CalibrationRow])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Admin-only org-wide annual-review listing — every submitted review for
    every active employee across every fiscal year. The All Reviews tab's
    data source; mirrors the All Goals tab so HR/management can audit the
    full review universe, not just the calibration-stage subset the
    calibration grid shows (pending_management + completed).

    Drafts (employee-private WIP) and deactivated employees are excluded from
    the real rows. Ratings are NOT stripped — admins see the finalized picture,
    consistent with the product decision that admins may view management
    ratings.

    For the ACTIVE cycle, synthetic `not_started` rows are appended for every
    active employee with no review row yet, so the roster shows who hasn't
    started. (A draft counts as started and stays private.) Past cycles get
    no synthetic rows — the current roster may differ from who was active then,
    so a "not started" past-year row would be misleading.

    Returns every year; the FE filters + paginates client-side and defaults
    its Year filter to the active cycle (the All Goals pattern).
    """
    _require_admin(current_user)
    active_cycle = _get_active_cycle(db, current_user.org_id)

    Employee = aliased(User)
    Mentor = aliased(User)
    EmpDept = aliased(Department)
    EmpDesig = aliased(Designation)

    # ── Real reviews: every non-draft review across all fiscal years ─────
    rows_raw = (
        db.query(AnnualReview, Employee, Mentor, EmpDept, EmpDesig)
        .join(Employee, AnnualReview.user_id == Employee.id)
        .outerjoin(Mentor, AnnualReview.mentor_id == Mentor.id)
        .outerjoin(EmpDept, Employee.department_id == EmpDept.id)
        .outerjoin(EmpDesig, Employee.designation_id == EmpDesig.id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            Employee.is_deleted == False,  # noqa: E712 — exclude deactivated employees
            AnnualReview.status != ReviewStatus.DRAFT.value,
        )
        .all()
    )
    rows = [
        CalibrationRow(
            review_id=r.id,
            user_id=r.user_id,
            cycle_name=r.cycle_name,
            employee_name=emp.full_name if emp else "Unknown",
            employee_email=emp.email if emp else None,
            mentor_name=men.full_name if men else None,
            department=dept.name if dept else None,
            designation=desig.name if desig else None,
            self_performance_rating=r.self_performance_rating,
            mentor_performance_rating=r.mentor_performance_rating,
            management_performance_rating=r.management_performance_rating,
            final_performance_rating=r.final_performance_rating,
            status=r.status,
            final_rating_enabled=r.final_rating_enabled,
        )
        for (r, emp, men, dept, desig) in rows_raw
    ]

    # ── Synthetic "not started" rows for the active cycle ────────────────
    # Any active-cycle row (incl. a draft) counts as started.
    started_ids = {
        uid
        for (uid,) in db.query(AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_cycle,
        )
        .all()
    }
    emp_rows = (
        db.query(Employee, Mentor, EmpDept, EmpDesig)
        .outerjoin(Mentor, Employee.mentor_id == Mentor.id)
        .outerjoin(EmpDept, Employee.department_id == EmpDept.id)
        .outerjoin(EmpDesig, Employee.designation_id == EmpDesig.id)
        .filter(
            Employee.org_id == current_user.org_id,
            Employee.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    for (emp, men, dept, desig) in emp_rows:
        if emp.id in started_ids:
            continue
        rows.append(
            CalibrationRow(
                review_id=None,
                user_id=emp.id,
                cycle_name=active_cycle,
                employee_name=emp.full_name,
                employee_email=emp.email,
                mentor_name=men.full_name if men else None,
                department=dept.name if dept else None,
                designation=desig.name if desig else None,
                self_performance_rating=None,
                mentor_performance_rating=None,
                management_performance_rating=None,
                final_performance_rating=None,
                status=ReviewStatus.NOT_STARTED,
                final_rating_enabled=False,
            )
        )

    # Employee asc, then cycle desc within an employee (two-pass stable sort).
    rows.sort(key=lambda x: x.cycle_name, reverse=True)
    rows.sort(key=lambda x: x.employee_name.lower())
    return rows


@router.get("/funnel", response_model=AnnualReviewFunnel)
def get_review_funnel(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Admin-only annual-review progress for the active cycle — powers the
    dashboard "Annual Review Progress" card. `total` is the active employee
    headcount; `not_started` is that headcount minus the employees who have
    a review row (any status, incl. draft) for the active cycle, so the five
    stages always sum to `total`.

    Tolerant of an unconfigured cycle: returns an all-zero funnel with
    cycle_name=None rather than 400, so the dashboard card can render an
    empty state instead of erroring.
    """
    _require_admin(current_user)

    settings = (
        db.query(SystemSettings)
        .filter(SystemSettings.org_id == current_user.org_id)
        .first()
    )
    active_cycle = (
        extract_fy_label(settings.active_cycle_name)
        if settings and settings.active_cycle_name
        else None
    )
    if active_cycle is None:
        return AnnualReviewFunnel(
            cycle_name=None, total=0, not_started=0, draft=0,
            pending_mentor=0, pending_management=0, completed=0,
        )

    total = (
        db.query(func.count(User.id))
        .filter(
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        )
        .scalar()
    ) or 0

    status_rows = (
        db.query(AnnualReview.status, func.count(AnnualReview.id))
        .join(User, AnnualReview.user_id == User.id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_cycle,
            User.is_deleted == False,  # noqa: E712
        )
        .group_by(AnnualReview.status)
        .all()
    )
    counts = {s: c for (s, c) in status_rows}
    draft = counts.get(ReviewStatus.DRAFT.value, 0)
    pending_mentor = counts.get(ReviewStatus.PENDING_MENTOR.value, 0)
    pending_management = counts.get(ReviewStatus.PENDING_MANAGEMENT.value, 0)
    completed = counts.get(ReviewStatus.COMPLETED.value, 0)
    not_started = max(0, total - (draft + pending_mentor + pending_management + completed))

    return AnnualReviewFunnel(
        cycle_name=active_cycle,
        total=total,
        not_started=not_started,
        draft=draft,
        pending_mentor=pending_mentor,
        pending_management=pending_management,
        completed=completed,
    )


@router.patch("/{review_id}/management-rating", response_model=AnnualReviewResponse)
def set_management_rating(
    review_id: int,
    payload: ManagementRatingUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Management-only "Publish Rating" action from the Management Review tab.

    Sets (or updates) management_performance_rating, unlocks the per-row
    final_rating_enabled flag so the user-side fallback
    (management ?? mentor) becomes visible — still subject to the org-wide
    annual_review_final_rating_visible gate — and transitions the row to
    COMPLETED. Already-completed rows can be re-published to adjust the
    rating; the status assignment is idempotent in that case.
    """
    _require_management(current_user)

    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if review.status not in (
        ReviewStatus.PENDING_MANAGEMENT.value,
        ReviewStatus.COMPLETED.value,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Management rating can only be set after mentor evaluation is submitted.",
        )
    _require_reviews_open(db, current_user.org_id, _fy_label_of_review(review))

    review.management_performance_rating = payload.management_performance_rating
    review.final_rating_enabled = True
    review.status = ReviewStatus.COMPLETED.value

    # Notify the employee their review is finalized (in-app only). Fires on
    # every publish — including a re-publish that adjusts the rating — so the
    # employee always learns of a change. The body carries NO rating value;
    # visibility of the number is governed by the per-FY
    # annual_review_final_rating_visible gate.
    create_notification(
        db,
        org_id=review.org_id,
        recipient_id=review.user_id,
        category=NotificationCategory.PERSONAL.value,
        type="annual_management_published",
        title="Annual review finalized",
        body=f"Your {review.cycle_name} performance review has been finalized.",
        link="/annual-reviews",
        entity_type="annual_review",
        entity_id=review.id,
        actor_id=current_user.id,
    )

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
    Single review by ID. Access control:
    - Employees can see their own review (with visibility rules applied)
    - Mentors can see reviews assigned to them
    - Admins can see any review in their org
    """
    settings = _get_settings(db, current_user.org_id)
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    is_owner = review.user_id == current_user.id
    is_mentor = _is_current_mentor(db, review, current_user)
    is_admin = current_user.role == "Admin"

    if not (is_owner or is_mentor or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    active_fy = extract_fy_label(settings.active_cycle_name)
    if is_owner and not is_admin:
        _strip_private_ratings(db, current_user.org_id, review, active_fy)

    return review
