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
    GET   /project-reviews/management               → Per-project completion overview for active cycle
    GET   /project-reviews/all                      → All reviews for the org (flat list)
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.core.cycle_utils import (
    _fy_label_of_project_review,
    extract_fy_label,
    get_year_override,
)
from app.models.project_models import (
    PROJECT_STATUS_COMPLETED,
    Project,
    ProjectAssignment,
)
from app.models.project_review_models import (
    EvaluatorStatus,
    ProjectReview,
    ProjectReviewEvaluator,
    ProjectReviewStatus,
)
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.project_review_schemas import (
    AdminMemberReviewRow,
    AdminProjectSummary,
    MyProjectCard,
    PMEvaluationDraft,
    PMEvaluationSubmit,
    PMPendingReviewCard,
    ProjectReviewResponse,
    RoleExpectationResponse,
    SecondaryEvalDraft,
    SecondaryEvalResponse,
    SecondaryEvalSubmit,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

_DRAFT_COMMENT_FIELDS = (
    "comment_task_execution",
    "comment_ownership",
    "comment_project_management",
    "comment_client_deliverables",
    "comment_communication",
    "comment_mentoring",
    "comment_competency_skills",
)


def _pm_review_has_draft_content(review: ProjectReview) -> bool:
    """True iff the PM has typed anything into this review row.

    Distinguishes a saved draft from the empty placeholder rows that
    seed.py / the queue pre-creates for upcoming cycles. A row counts as
    a draft if any of: rating selected, impact statement filled, or any
    per-competency comment present (after stripping whitespace).
    """
    if review.performance_group:
        return True
    if review.impact_statement and review.impact_statement.strip():
        return True
    for f in _DRAFT_COMMENT_FIELDS:
        v = getattr(review, f, None)
        if v and v.strip():
            return True
    return False


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """Return the admin-configured active cycle name from SystemSettings.

    Project reviews are scoped to the FULL cadence window (half/quarter),
    NOT the bare fiscal year: a project gets one review per employee per
    active cycle, so rotating H1 → H2 opens a fresh review for the new
    half. The `(org, user, project, cycle)` unique index keys on this full
    label ("H1 FY26-27"), so each half/quarter is its own review row.
    """
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()

    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured.",
        )

    return settings.active_cycle_name


def _visible_performance_group(
    review: ProjectReview,
    viewer: User,
    db: DbSession,
    org_id: int,
    active_cycle_name: str,
    *,
    is_mentor: bool = False,
) -> Optional[str]:
    """Return `review.performance_group` if `viewer` may see it, else None.

    Per-FY project-rating visibility (decision #6 — mentors always see):
      - Past (or any non-active) FY → always pass through; closing the
        current year never retroactively hides a finalized prior year.
      - Admins, the rating's author (reviewer_id == viewer.id), and the
        rated employee's mentor (is_mentor=True) → always see it.
      - Otherwise (the rated employee viewing the current FY) → visible
        only when this FY's `project_ratings_visible` toggle is True.

    Authoring / PM contexts that need the raw group keep calling
    `review.performance_group` directly (see `_build_review_response`).
    """
    group = review.performance_group
    if not group:
        return group
    review_fy = _fy_label_of_project_review(review)
    active_fy = extract_fy_label(active_cycle_name)
    if review_fy != active_fy:
        return group
    if viewer.role == "Admin" or review.reviewer_id == viewer.id or is_mentor:
        return group
    override = get_year_override(db, org_id, review_fy)
    return group if (override and override.project_ratings_visible) else None


