"""
Project Review Routes — PM-Centric Evaluation (Revised).

No self-review. The PM writes the evaluation directly for each team member.

Endpoints:
    ── Employee ──
    GET   /project-reviews/mine                    → My assigned projects with review status
    GET   /project-reviews/{id}                    → View single review (after PM evaluates)

    ── PM (Primary Evaluator) ──
    GET   /project-reviews/pm-queue                → Team members awaiting evaluation
    GET   /project-reviews/role-expectations        → Reference data for evaluation
    POST  /project-reviews/{user_id}/evaluate       → Submit PM evaluation for a team member

    ── Secondary Evaluator ──
    GET   /project-reviews/secondary-queue          → Reviews pending secondary feedback
    POST  /project-reviews/{review_id}/secondary    → Submit secondary impact statement

    ── Admin ──
    GET   /project-reviews/all                      → All reviews for the org
"""

from typing import List
from datetime import date
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import (
    ProjectReview, ProjectReviewStatus,
    ProjectReviewEvaluator, EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.schemas.project_review_schemas import (
    PMEvaluationSubmit, SecondaryEvalSubmit,
    ProjectReviewResponse, SecondaryEvalResponse,
    MyProjectCard, PMPendingReviewCard,
    RoleExpectationResponse,
)
from app.core.cycle_utils import get_current_cycle_info

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """Resolve the org's dynamically calculated active cycle."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured.",
        )
        
    return get_current_cycle_info(
        current_date=date.today(),
        cycle_type=settings.cycle_type,
        fiscal_start_month=settings.fiscal_start_month
    )


def _build_review_response(review: ProjectReview, db: DbSession) -> ProjectReviewResponse:
    employee = db.query(User).filter(User.id == review.user_id).first()
    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    project = db.query(Project).filter(Project.id == review.project_id).first()

    secondary_responses: list[SecondaryEvalResponse] = []
    for ev in review.secondary_evaluations:
        if ev.status == EvaluatorStatus.SUBMITTED.value:
            ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()
            secondary_responses.append(SecondaryEvalResponse(
                id=ev.id,
                evaluator_id=ev.evaluator_id,
                evaluator_name=ev_user.full_name if ev_user else "Unknown",
                impact_statement=ev.impact_statement,
                created_at=ev.created_at,
            ))

    return ProjectReviewResponse(
        id=review.id,
        org_id=review.org_id,
        user_id=review.user_id,
        project_id=review.project_id,
        reviewer_id=review.reviewer_id,
        cycle=review.cycle,
        status=review.status,
        employee_name=employee.full_name if employee else "Unknown",
        reviewer_name=reviewer.full_name if reviewer else None,
        project_name=project.name if project else "Unknown",
        project_code=project.project_code if project else "???",
        comment_task_execution=review.comment_task_execution,
        comment_ownership=review.comment_ownership,
        comment_project_management=review.comment_project_management,
        comment_client_deliverables=review.comment_client_deliverables,
        comment_communication=review.comment_communication,
        comment_mentoring=review.comment_mentoring,
        comment_competency_skills=review.comment_competency_skills,
        performance_group=review.performance_group,
        impact_statement=review.impact_statement,
        secondary_evaluations=secondary_responses,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


# =====================================================================
# EMPLOYEE ENDPOINTS
# =====================================================================

@router.get("/mine", response_model=List[MyProjectCard])
def get_my_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all projects the current user is assigned to, with review status.
    Employee sees 'pending' until PM evaluates, then 'reviewed'.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

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

    cards: list[MyProjectCard] = []
    for a in assignments:
        project = db.query(Project).filter(Project.id == a.project_id).first()
        if not project:
            continue

        dept = db.query(Department).filter(Department.id == a.department_id).first() if a.department_id else None

        review = db.query(ProjectReview).filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id == a.project_id,
            ProjectReview.cycle == cycle,
        ).first()

        pm_assignment = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == a.project_id,
            ProjectAssignment.evaluator_type == "Primary",
        ).first()
        pm_user = db.query(User).filter(User.id == pm_assignment.user_id).first() if pm_assignment else None

        cards.append(MyProjectCard(
            review_id=review.id if review else None,
            project_id=project.id,
            project_name=project.name,
            project_code=project.project_code,
            project_start_date=project.start_date,
            project_expected_end_date=project.expected_end_date,
            assigned_date=a.assigned_date,
            assignment_role=a.assignment_role,
            department_name=dept.name if dept else None,
            review_status=review.status if review else "pending",
            pm_name=pm_user.full_name if pm_user else None,
            cycle=cycle,
        ))

    return cards


# =====================================================================
# PM (PRIMARY EVALUATOR) ENDPOINTS
# =====================================================================

@router.get("/pm-queue", response_model=List[PMPendingReviewCard])
def get_pm_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all team members on projects where the current user is PM,
    who haven't been evaluated yet for the active cycle.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Find projects where current user is Primary
    pm_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Primary",
        )
        .all()
    )

    if not pm_assignments:
        return []

    cards: list[PMPendingReviewCard] = []

    for pm_a in pm_assignments:
        project = db.query(Project).filter(
            Project.id == pm_a.project_id,
            Project.is_deleted == False,  # noqa: E712
        ).first()
        if not project:
            continue

        # Get all team members on this project (excluding the PM themselves)
        team_assignments = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_id == pm_a.project_id,
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.user_id != current_user.id,
            )
            .all()
        )

        for ta in team_assignments:
            user = db.query(User).filter(User.id == ta.user_id).first()
            if not user or user.is_deleted:
                continue

            dept = db.query(Department).filter(Department.id == ta.department_id).first() if ta.department_id else None
            desig = db.query(Designation).filter(Designation.id == user.designation_id).first() if user.designation_id else None

            # Check if review already exists for this cycle
            review = db.query(ProjectReview).filter(
                ProjectReview.org_id == current_user.org_id,
                ProjectReview.user_id == ta.user_id,
                ProjectReview.project_id == pm_a.project_id,
                ProjectReview.cycle == cycle,
            ).first()

            cards.append(PMPendingReviewCard(
                review_id=review.id if review else None,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                user_id=ta.user_id,
                employee_name=user.full_name,
                assignment_role=ta.assignment_role,
                department_name=dept.name if dept else None,
                designation_name=desig.name if desig else None,
                assigned_date=ta.assigned_date,
                review_status=review.status if review else None,
                cycle=cycle,
            ))

    return cards


@router.get("/role-expectations", response_model=List[RoleExpectationResponse])
def get_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return all role expectations for the org.
    PM uses this as reference while evaluating team members.
    """
    expectations = (
        db.query(RoleExpectation)
        .filter(RoleExpectation.org_id == current_user.org_id)
        .all()
    )

    results: list[RoleExpectationResponse] = []
    for exp in expectations:
        dept = db.query(Department).filter(Department.id == exp.department_id).first()
        desig = db.query(Designation).filter(Designation.id == exp.designation_id).first()
        results.append(RoleExpectationResponse(
            id=exp.id,
            department_name=dept.name if dept else "Unknown",
            designation_name=desig.name if desig else "Unknown",
            exp_task_execution=exp.exp_task_execution,
            exp_ownership=exp.exp_ownership,
            exp_project_management=exp.exp_project_management,
            exp_client_deliverables=exp.exp_client_deliverables,
            exp_communication=exp.exp_communication,
            exp_mentoring=exp.exp_mentoring,
            exp_competency_skills=exp.exp_competency_skills,
        ))

    return results


@router.post("/{project_id}/evaluate/{user_id}", response_model=ProjectReviewResponse, status_code=status.HTTP_201_CREATED)
def submit_pm_evaluation(
    project_id: int,
    user_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM submits evaluation for a specific team member on a specific project.

    Creates the ProjectReview row if it doesn't exist, fills in the
    7 competency comments + performance group + impact, and sets
    status to 'reviewed'. The employee can now see the evaluation.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Verify caller is PM for this project
    pm_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
    ).first()

    if not pm_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    # Verify the target user is assigned to this project
    target_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).first()

    if not target_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )

    # Can't evaluate yourself
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    # Check if already evaluated
    existing = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee has already been evaluated for this project this cycle.",
        )

    # Create or update the review row
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review:
        # Update existing pending review
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.REVIEWED.value
        review.comment_task_execution = payload.comment_task_execution
        review.comment_ownership = payload.comment_ownership
        review.comment_project_management = payload.comment_project_management
        review.comment_client_deliverables = payload.comment_client_deliverables
        review.comment_communication = payload.comment_communication
        review.comment_mentoring = payload.comment_mentoring
        review.comment_competency_skills = payload.comment_competency_skills
        review.performance_group = payload.performance_group.value
        review.impact_statement = payload.impact_statement
    else:
        # Create new review
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.REVIEWED.value,
            comment_task_execution=payload.comment_task_execution,
            comment_ownership=payload.comment_ownership,
            comment_project_management=payload.comment_project_management,
            comment_client_deliverables=payload.comment_client_deliverables,
            comment_communication=payload.comment_communication,
            comment_mentoring=payload.comment_mentoring,
            comment_competency_skills=payload.comment_competency_skills,
            performance_group=payload.performance_group.value,
            impact_statement=payload.impact_statement,
        )
        db.add(review)

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db)


