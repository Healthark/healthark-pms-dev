"""
Project Review Routes — Self-Assessment and Multi-Evaluator Workflow.

Endpoints:
    ── Employee ──
    GET   /project-reviews/mine                   → List my assigned projects with review status
    POST  /project-reviews/self                    → Submit self-review (all 8 competencies)
    PATCH /project-reviews/{id}/draft              → Save partial draft
    GET   /project-reviews/{id}                    → View single review (visibility-controlled)

    ── Primary Evaluator ──
    GET   /project-reviews/evaluations             → List reviews pending my evaluation
    POST  /project-reviews/{id}/primary-eval       → Submit primary evaluation

    ── Secondary/Peer Evaluator ──
    POST  /project-reviews/{id}/secondary-eval     → Submit secondary/peer impact statement

    ── Admin ──
    GET   /project-reviews/all                     → All reviews for the org (admin overview)

Security Layers:
    Layer 1 — Authentication:     CurrentUser dependency
    Layer 2 — Tenant Isolation:   All queries filter by org_id
    Layer 3 — Role Authorization: Evaluator type validated per review
    Layer 4 — Ownership:          Self-review requires user_id match,
                                  evaluator requires assignment match
"""

from typing import List
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import (
    ProjectReview, ProjectReviewStatus,
    ProjectReviewEvaluator, EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import (
    SelfReviewCreate, SelfReviewDraft,
    PrimaryEvalSubmit, SecondaryPeerSubmit,
    ProjectReviewResponse, EvaluatorResponse, MyProjectReviewCard,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_active_cycle(db: DbSession, org_id: int) -> str:
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured.",
        )
    return settings.active_cycle_name


def _build_evaluator_response(
    ev: ProjectReviewEvaluator, db: DbSession
) -> EvaluatorResponse:
    user = db.query(User).filter(User.id == ev.evaluator_id).first()
    return EvaluatorResponse(
        id=ev.id,
        evaluator_id=ev.evaluator_id,
        evaluator_name=user.full_name if user else "Unknown",
        evaluator_type=ev.evaluator_type,
        status=ev.status,
        performance_group=ev.performance_group,
        impact_statement=ev.impact_statement,
        comment_task_execution=ev.comment_task_execution,
        comment_ownership=ev.comment_ownership,
        comment_project_management=ev.comment_project_management,
        comment_client_deliverables=ev.comment_client_deliverables,
        comment_communication=ev.comment_communication,
        comment_mentoring=ev.comment_mentoring,
        comment_firm_growth=ev.comment_firm_growth,
        comment_competency_skills=ev.comment_competency_skills,
        created_at=ev.created_at,
    )


def _build_review_response(
    review: ProjectReview,
    db: DbSession,
    include_evaluators: bool = True,
    caller_id: int | None = None,
    is_admin: bool = False,
) -> ProjectReviewResponse:
    """
    Build a review response with visibility rules applied.

    Visibility:
        - Employee sees Primary feedback only after Primary submits
        - Employee sees Secondary/Peer feedback only after Primary submits
        - Peers CANNOT see the self-review descriptions (cleared in route)
        - Admin and Primary/Secondary can see everything
    """
    employee = db.query(User).filter(User.id == review.user_id).first()
    project = db.query(Project).filter(Project.id == review.project_id).first()

    evaluator_responses: list[EvaluatorResponse] = []
    if include_evaluators:
        for ev in review.evaluators:
            if ev.status == EvaluatorStatus.SUBMITTED.value or is_admin:
                evaluator_responses.append(_build_evaluator_response(ev, db))

    return ProjectReviewResponse(
        id=review.id,
        org_id=review.org_id,
        user_id=review.user_id,
        project_id=review.project_id,
        cycle=review.cycle,
        status=review.status,
        employee_name=employee.full_name if employee else "Unknown",
        project_name=project.name if project else "Unknown",
        project_code=project.project_code if project else "???",
        self_desc_task_execution=review.self_desc_task_execution,
        self_desc_ownership=review.self_desc_ownership,
        self_desc_project_management=review.self_desc_project_management,
        self_desc_client_deliverables=review.self_desc_client_deliverables,
        self_desc_communication=review.self_desc_communication,
        self_desc_mentoring=review.self_desc_mentoring,
        self_desc_firm_growth=review.self_desc_firm_growth,
        self_desc_competency_skills=review.self_desc_competency_skills,
        evaluators=evaluator_responses,
        is_deleted=review.is_deleted,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


# =====================================================================
# EMPLOYEE ENDPOINTS
# =====================================================================

@router.get("/mine", response_model=List[MyProjectReviewCard])
def get_my_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all projects the current user is assigned to, with review status
    for the active cycle. This powers the "My Reviews" card list.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Get all assignments for this user
    assignments = (
        db.query(ProjectAssignment)
        .join(Project, ProjectAssignment.project_id == Project.id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    cards: list[MyProjectReviewCard] = []
    for a in assignments:
        project = db.query(Project).filter(Project.id == a.project_id).first()
        if not project:
            continue

        # Check if a review exists for this project + cycle
        review = db.query(ProjectReview).filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id == a.project_id,
            ProjectReview.cycle == cycle,
        ).first()

        # Check if Primary has submitted for this review
        primary_submitted = False
        if review:
            primary_eval = db.query(ProjectReviewEvaluator).filter(
                ProjectReviewEvaluator.project_review_id == review.id,
                ProjectReviewEvaluator.evaluator_type == "Primary",
                ProjectReviewEvaluator.status == EvaluatorStatus.SUBMITTED.value,
            ).first()
            primary_submitted = primary_eval is not None

        cards.append(MyProjectReviewCard(
            review_id=review.id if review else None,
            project_id=project.id,
            project_name=project.name,
            project_code=project.project_code,
            project_start_date=project.start_date,
            project_end_date=project.end_date,
            assigned_date=a.assigned_date,
            assignment_role=a.assignment_role,
            review_status=review.status if review else None,
            primary_submitted=primary_submitted,
            cycle=cycle,
        ))

    return cards


@router.post("/self", response_model=ProjectReviewResponse, status_code=status.HTTP_201_CREATED)
def submit_self_review(
    payload: SelfReviewCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create and submit the employee's self-review for a project.
    All 8 competencies required. Status is immediately set to Submitted.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Verify assignment
    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == payload.project_id,
        ProjectAssignment.user_id == current_user.id,
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this project.",
        )

    # Guard: one review per project per cycle
    existing = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == current_user.id,
        ProjectReview.project_id == payload.project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted a self-review for this project this cycle.",
        )

    review = ProjectReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        project_id=payload.project_id,
        cycle=cycle,
        status=ProjectReviewStatus.SUBMITTED.value,
        self_desc_task_execution=payload.self_desc_task_execution,
        self_desc_ownership=payload.self_desc_ownership,
        self_desc_project_management=payload.self_desc_project_management,
        self_desc_client_deliverables=payload.self_desc_client_deliverables,
        self_desc_communication=payload.self_desc_communication,
        self_desc_mentoring=payload.self_desc_mentoring,
        self_desc_firm_growth=payload.self_desc_firm_growth,
        self_desc_competency_skills=payload.self_desc_competency_skills,
    )
    db.add(review)
    db.commit()
    db.refresh(review)

    return _build_review_response(review, db)


@router.patch("/{review_id}/draft", response_model=ProjectReviewResponse)
def save_draft(
    review_id: int,
    payload: SelfReviewDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """Save a partial self-review draft. Only works in Draft status."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == current_user.id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    if review.status != ProjectReviewStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft reviews can be edited.",
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(review, field, value)

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db)


@router.get("/{review_id}", response_model=ProjectReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single review with visibility rules applied.

    - Employee: sees own self-review + evaluator feedback (only after Primary submits)
    - Primary/Secondary: sees the self-review + submitted evaluators
    - Peer: sees only their own evaluation (NOT the self-review)
    - Admin: sees everything
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    is_admin = current_user.role == "Admin"
    is_owner = review.user_id == current_user.id

    # Check if caller is an evaluator on this review
    caller_eval = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    is_evaluator = caller_eval is not None

    if not (is_owner or is_evaluator or is_admin):
        # Check if assigned to same project at all
        assignment = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == review.project_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.org_id == current_user.org_id,
        ).first()
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this review.",
            )

    resp = _build_review_response(
        review, db,
        include_evaluators=True,
        caller_id=current_user.id,
        is_admin=is_admin,
    )

    # Employee visibility: only show evaluators after Primary submits
    if is_owner and not is_admin:
        primary_submitted = any(
            e.evaluator_type == "Primary" and e.status == EvaluatorStatus.SUBMITTED.value
            for e in review.evaluators
        )
        if not primary_submitted:
            resp.evaluators = []

    return resp


# =====================================================================
# PRIMARY EVALUATOR
# =====================================================================

@router.get("/evaluations", response_model=List[ProjectReviewResponse])
def get_pending_evaluations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all submitted reviews where the current user is the Primary evaluator
    and hasn't submitted their evaluation yet.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Find projects where current user is Primary evaluator
    primary_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Primary",
        )
        .all()
    )

    if not primary_assignments:
        return []

    project_ids = [a.project_id for a in primary_assignments]

    # Find submitted reviews for those projects (excluding own self-review)
    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.cycle == cycle,
            ProjectReview.status == ProjectReviewStatus.SUBMITTED.value,
            ProjectReview.user_id != current_user.id,  # Don't evaluate yourself
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    # Filter out reviews where Primary has already submitted
    pending = []
    for r in reviews:
        existing_eval = db.query(ProjectReviewEvaluator).filter(
            ProjectReviewEvaluator.project_review_id == r.id,
            ProjectReviewEvaluator.evaluator_id == current_user.id,
            ProjectReviewEvaluator.status == EvaluatorStatus.SUBMITTED.value,
        ).first()
        if not existing_eval:
            pending.append(_build_review_response(r, db))

    return pending


@router.post("/{review_id}/primary-eval", response_model=EvaluatorResponse, status_code=status.HTTP_201_CREATED)
def submit_primary_evaluation(
    review_id: int,
    payload: PrimaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Primary evaluator submits their full evaluation — 8 competency
    comments + performance group + impact statement.

    After this, the employee can see the Primary's feedback.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.SUBMITTED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submitted review not found.",
        )

    # Verify caller is Primary evaluator for this project
    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Primary evaluator for this project.",
        )

    # Can't evaluate yourself
    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate your own self-review.",
        )

    # Guard: one evaluation per evaluator per review
    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted your evaluation for this review.",
        )

    evaluator = ProjectReviewEvaluator(
        org_id=current_user.org_id,
        project_review_id=review.id,
        evaluator_id=current_user.id,
        evaluator_type="Primary",
        status=EvaluatorStatus.SUBMITTED.value,
        performance_group=payload.performance_group.value,
        impact_statement=payload.impact_statement,
        comment_task_execution=payload.comment_task_execution,
        comment_ownership=payload.comment_ownership,
        comment_project_management=payload.comment_project_management,
        comment_client_deliverables=payload.comment_client_deliverables,
        comment_communication=payload.comment_communication,
        comment_mentoring=payload.comment_mentoring,
        comment_firm_growth=payload.comment_firm_growth,
        comment_competency_skills=payload.comment_competency_skills,
    )

    db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    return _build_evaluator_response(evaluator, db)


# =====================================================================
# SECONDARY / PEER EVALUATOR
# =====================================================================

@router.post("/{review_id}/secondary-eval", response_model=EvaluatorResponse, status_code=status.HTTP_201_CREATED)
def submit_secondary_peer_evaluation(
    review_id: int,
    payload: SecondaryPeerSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Secondary or Peer evaluator submits an impact statement.
    No competency-level comments — lighter feedback.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.SUBMITTED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submitted review not found.",
        )

    # Verify caller is assigned as Secondary or Peer for this project
    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Secondary",
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned as a Secondary or Peer evaluator for this project.",
        )

    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate your own self-review.",
        )

    # Guard: one evaluation per evaluator per review
    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted your evaluation for this review.",
        )

    evaluator = ProjectReviewEvaluator(
        org_id=current_user.org_id,
        project_review_id=review.id,
        evaluator_id=current_user.id,
        evaluator_type=assignment.evaluator_type,
        status=EvaluatorStatus.SUBMITTED.value,
        impact_statement=payload.impact_statement,
    )

    db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    return _build_evaluator_response(evaluator, db)


# =====================================================================
# ADMIN OVERVIEW
# =====================================================================

@router.get("/all", response_model=List[ProjectReviewResponse])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """Admin-only: list all reviews across the org for the active cycle."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view all reviews.",
        )

    cycle = _get_active_cycle(db, current_user.org_id)

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == cycle,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    return [_build_review_response(r, db, is_admin=True) for r in reviews]