def _build_review_response(
    review: ProjectReview,
    db: DbSession,
    viewer_user_id: Optional[int] = None,
) -> ProjectReviewResponse:
    """
    Convert a ProjectReview ORM row to its API response shape.

    `viewer_user_id` is used to decide whether to include in-progress
    secondary-evaluator drafts: an evaluator can see their own draft (so
    reopening the modal pre-populates), but other viewers (PM, mentor,
    mentee, admin) only see submitted impact statements.
    """
    employee = db.query(User).filter(User.id == review.user_id).first()
    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    project = db.query(Project).filter(Project.id == review.project_id).first()

    secondary_responses: list[SecondaryEvalResponse] = []
    for ev in review.secondary_evaluations:
        # Always include submitted; include drafts only for their author.
        if (
            ev.status == EvaluatorStatus.SUBMITTED.value
            or (
                ev.status == EvaluatorStatus.DRAFT.value
                and viewer_user_id is not None
                and ev.evaluator_id == viewer_user_id
            )
        ):
            ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()
            secondary_responses.append(SecondaryEvalResponse(
                id=ev.id,
                evaluator_id=ev.evaluator_id,
                evaluator_name=ev_user.full_name if ev_user else "Unknown",
                impact_statement=ev.impact_statement,
                status=ev.status,
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
    List all projects the current user is assigned to, with review status
    across ALL cycles. Returns one card per (project, cycle). For the
    current cycle a 'pending' card is added if no review exists yet.
    Frontend handles cycle filtering.
    """
    current_cycle = _get_active_cycle(db, current_user.org_id)

    assignments = (
        db.query(ProjectAssignment)
        .join(Project, ProjectAssignment.project_id == Project.id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )
    if not assignments:
        return []

    # ── Batch lookups (replaces the per-assignment N+1) ──────────────
    project_ids = [a.project_id for a in assignments]
    projects_by_id = {
        p.id: p
        for p in db.query(Project).filter(Project.id.in_(project_ids)).all()
    }
    dept_ids = {a.department_id for a in assignments if a.department_id}
    depts_by_id = (
        {d.id: d for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()}
        if dept_ids
        else {}
    )

    # Active Primary (PM) per project, then PM names — two queries, not 2×N.
    pm_user_id_by_project = dict(
        db.query(ProjectAssignment.project_id, ProjectAssignment.user_id)
        .filter(
            ProjectAssignment.project_id.in_(project_ids),
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    pm_name_by_user_id = (
        {
            u.id: u.full_name
            for u in db.query(User)
            .filter(User.id.in_(set(pm_user_id_by_project.values())))
            .all()
        }
        if pm_user_id_by_project
        else {}
    )

    # This user's reviews across these projects, grouped by project_id.
    reviews_by_project: dict[int, list[ProjectReview]] = {}
    for rv in (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id.in_(project_ids),
        )
        .all()
    ):
        reviews_by_project.setdefault(rv.project_id, []).append(rv)

    # The employee's designation drives role-expectation matching (same key the
    # PM queue uses) — fetch once for all their cards.
    my_designation = (
        db.query(Designation)
        .filter(Designation.id == current_user.designation_id)
        .first()
        if current_user.designation_id
        else None
    )
    my_designation_name = my_designation.name if my_designation else None

    cards: list[MyProjectCard] = []
    for a in assignments:
        project = projects_by_id.get(a.project_id)
        if not project:
            continue

        dept = depts_by_id.get(a.department_id) if a.department_id else None
        pm_name = pm_name_by_user_id.get(pm_user_id_by_project.get(a.project_id))

        # All reviews for this user on this project (across all cycles)
        reviews = reviews_by_project.get(a.project_id, [])

        seen_cycles = set()
        for review in reviews:
            seen_cycles.add(review.cycle)
            cards.append(MyProjectCard(
                review_id=review.id,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                designation_name=my_designation_name,
                department_name=dept.name if dept else None,
                review_status=review.status,
                performance_group=_visible_performance_group(
                    review, current_user, db, current_user.org_id, current_cycle
                ),
                pm_name=pm_name,
                cycle=review.cycle,
            ))

        # If no review exists for the current cycle, add a pending card
        if current_cycle not in seen_cycles:
            cards.append(MyProjectCard(
                review_id=None,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                designation_name=my_designation_name,
                department_name=dept.name if dept else None,
                review_status="pending",
                pm_name=pm_name,
                cycle=current_cycle,
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
    List all team members on projects where the current user is PM, across
    ALL cycles. For each (team_member, project) pair we emit one card per
    existing ProjectReview row (any cycle) plus a placeholder card for the
    active cycle when no review has been created for it yet.

    The frontend defaults its Cycle filter to the active cycle, so by default
    the page shows the same data it always did; switching the filter exposes
    historical evaluations the PM may want to edit or review.
    """
    active_cycle = _get_active_cycle(db, current_user.org_id)

    # Find projects where current user is Primary
    pm_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    if not pm_assignments:
        return []

    # ── Batch lookups (replaces the per-member / per-project N+1) ────
    pm_project_ids = [pm.project_id for pm in pm_assignments]
    projects_by_id = {
        p.id: p
        for p in db.query(Project)
        .filter(
            Project.id.in_(pm_project_ids),
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    }
    if not projects_by_id:
        return []
    visible_project_ids = list(projects_by_id.keys())

    # All active team members across those projects (excluding the PM).
    team_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.project_id.in_(visible_project_ids),
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id != current_user.id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    if not team_assignments:
        return []
    team_by_project: dict[int, list[ProjectAssignment]] = {}
    for ta in team_assignments:
        team_by_project.setdefault(ta.project_id, []).append(ta)

    member_ids = {ta.user_id for ta in team_assignments}
    users_by_id = {
        u.id: u for u in db.query(User).filter(User.id.in_(member_ids)).all()
    }
    dept_ids = {ta.department_id for ta in team_assignments if ta.department_id}
    depts_by_id = (
        {d.id: d for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()}
        if dept_ids
        else {}
    )
    desig_ids = {u.designation_id for u in users_by_id.values() if u.designation_id}
    desigs_by_id = (
        {d.id: d for d in db.query(Designation).filter(Designation.id.in_(desig_ids)).all()}
        if desig_ids
        else {}
    )

    # All non-deleted reviews for these (project, member) pairs, grouped.
    reviews_by_pair: dict[tuple[int, int], list[ProjectReview]] = {}
    for rv in (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(visible_project_ids),
            ProjectReview.user_id.in_(member_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    ):
        reviews_by_pair.setdefault((rv.project_id, rv.user_id), []).append(rv)

    cards: list[PMPendingReviewCard] = []

    # Iterate PM-project order, then members — preserves the original card order.
    for pm_a in pm_assignments:
        project = projects_by_id.get(pm_a.project_id)
        if not project:
            continue

        for ta in team_by_project.get(pm_a.project_id, []):
            user = users_by_id.get(ta.user_id)
            if not user or user.is_deleted:
                continue

            dept = depts_by_id.get(ta.department_id) if ta.department_id else None
            desig = desigs_by_id.get(user.designation_id) if user.designation_id else None

            # All ProjectReview rows for this (team_member, project) across cycles
            reviews = reviews_by_pair.get((ta.project_id, ta.user_id), [])
            cycles_with_review = {r.cycle for r in reviews}

            # One card per existing review (any cycle)
            for review in reviews:
                cards.append(PMPendingReviewCard(
                    review_id=review.id,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=review.status,
                    performance_group=review.performance_group,
                    cycle=review.cycle,
                    has_draft_content=_pm_review_has_draft_content(review),
                ))

            # Placeholder for the active cycle when no review row exists yet
            if active_cycle not in cycles_with_review:
                cards.append(PMPendingReviewCard(
                    review_id=None,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=None,
                    performance_group=None,
                    cycle=active_cycle,
                    has_draft_content=False,
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
            exp_firm_growth=exp.exp_firm_growth,
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
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first()

    if not pm_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    # Verify the target user is assigned to this project
    target_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
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

    # Find any existing review row for this (employee, project, cycle).
    # PENDING and DRAFT are both promotable to REVIEWED; only an existing
    # REVIEWED row is a true 409.
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee has already been evaluated for this project this cycle.",
        )

    if review:
        # Promote PENDING / DRAFT row to REVIEWED.
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
        # Block only the creation of a NEW review on a completed project.
        # In-flight pending/draft rows can still be finished or edited —
        # matching PUT /{review_id} and the secondary-edit endpoints, so the
        # completed-project rule is consistent across all review writes.
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
            )
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

    return _build_review_response(review, db, viewer_user_id=current_user.id)


@router.patch("/{project_id}/evaluate/{user_id}/draft", response_model=ProjectReviewResponse)
def save_pm_evaluation_draft(
    project_id: int,
    user_id: int,
    payload: PMEvaluationDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM saves an in-progress evaluation as a DRAFT. Same auth gates as the
    submit endpoint, but the row's status is set to DRAFT and the PM can
    keep editing. Submit (POST /evaluate) promotes DRAFT → REVIEWED.

    All fields in the payload are optional — a half-typed evaluation can
    be parked and resumed later. Fields not present on the payload are
    left as-is on the row.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Same role gate as submit.
    pm_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first()
    if not pm_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    target_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first()
    if not target_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This employee has already been evaluated; drafts can no "
                "longer be saved."
            ),
        )

    if not review:
        # Block only NEW reviews on a completed project (see submit endpoint);
        # an existing draft stays editable so completion can't strand it.
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
            )
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.DRAFT.value,
        )
        db.add(review)
    else:
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.DRAFT.value

    # Apply only the fields the client included (partial save).
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "performance_group" and value is not None:
            # Pydantic model gives us the enum; persist the string value.
            setattr(review, field, value.value if hasattr(value, "value") else value)
        else:
            setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer_user_id=current_user.id)