# =====================================================================
# SECONDARY EVALUATOR ENDPOINTS
# =====================================================================

@router.get("/secondary-queue", response_model=List[ProjectReviewResponse])
def get_secondary_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List reviewed reviews on projects where the current user is
    a Secondary evaluator and hasn't submitted their impact yet.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    secondary_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Secondary",
        )
        .all()
    )

    if not secondary_assignments:
        return []

    project_ids = [a.project_id for a in secondary_assignments]

    # Get reviews that have been evaluated by PM (status = reviewed)
    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.cycle == cycle,
            ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
            ProjectReview.user_id != current_user.id,
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    # Filter out ones where secondary has already submitted
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


@router.post("/{review_id}/secondary", response_model=SecondaryEvalResponse, status_code=status.HTTP_201_CREATED)
def submit_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator submits impact statement."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    # Verify caller is Secondary on this project
    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Secondary",
    ).first()

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a Secondary evaluator for this project.",
        )

    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

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
        evaluator_type="Secondary",
        status=EvaluatorStatus.SUBMITTED.value,
        impact_statement=payload.impact_statement,
    )
    db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        created_at=evaluator.created_at,
    )


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

    return [_build_review_response(r, db) for r in reviews]


# =====================================================================
# SINGLE REVIEW (must be LAST — catch-all path)
# =====================================================================

@router.get("/{review_id}", response_model=ProjectReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single review. Access control:
    - Employee sees their own review (only after PM evaluates)
    - PM sees any review they wrote
    - Secondary sees reviews on their projects
    - Admin sees everything
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
    is_reviewer = review.reviewer_id == current_user.id

    # Check if caller is assigned to same project
    is_on_project = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first() is not None

    if not (is_owner or is_reviewer or is_on_project or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    # Employee can only see their review after PM has evaluated
    if is_owner and not is_admin and review.status != ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your review has not been completed yet.",
        )

    return _build_review_response(review, db)