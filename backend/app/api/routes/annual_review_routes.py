"""
AnnualReview Routes — The 3-Stage Appraisal Workflow.

Endpoints:
    ── Stage 1: Employee ──
    POST  /annual-reviews/self              → Create + submit self-appraisal
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

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, CurrentUser
from app.core.cycle_utils import extract_fy_label
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.reference_models import Department, Designation
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.annual_review_schemas import (
    SelfAppraisalCreate,
    SelfAppraisalDraft,
    MentorEvalUpdate,
    MentorEvalDraft,
    ManagementRatingUpdate,
    AnnualReviewResponse,
    CalibrationRow,
    CalibrationFilterOptions,
    MenteeAnnualReview,
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


def _strip_private_ratings(review: AnnualReview, final_visible: bool) -> None:
    """
    Mutates `review` in-place to hide ratings an employee shouldn't see yet.

    User-side display rule: final_performance_rating in the response is
    synthesized as management_performance_rating ?? mentor_performance_rating
    — the stored final_performance_rating column (HR's legacy override path)
    is not surfaced. The fallback is still strictly gated by the per-row
    final_rating_enabled AND the org-wide visibility flag so unfinalized
    reviews never leak.

    Mentor draft text/rating are also stripped — the mentee should not
    see in-progress mentor work.
    """
    mgmt = review.management_performance_rating
    mentor = review.mentor_performance_rating
    review.mentor_performance_rating = None
    review.management_performance_rating = None
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None
    if review.final_rating_enabled and final_visible:
        review.final_performance_rating = mgmt if mgmt is not None else mentor
    else:
        review.final_performance_rating = None


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
    Submit the employee's self-appraisal. If a draft row already exists for
    the user/cycle, promote it to PENDING_MENTOR with the submitted payload.
    Otherwise create a new row directly in PENDING_MENTOR.

    cycle_name is stamped from SystemSettings — the employee cannot pick.
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)

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
    db.commit()
    db.refresh(review)
    return review


@router.post("/self/draft", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal_draft(
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create a new annual self-appraisal in DRAFT state. The employee can
    revisit it via PATCH /draft and submit later via POST /self.

    409 if a row already exists for the user/cycle (use the PATCH /draft
    endpoint to update an existing draft).
    """
    cycle_name = _get_active_cycle(db, current_user.org_id)

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

    _strip_private_ratings(review, settings.annual_review_final_rating_visible)
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
    for r in reviews:
        _strip_private_ratings(r, settings.annual_review_final_rating_visible)
    return reviews


# =====================================================================
# STAGE 2 — MENTOR EVALUATION
# =====================================================================

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
    """
    settings = _get_settings(db, current_user.org_id)
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
        base = AnnualReviewResponse.model_validate(r).model_dump()
        if not settings.annual_review_final_rating_visible:
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
    if review.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this review.",
        )

    review.mentor_overall_review = payload.mentor_overall_review
    review.mentor_performance_rating = payload.mentor_performance_rating
    # Clear any draft scratchpad — the final cols are now authoritative.
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None

    review.status = ReviewStatus.PENDING_MANAGEMENT.value

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
    if review.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this review.",
        )

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


def _calibration_base_query(db, org_id: int, cycle_name: str):
    """Base calibration query joined to employee + mentor + employee's
    department/designation via aliases, so we can filter/sort/search on
    the resolved display names in SQL (not post-query in Python).

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
            AnnualReview.cycle_name == cycle_name,
            AnnualReview.status.in_([
                ReviewStatus.PENDING_MANAGEMENT.value,
                ReviewStatus.COMPLETED.value,
            ]),
        )
    )
    return query, Employee, Mentor, EmpDept, EmpDesig


@router.get("/calibration", response_model=Page[CalibrationRow])
def get_calibration_grid(
    db: DbSession,
    current_user: CurrentUser,
    pg: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Matches employee name/email, mentor, or department"),
    department: Optional[str] = Query(None, description="Exact department name"),
    mentor: Optional[str] = Query(None, description="Exact mentor name"),
    status_filter: Optional[str] = Query(
        None, alias="status", description="all | pending | rated"
    ),
    sort_by: Optional[str] = Query(None, description="CalibrationRow field name"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    """
    Paginated calibration grid for the active cycle (pending_management +
    completed reviews). Management-only.

    Server-side search / department / mentor / status filtering + sort +
    offset pagination so the FE never holds the full org review set in
    memory. Filter-dropdown option lists come from
    GET /calibration/filter-options (fetched once, cached).
    """
    _require_management(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

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
    if department:
        query = query.filter(EmpDept.name == department)
    if mentor:
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
    Distinct department + mentor names across the active cycle's
    calibration set. Drives the grid's filter dropdowns. Management-only.

    Computed from the unpaginated set so the dropdowns always show every
    available value regardless of which page the user is on.
    """
    _require_management(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

    query, _Employee, Mentor, EmpDept, _EmpDesig = _calibration_base_query(
        db, current_user.org_id, cycle_name
    )
    rows = query.with_entities(EmpDept.name, Mentor.full_name).all()

    departments = sorted({d for (d, _m) in rows if d})
    mentors = sorted({m for (_d, m) in rows if m})
    return CalibrationFilterOptions(departments=departments, mentors=mentors)


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

    review.management_performance_rating = payload.management_performance_rating
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
    is_mentor = review.mentor_id == current_user.id
    is_admin = current_user.role == "Admin"

    if not (is_owner or is_mentor or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    if is_owner and not is_admin:
        _strip_private_ratings(review, settings.annual_review_final_rating_visible)

    return review