# =====================================================================
# SECONDARY EVALUATOR ENDPOINTS
# =====================================================================

@router.get("/secondary-queue", response_model=List[ProjectReviewResponse])
def get_secondary_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List PM-reviewed reviews on projects where the current user is a
    Secondary evaluator, across ALL cycles. The frontend defaults its
    Cycle filter to the active cycle, so default UX is unchanged; the
    filter exposes historical entries the secondary may want to edit.

    Only `status == reviewed` rows are returned — secondaries write
    impact AFTER the PM has evaluated.
    """
    # Secondary evaluator is now a project-level field (Project.secondary_evaluator_id),
    # not a per-member ProjectAssignment row.
    secondary_projects = (
        db.query(Project.id)
        .filter(
            Project.org_id == current_user.org_id,
            Project.secondary_evaluator_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )

    if not secondary_projects:
        return []

    project_ids = [pid for (pid,) in secondary_projects]

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
            ProjectReview.user_id != current_user.id,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    # Redact the PM's rating per the per-FY visibility rule — same gate as
    # get_review, so the secondary queue can't bypass `project_ratings_visible`.
    active_cycle = _get_active_cycle(db, current_user.org_id)
    responses = []
    for r in reviews:
        resp = _build_review_response(r, db, viewer_user_id=current_user.id)
        reviewee = db.query(User).filter(User.id == r.user_id).first()
        is_mentor = bool(reviewee and reviewee.mentor_id == current_user.id)
        resp.performance_group = _visible_performance_group(
            r, current_user, db, current_user.org_id, active_cycle, is_mentor=is_mentor,
        )
        responses.append(resp)
    return responses


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

    # Verify caller is the project's Secondary evaluator (project-level field).
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
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

    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted your evaluation for this review.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.status = EvaluatorStatus.SUBMITTED.value
        existing.impact_statement = payload.impact_statement
        evaluator = existing
    else:
        # Block only the creation of a NEW impact statement on a completed
        # project; an in-flight draft can still be finished — matching the PM
        # flow and PUT /{review_id}/secondary.
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
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
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.patch("/{review_id}/secondary/draft", response_model=SecondaryEvalResponse)
def save_secondary_draft(
    review_id: int,
    payload: SecondaryEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Secondary evaluator saves an in-progress impact statement as DRAFT.
    The row uses ``EvaluatorStatus.DRAFT`` so the PM, mentor, and mentee
    don't see it until the evaluator submits via POST /secondary.
    """
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

    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
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
    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Your impact statement has already been submitted; drafts "
                "can no longer be saved."
            ),
        )

    if existing is not None:
        if payload.impact_statement is not None:
            existing.impact_statement = payload.impact_statement
        existing.status = EvaluatorStatus.DRAFT.value
        evaluator = existing
    else:
        # Block only NEW impact statements on a completed project; an existing
        # draft stays editable (matches the PM flow).
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
            )
        evaluator = ProjectReviewEvaluator(
            org_id=current_user.org_id,
            project_review_id=review.id,
            evaluator_id=current_user.id,
            evaluator_type="Secondary",
            status=EvaluatorStatus.DRAFT.value,
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
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.put("/{review_id}/secondary", response_model=SecondaryEvalResponse)
def update_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator updates their previously submitted impact statement."""
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

    # Caller must still be the project's Secondary evaluator — matches the
    # POST/draft guards so a replaced secondary can't keep editing their old
    # impact statement (and blocks edits on a soft-deleted project).
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existing secondary evaluation found to update.",
        )

    existing.impact_statement = payload.impact_statement
    db.commit()
    db.refresh(existing)

    ev_user = db.query(User).filter(User.id == existing.evaluator_id).first()
    return SecondaryEvalResponse(
        id=existing.id,
        evaluator_id=existing.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=existing.impact_statement,
        status=existing.status,
        created_at=existing.created_at,
    )


# =====================================================================
# ADMIN OVERVIEW
# =====================================================================

@router.get("/all", response_model=List[ProjectReviewResponse])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
    cycle: Optional[str] = None,
    fy_year: Optional[int] = Query(None, ge=2000, le=2100),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Admin-only: list project reviews across the org.

    Pass ``fy_year`` (e.g. 2026 → FY26-27) to load just one fiscal year — the
    All Reviews tab sends the selected Year so the browser only fetches that
    year's reviews, then groups + filters (employee / project / reviewer /
    progress) + paginates client-side. Omit it to return every cycle/year.
    ``cycle`` narrows to a single exact cycle (e.g. "H1 FY26-27"). Reviews
    whose project is soft-deleted or whose reviewee is deactivated are excluded
    so the tab never shows orphaned rows. ``limit``/``offset`` are optional.
    """
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view all reviews.",
        )

    query = (
        db.query(ProjectReview)
        .join(Project, Project.id == ProjectReview.project_id)
        .join(User, User.id == ProjectReview.user_id)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.is_deleted == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            User.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc(), ProjectReview.id.desc())
    )

    # Year filter — load just one fiscal year. The cycle label embeds the FY
    # token (e.g. "H1 FY26-27"), so match the FY suffix; "FY26-27" covers both
    # H1 and H2 of that year.
    if fy_year is not None:
        token = f"FY{fy_year % 100:02d}-{(fy_year + 1) % 100:02d}"
        query = query.filter(ProjectReview.cycle.like(f"%{token}"))

    # Optional narrowing to one exact cycle.
    if cycle:
        query = query.filter(ProjectReview.cycle == cycle)

    if limit is not None:
        query = query.offset(offset).limit(limit)
    elif offset:
        query = query.offset(offset)

    reviews = query.all()
    return [_build_review_response(r, db, viewer_user_id=current_user.id) for r in reviews]


def _fy_start_year(cycle: Optional[str]) -> Optional[int]:
    """Parse the fiscal start year from a cycle label ("H1 FY26-27" → 2026)."""
    if not cycle:
        return None
    idx = cycle.find("FY")
    if idx == -1:
        return None
    digits = cycle[idx + 2 : idx + 4]
    return 2000 + int(digits) if digits.isdigit() else None


@router.get("/all/years", response_model=List[int])
def get_all_review_years(
    db: DbSession,
    current_user: CurrentUser,
):
    """Admin-only: distinct fiscal start years that have project reviews —
    feeds the All Reviews tab's Year dropdown. Scoped like /all (non-deleted
    reviews, non-deleted projects, active reviewees). Newest year first."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view all reviews.",
        )
    cycles = (
        db.query(ProjectReview.cycle)
        .join(Project, Project.id == ProjectReview.project_id)
        .join(User, User.id == ProjectReview.user_id)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.is_deleted == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            User.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .all()
    )
    years: set[int] = set()
    for (cycle_name,) in cycles:
        y = _fy_start_year(cycle_name)
        if y is not None:
            years.add(y)
    return sorted(years, reverse=True)


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

@router.get("/management", response_model=List[AdminProjectSummary])
def get_management_overview(
    db: DbSession,
    current_user: CurrentUser,
    cycle: Optional[str] = None,
):
    """
    Admin: per-project review completion overview for the active cycle.

    Returns one AdminProjectSummary per project that has non-PM members,
    each containing per-member review status. Uses eager loading to avoid
    N+1 queries — all project/assignment/user/department data is fetched
    in a single query, and a review_map dict provides O(1) lookups.
    """
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only.",
        )

    resolved_cycle = cycle if cycle else _get_active_cycle(db, current_user.org_id)

    # Single query: projects + assignments + users + departments
    projects = (
        db.query(Project)
        .options(
            joinedload(Project.assignments).joinedload(ProjectAssignment.user),
            joinedload(Project.assignments).joinedload(ProjectAssignment.department),
        )
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    # All reviews for this org + cycle in one query → O(1) dict lookup
    all_reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == resolved_cycle,
        )
        .all()
    )
    review_map: dict[tuple[int, int], ProjectReview] = {
        (r.project_id, r.user_id): r for r in all_reviews
    }

    summaries: list[AdminProjectSummary] = []

    for project in projects:
        members: list[AdminMemberReviewRow] = []
        reviewed_count = 0
        pm_name: str | None = None

        for a in project.assignments:
            if not a.user or a.user.is_deleted:
                continue

            if a.evaluator_type == "Primary":
                pm_name = a.user.full_name
                continue  # PM is excluded from the members list

            review = review_map.get((project.id, a.user_id))
            review_status = review.status if review else "not_started"

            if review_status == ProjectReviewStatus.REVIEWED.value:
                reviewed_count += 1

            members.append(AdminMemberReviewRow(
                review_id=review.id if review else None,
                user_id=a.user_id,
                employee_name=a.user.full_name,
                assignment_role=a.assignment_role,
                department_name=a.department.name if a.department else None,
                review_status=review_status,
                performance_group=review.performance_group if review else None,
            ))

        if members:
            summaries.append(AdminProjectSummary(
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                pm_name=pm_name,
                total_members=len(members),
                reviewed_count=reviewed_count,
                members=members,
            ))

    return summaries


# =====================================================================
# SINGLE REVIEW — GET + PUT (must be LAST — catch-all paths)
# =====================================================================

@router.put("/{review_id}", response_model=ProjectReviewResponse)
def update_review(
    review_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM (or Admin) edits an already-submitted review.

    Authorization: ONLY the PM who originally wrote the review
    (review.reviewer_id == current_user.id) or an Admin may update it.
    The employee who was reviewed cannot edit it.
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
    is_reviewer = review.reviewer_id == current_user.id
    # A newly-assigned PM inherits edit rights on the project's reviews — the
    # current active Primary, not just whoever first authored the row. This
    # lets a reassigned PM continue/own in-flight evaluations like a regular PM.
    is_current_pm = db.query(ProjectAssignment.id).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first() is not None

    if not (is_reviewer or is_current_pm or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project's PM (or an Admin) may edit this review.",
        )

    # Keep attribution truthful: the acting PM becomes the recorded reviewer.
    if not is_admin:
        review.reviewer_id = current_user.id

    review.comment_task_execution = payload.comment_task_execution
    review.comment_ownership = payload.comment_ownership
    review.comment_project_management = payload.comment_project_management
    review.comment_client_deliverables = payload.comment_client_deliverables
    review.comment_communication = payload.comment_communication
    review.comment_mentoring = payload.comment_mentoring
    review.comment_competency_skills = payload.comment_competency_skills
    review.impact_statement = payload.impact_statement
    review.performance_group = payload.performance_group.value

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db, viewer_user_id=current_user.id)


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
    is_reviewer = review.reviewer_id == current_user.id  # the PM who authored it

    # Current Primary PM of the project — covers a reassigned PM who didn't
    # author the row. NOT "any active member": that leaked peers' reviews.
    is_pm = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.evaluator_type == "Primary",
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first() is not None

    # Secondary evaluator is a project-level field.
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
    ).first()
    is_secondary = bool(project and project.secondary_evaluator_id == current_user.id)

    # Reviewee's live mentor (also drives rating visibility below).
    reviewee = db.query(User).filter(User.id == review.user_id).first()
    is_mentor = bool(reviewee and reviewee.mentor_id == current_user.id)

    if not (is_owner or is_reviewer or is_pm or is_secondary or is_mentor or is_admin):
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

    resp = _build_review_response(review, db, viewer_user_id=current_user.id)
    # Apply the same per-FY rating-visibility rule as /mine so this endpoint
    # can't be used to bypass `project_ratings_visible` (e.g. the reviewee
    # reading the raw rating before it's published). Admins, the rating's
    # author, and the reviewee's mentor always see it.
    resp.performance_group = _visible_performance_group(
        review,
        current_user,
        db,
        current_user.org_id,
        _get_active_cycle(db, current_user.org_id),
        is_mentor=is_mentor,
    )
    return resp
