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

    ── Reports-To (the PM's evaluator) ──
    GET   /project-reviews/reports-to-queue                  → PMs awaiting evaluation
    POST  /project-reviews/reports-to/{project_id}/evaluate  → Submit the PM's evaluation

    ── Secondary Evaluator ──
    GET   /project-reviews/secondary-queue                    → Members awaiting secondary feedback (incl. before PM)
    POST  /project-reviews/{project_id}/secondary/{user_id}   → Submit secondary impact statement

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
    _half_label_of_project_review,
    extract_fy_label,
    get_year_override,
)
from app.models.competency_models import Competency
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
    CompetencyResponse,
    CompetencySetResponse,
    MyProjectCard,
    PMEvaluationDraft,
    PMEvaluationSubmit,
    PMPendingReviewCard,
    ProjectReviewResponse,
    RoleExpectationResponse,
    SecondaryEvalCard,
    SecondaryEvalDraft,
    SecondaryEvalResponse,
    SecondaryEvalSubmit,
)
from app.services.competency_service import get_competency_set

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

# The 7 reviewable default-competency keys mapped to their legacy comment_*
# columns. This bridges the fixed request/response contract to the dynamic
# `comments` JSON while the two coexist (expand phase). firm_growth is
# expectation-only and has no comment column, so it's absent here.
_COMMENT_FIELD_BY_KEY = {
    "task_execution": "comment_task_execution",
    "ownership": "comment_ownership",
    "project_management": "comment_project_management",
    "client_deliverables": "comment_client_deliverables",
    "communication": "comment_communication",
    "mentoring": "comment_mentoring",
    "competency_skills": "comment_competency_skills",
}


def _default_competency_id_by_key(db: DbSession, org_id: int) -> dict[str, int]:
    """{competency key -> id} for the org's DEFAULT reviewable competencies.

    The bridge between the fixed comment_* columns and the `comments` JSON,
    which is keyed by competency id. Empty if the org has no default set
    seeded yet (pre-migration), in which case the JSON sync is a safe no-op.
    """
    rows = (
        db.query(Competency)
        .filter(
            Competency.org_id == org_id,
            Competency.department_id.is_(None),
            Competency.level.is_(None),
            Competency.is_reviewable.is_(True),
            Competency.is_deleted.is_(False),
        )
        .all()
    )
    return {c.key: c.id for c in rows}


def _sync_review_comments_json(db: DbSession, review: ProjectReview) -> None:
    """Mirror the legacy comment_* columns into review.comments JSON.

    Keeps the JSON (the read source of truth) in lockstep with the columns on
    every write path, keyed by the org's default competency ids. Reassigns the
    whole dict so SQLAlchemy marks the column dirty. No-op if the org has no
    default competencies seeded (keeps pre-migration writes working)."""
    key_to_id = _default_competency_id_by_key(db, review.org_id)
    if not key_to_id:
        return
    review.comments = {
        str(key_to_id[key]): getattr(review, field)
        for key, field in _COMMENT_FIELD_BY_KEY.items()
        if key in key_to_id
    }


def _resolved_comment_values(
    db: DbSession, review: ProjectReview
) -> dict[str, Optional[str]]:
    """The 7 comment values for the API response.

    Base = the legacy comment_* columns; the `comments` JSON (the source of
    truth) is then overlaid PER FIELD. The overlay is deliberately per-field
    rather than all-or-nothing: a competency id that no longer resolves — e.g.
    a default competency later soft-deleted or re-flagged by framework
    management — leaves the column value showing through instead of silently
    dropping the comment. In the expand phase the JSON mirrors the columns, so
    this is behaviourally identical today; it also covers rows written by
    pre-cutover code (JSON absent → columns used as-is).
    """
    out: dict[str, Optional[str]] = {
        field: getattr(review, field) for field in _COMMENT_FIELD_BY_KEY.values()
    }
    if review.comments:
        id_to_key = {
            str(cid): key
            for key, cid in _default_competency_id_by_key(db, review.org_id).items()
        }
        for cid, text in review.comments.items():
            key = id_to_key.get(str(cid))
            if key:
                out[_COMMENT_FIELD_BY_KEY[key]] = text
    return out


def _comments_map_for_response(
    db: DbSession, review: ProjectReview
) -> Optional[dict[str, Optional[str]]]:
    """The {competency_id: text} map for the API response.

    Prefers the stored `comments` JSON (source of truth, and forward-compatible
    with custom competencies whose ids aren't in the default set). For a legacy
    row with no JSON, builds the map from the comment_* columns keyed by the
    org's default competency ids. Returns None when there's nothing to show
    (e.g. an empty placeholder row)."""
    if review.comments:
        return review.comments
    key_to_id = _default_competency_id_by_key(db, review.org_id)
    built: dict[str, Optional[str]] = {
        str(key_to_id[key]): getattr(review, field)
        for key, field in _COMMENT_FIELD_BY_KEY.items()
        if key in key_to_id
    }
    return built if any(built.values()) else None


def _pm_review_has_draft_content(review: ProjectReview) -> bool:
    """True iff the PM has typed anything into this review row.

    Distinguishes a saved draft from the empty placeholder rows that
    seed.py / the queue pre-creates for upcoming cycles. A row counts as
    a draft if any of: rating selected, impact statement filled, or any
    per-competency comment present (after stripping whitespace). Checks both
    the JSON and the legacy columns (a union) so it's correct regardless of
    which source a given row was written through.
    """
    if review.performance_group:
        return True
    if review.impact_statement and review.impact_statement.strip():
        return True
    if review.comments:
        for v in review.comments.values():
            if v and v.strip():
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

    Draft gate (the reported leak): a saved-but-unsubmitted rating
    (status != reviewed) is private to the PM writing it (the author) and to
    admins. It must NEVER surface to the rated employee or their mentor — not
    even when `project_ratings_visible` is on — until the PM submits the
    evaluation (status → reviewed).

    Per-FY project-rating visibility (decision #6 — mentors always see), applied
    only once the review is `reviewed`:
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

    is_admin = viewer.role == "Admin"
    is_author = review.reviewer_id == viewer.id

    # Until the PM submits, the rating is a private draft. Only the author (the
    # PM drafting it) and admins may see it; the reviewed employee and their
    # mentor see nothing, regardless of the visibility toggle. Without this
    # gate, an admin who had enabled "View ratings" for the half would leak the
    # PM's draft rating to the team member before Evaluate was completed.
    if review.status != ProjectReviewStatus.REVIEWED.value:
        return group if (is_admin or is_author) else None

    review_fy = _fy_label_of_project_review(review)
    active_fy = extract_fy_label(active_cycle_name)
    if review_fy != active_fy:
        return group
    if is_admin or is_author or is_mentor:
        return group
    # Within the active FY, project-rating visibility is controlled per half.
    override = get_year_override(db, org_id, _half_label_of_project_review(review))
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

    # A Secondary can now write an impact statement BEFORE the PM finalises the
    # review (status still pending). That early impact must stay private until
    # the PM completes their evaluation, so it can't pre-empt or bias the PM /
    # mentee / mentor. Visibility rule:
    #   - the author always sees their own row (draft or submitted), so
    #     reopening the modal prefills;
    #   - everyone else sees a SUBMITTED impact only once the review is REVIEWED.
    # In the classic flow (secondary writes after the PM) the review is already
    # REVIEWED, so this is a no-op there.
    review_finalized = review.status == ProjectReviewStatus.REVIEWED.value
    secondary_responses: list[SecondaryEvalResponse] = []
    for ev in review.secondary_evaluations:
        is_author = viewer_user_id is not None and ev.evaluator_id == viewer_user_id
        if is_author or (
            ev.status == EvaluatorStatus.SUBMITTED.value and review_finalized
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

    comment_values = _resolved_comment_values(db, review)

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
        comment_task_execution=comment_values["comment_task_execution"],
        comment_ownership=comment_values["comment_ownership"],
        comment_project_management=comment_values["comment_project_management"],
        comment_client_deliverables=comment_values["comment_client_deliverables"],
        comment_communication=comment_values["comment_communication"],
        comment_mentoring=comment_values["comment_mentoring"],
        comment_competency_skills=comment_values["comment_competency_skills"],
        comments=_comments_map_for_response(db, review),
        performance_group=review.performance_group,
        impact_statement=review.impact_statement,
        secondary_evaluations=secondary_responses,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


# =====================================================================
# MULTI-PM HIERARCHY ROUTING
#
# A project routes evaluations one of two ways, decided by
# Project.multi_pm_enabled:
#
#   single-PM  — the one member flagged evaluator_type == "Primary" evaluates
#                every other member; that Primary is in turn evaluated by the
#                project's reports_to senior.
#   multi-PM   — each member is evaluated by their own manager_id (their DIRECT
#                PM). A PM sees only their direct reports (manager_id == them),
#                never the whole subtree, so in a chain A -> B -> C, A reviews B
#                and B reviews C — A never reviews C. Members with no manager_id
#                are "roots", evaluated by the project's reports_to senior
#                (there may be several roots, e.g. a flat team with no central
#                PM). A member's PM / secondary may be any org user.
#
# The single-PM path is preserved exactly, so existing projects are unaffected.
# =====================================================================


def _member_assignment(
    db: DbSession, org_id: int, project_id: int, user_id: int
) -> Optional[ProjectAssignment]:
    """The active assignment row for (project, user), or None."""
    return (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.user_id == user_id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def _is_member_pm(
    db: DbSession, viewer: User, project: Project, review_user_id: int
) -> bool:
    """True if `viewer` is the PM who evaluates `review_user_id` on `project`.

    Multi-PM: the member's direct manager (manager_id). Single-PM: any current
    Primary of the project (covers a reassigned PM who didn't author the row).
    """
    if project.multi_pm_enabled:
        target = _member_assignment(db, viewer.org_id, project.id, review_user_id)
        return bool(target and target.manager_id == viewer.id)
    pm = _project_primary_assignment(db, viewer.org_id, project.id)
    return bool(pm and pm.user_id == viewer.id)


def _is_member_secondary(
    db: DbSession, viewer: User, project: Project, review_user_id: int
) -> bool:
    """True if `viewer` is the Secondary evaluator for `review_user_id`.

    Multi-PM: the member's per-member secondary_evaluator_id. Single-PM: the
    project-level secondary_evaluator_id.
    """
    if project.multi_pm_enabled:
        target = _member_assignment(db, viewer.org_id, project.id, review_user_id)
        return bool(target and target.secondary_evaluator_id == viewer.id)
    return project.secondary_evaluator_id == viewer.id


def _authorize_member_evaluation(
    db: DbSession, current_user: User, project: Project, target: ProjectAssignment
) -> None:
    """Raise 403 unless `current_user` is the PM who evaluates `target`."""
    if _is_member_pm(db, current_user, project, target.user_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "You are not this team member's Project Manager."
            if project.multi_pm_enabled
            else "You are not the Project Manager for this project."
        ),
    )


def _project_root_assignments(
    db: DbSession, org_id: int, project: Project
) -> List[ProjectAssignment]:
    """The members reviewed by the project's reports_to senior.

    Multi-PM: every member with no manager_id (the roots). Single-PM: the
    project's Primary. The reports_to senior evaluates each of these; the
    routing layer skips any self-pair (a root who is also the reports_to).
    """
    q = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == org_id,
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
    )
    if project.multi_pm_enabled:
        return q.filter(ProjectAssignment.manager_id.is_(None)).all()
    return q.filter(ProjectAssignment.evaluator_type == "Primary").all()


# =====================================================================
# EMPLOYEE ENDPOINTS
# =====================================================================

def _resolve_secondary_evaluator_id(
    project: Project, assignment: ProjectAssignment
) -> Optional[int]:
    """The secondary evaluator's user_id for a (project, reviewee): the member's
    per-assignment secondary in multi-PM mode, else the project-level secondary."""
    if project.multi_pm_enabled and assignment.secondary_evaluator_id:
        return assignment.secondary_evaluator_id
    return project.secondary_evaluator_id


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
            Project.review_eligible == True,  # noqa: E712
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

    # Resolve each card's "PM" = who reviews the current user on that project.
    # Multi-PM: their direct manager (manager_id), or the project's reports_to
    # senior when they're a root. Single-PM: the project's Primary.
    pm_user_id_by_project = dict(
        db.query(ProjectAssignment.project_id, ProjectAssignment.user_id)
        .filter(
            ProjectAssignment.project_id.in_(project_ids),
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    def _reviewer_uid_for(a: ProjectAssignment) -> Optional[int]:
        project = projects_by_id.get(a.project_id)
        if project and project.multi_pm_enabled:
            return a.manager_id if a.manager_id is not None else project.reports_to_id
        return pm_user_id_by_project.get(a.project_id)

    reviewer_uids = {uid for uid in (_reviewer_uid_for(a) for a in assignments) if uid}
    pm_name_by_user_id = (
        {
            u.id: u.full_name
            for u in db.query(User).filter(User.id.in_(reviewer_uids)).all()
        }
        if reviewer_uids
        else {}
    )

    # Secondary evaluator per project for THIS user: per-member override in
    # multi-PM mode, else the project-level secondary. Batch the name lookup.
    sec_id_by_project: dict[int, Optional[int]] = {}
    for a in assignments:
        proj = projects_by_id.get(a.project_id)
        if proj:
            sec_id_by_project[a.project_id] = _resolve_secondary_evaluator_id(proj, a)
    _sec_ids = {sid for sid in sec_id_by_project.values() if sid}
    sec_name_by_user_id = (
        {
            u.id: u.full_name
            for u in db.query(User).filter(User.id.in_(_sec_ids)).all()
        }
        if _sec_ids
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
            ProjectReview.is_deleted == False,  # noqa: E712
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
        pm_name = pm_name_by_user_id.get(_reviewer_uid_for(a))

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
                department_id=dept.id if dept else None,
                level=my_designation.level if my_designation else None,
                review_status=review.status,
                performance_group=_visible_performance_group(
                    review, current_user, db, current_user.org_id, current_cycle
                ),
                pm_name=pm_name,
                secondary_evaluator_name=sec_name_by_user_id.get(
                    sec_id_by_project.get(a.project_id)
                ),
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
                department_id=dept.id if dept else None,
                level=my_designation.level if my_designation else None,
                review_status="pending",
                pm_name=pm_name,
                secondary_evaluator_name=sec_name_by_user_id.get(
                    sec_id_by_project.get(a.project_id)
                ),
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

    # Projects I evaluate members on, drawn from both modes:
    #  - single-PM: projects where I'm the Primary (I review everyone),
    #  - multi-PM:  projects where I'm someone's direct manager (manager_id).
    primary_project_ids = [
        pid
        for (pid,) in db.query(ProjectAssignment.project_id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    ]
    managed_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.manager_id == current_user.id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    candidate_project_ids = set(primary_project_ids) | {
        a.project_id for a in managed_assignments
    }
    if not candidate_project_ids:
        return []

    # ── Batch lookups (replaces the per-member / per-project N+1) ────
    projects_by_id = {
        p.id: p
        for p in db.query(Project)
        .filter(
            Project.id.in_(candidate_project_ids),
            Project.is_deleted == False,  # noqa: E712
            Project.review_eligible == True,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    }
    if not projects_by_id:
        return []
    visible_project_ids = list(projects_by_id.keys())

    # The members I must evaluate, per project + mode. Project-level eligibility
    # (review_eligible) is already applied above via visible_project_ids, so
    # there's no per-member filter — per-member review scope (review_included)
    # was removed in favour of the project-level flag.
    team_by_project: dict[int, list[ProjectAssignment]] = {}
    #  multi-PM — my DIRECT reports (manager_id == me) on visible multi-PM projects
    for a in managed_assignments:
        project = projects_by_id.get(a.project_id)
        if (
            project
            and project.multi_pm_enabled
            and a.user_id != current_user.id
        ):
            team_by_project.setdefault(a.project_id, []).append(a)
    #  single-PM — every other in-scope member on projects where I'm the Primary
    single_pm_project_ids = [
        pid
        for pid in primary_project_ids
        if pid in projects_by_id and not projects_by_id[pid].multi_pm_enabled
    ]
    if single_pm_project_ids:
        for a in (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_id.in_(single_pm_project_ids),
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.user_id != current_user.id,
                ProjectAssignment.is_deleted == False,  # noqa: E712
            )
            .all()
        ):
            team_by_project.setdefault(a.project_id, []).append(a)

    if not team_by_project:
        return []
    team_assignments = [a for members in team_by_project.values() for a in members]

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

    # Secondary evaluator per (project, member): per-member override in multi-PM
    # mode, else the project-level secondary. Batch the name lookup.
    sec_id_by_pair: dict[tuple[int, int], Optional[int]] = {}
    for ta in team_assignments:
        proj = projects_by_id.get(ta.project_id)
        if proj:
            sec_id_by_pair[(ta.project_id, ta.user_id)] = (
                _resolve_secondary_evaluator_id(proj, ta)
            )
    _sec_ids = {sid for sid in sec_id_by_pair.values() if sid}
    sec_name_by_user_id = (
        {u.id: u.full_name for u in db.query(User).filter(User.id.in_(_sec_ids)).all()}
        if _sec_ids
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

    # Iterate project order, then members — one card block per project.
    for project_id, members in team_by_project.items():
        project = projects_by_id.get(project_id)
        if not project:
            continue

        for ta in members:
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
                    secondary_evaluator_name=sec_name_by_user_id.get(
                        sec_id_by_pair.get((ta.project_id, ta.user_id))
                    ),
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    department_id=dept.id if dept else None,
                    level=desig.level if desig else None,
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
                    secondary_evaluator_name=sec_name_by_user_id.get(
                        sec_id_by_pair.get((ta.project_id, ta.user_id))
                    ),
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    department_id=dept.id if dept else None,
                    level=desig.level if desig else None,
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
            expectations=exp.expectations,
        ))

    return results


@router.get("/competencies", response_model=CompetencySetResponse)
def get_competencies(
    db: DbSession,
    current_user: CurrentUser,
    department_id: Optional[int] = Query(None),
    level: Optional[int] = Query(None),
):
    """Resolve the competency set for a (department, level).

    Falls back to the org DEFAULT set (flagged ``is_default=True``) when the
    given (department, level) has no framework of its own — or when either
    parameter is omitted. Read-only reference used by the evaluation form and
    the expectations panel.
    """
    competencies, is_default = get_competency_set(
        db, current_user.org_id, department_id, level
    )
    return CompetencySetResponse(
        is_default=is_default,
        competencies=[
            CompetencyResponse.model_validate(c) for c in competencies
        ],
    )


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

    # Verify caller is the PM who evaluates THIS member (mode-aware): the
    # member's direct manager in multi-PM, or the project's Primary otherwise.
    _authorize_member_evaluation(db, current_user, project, target_assignment)

    # Ineligible project — no review may be filed for it.
    if not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
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

    _sync_review_comments_json(db, review)
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

    # Same mode-aware role gate as submit.
    _authorize_member_evaluation(db, current_user, project, target_assignment)

    if not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
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

    _sync_review_comments_json(db, review)
    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer_user_id=current_user.id)


# =====================================================================
# REPORTS-TO ENDPOINTS  (the senior who evaluates the PM)
#
# A project's PM (ProjectAssignment.evaluator_type == "Primary") evaluates the
# team members. The PM in turn is evaluated by the project's `reports_to`
# senior (Project.reports_to_id). These endpoints mirror the PM ones, but the
# reviewee is always the PM: the ProjectReview is stored with user_id = the PM
# and reviewer_id = the reports-to user, reusing the same competency payload.
# =====================================================================

def _project_primary_assignment(
    db: DbSession, org_id: int, project_id: int
) -> Optional[ProjectAssignment]:
    """The active Primary (PM) assignment for a project, or None."""
    return (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .first()
    )


def _resolve_reports_to_target(
    db: DbSession, current_user: User, project_id: int, user_id: int
) -> Project:
    """Auth + validation for a reports-to senior evaluating one reviewee.

    The caller must be the project's reports_to senior, and `user_id` must be a
    valid reviewee for that role: a root member (multi-PM — any member with no
    manager_id) or the Primary (single-PM). No one evaluates themselves. Returns
    the project; raises the matching HTTP error otherwise.
    """
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    if project.reports_to_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the reviewer of this project's Project Manager.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )
    root_ids = {a.user_id for a in _project_root_assignments(db, current_user.org_id, project)}
    if user_id not in root_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This person is not a Project Manager you evaluate on this project.",
        )
    return project


@router.get("/reports-to-queue", response_model=List[PMPendingReviewCard])
def get_reports_to_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PMs the current user must evaluate — the "roots" on every project where the
    current user is the `reports_to` senior. In single-PM projects that's the
    one Primary; in multi-PM projects it's every top-level member (no manager_id
    of their own), so a flat team with several top-level members yields several
    cards. Mirrors the PM queue: one card per existing review (any cycle) + an
    active-cycle placeholder. Self-pairs (reports_to who is also a root) are
    skipped — no one reviews themselves.
    """
    active_cycle = _get_active_cycle(db, current_user.org_id)

    projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.reports_to_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
            Project.review_eligible == True,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )
    if not projects:
        return []
    projects_by_id = {p.id: p for p in projects}

    # The reviewees (roots) per project, mode-aware and batched by mode.
    multi_ids = [p.id for p in projects if p.multi_pm_enabled]
    single_ids = [p.id for p in projects if not p.multi_pm_enabled]
    roots_by_project: dict[int, list[ProjectAssignment]] = {}
    root_query_parts: list[ProjectAssignment] = []
    if multi_ids:
        root_query_parts += (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.project_id.in_(multi_ids),
                ProjectAssignment.manager_id.is_(None),
                ProjectAssignment.is_deleted == False,  # noqa: E712
            )
            .all()
        )
    if single_ids:
        root_query_parts += (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.project_id.in_(single_ids),
                ProjectAssignment.evaluator_type == "Primary",
                ProjectAssignment.is_deleted == False,  # noqa: E712
            )
            .all()
        )
    for a in root_query_parts:
        # Never ask someone to evaluate themselves (reports_to == a root).
        if a.user_id == current_user.id:
            continue
        roots_by_project.setdefault(a.project_id, []).append(a)
    if not roots_by_project:
        return []

    root_user_ids = {a.user_id for a in root_query_parts}
    users_by_id = {
        u.id: u for u in db.query(User).filter(User.id.in_(root_user_ids)).all()
    }
    dept_ids = {a.department_id for a in root_query_parts if a.department_id}
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

    project_ids = list(projects_by_id.keys())

    # Secondary evaluator per (project, root PM): per-member override in multi-PM
    # mode, else the project-level secondary. Batch the name lookup.
    sec_id_by_pair: dict[tuple[int, int], Optional[int]] = {}
    for _pid, _roots in roots_by_project.items():
        _proj = projects_by_id.get(_pid)
        if not _proj:
            continue
        for _root_a in _roots:
            sec_id_by_pair[(_pid, _root_a.user_id)] = (
                _resolve_secondary_evaluator_id(_proj, _root_a)
            )
    _sec_ids = {sid for sid in sec_id_by_pair.values() if sid}
    sec_name_by_user_id = (
        {u.id: u.full_name for u in db.query(User).filter(User.id.in_(_sec_ids)).all()}
        if _sec_ids
        else {}
    )

    # Root reviews on these projects (all cycles), grouped by (project, root).
    reviews_by_pair: dict[tuple[int, int], list[ProjectReview]] = {}
    for rv in (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.user_id.in_(root_user_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    ):
        reviews_by_pair.setdefault((rv.project_id, rv.user_id), []).append(rv)

    cards: list[PMPendingReviewCard] = []
    for project_id, roots in roots_by_project.items():
        project = projects_by_id.get(project_id)
        if not project:
            continue
        for root_a in roots:
            root_user = users_by_id.get(root_a.user_id)
            if not root_user or root_user.is_deleted:
                continue

            dept = depts_by_id.get(root_a.department_id) if root_a.department_id else None
            desig = desigs_by_id.get(root_user.designation_id) if root_user.designation_id else None

            reviews = reviews_by_pair.get((project.id, root_a.user_id), [])
            cycles_with_review = {r.cycle for r in reviews}

            for review in reviews:
                cards.append(PMPendingReviewCard(
                    review_id=review.id,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=root_a.user_id,
                    employee_name=root_user.full_name,
                    secondary_evaluator_name=sec_name_by_user_id.get(
                        sec_id_by_pair.get((project.id, root_a.user_id))
                    ),
                    assignment_role=root_a.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    department_id=dept.id if dept else None,
                    level=desig.level if desig else None,
                    assigned_date=root_a.assigned_date,
                    review_status=review.status,
                    performance_group=review.performance_group,
                    cycle=review.cycle,
                    has_draft_content=_pm_review_has_draft_content(review),
                ))

            if active_cycle not in cycles_with_review:
                cards.append(PMPendingReviewCard(
                    review_id=None,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=root_a.user_id,
                    employee_name=root_user.full_name,
                    secondary_evaluator_name=sec_name_by_user_id.get(
                        sec_id_by_pair.get((project.id, root_a.user_id))
                    ),
                    assignment_role=root_a.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    department_id=dept.id if dept else None,
                    level=desig.level if desig else None,
                    assigned_date=root_a.assigned_date,
                    review_status=None,
                    performance_group=None,
                    cycle=active_cycle,
                    has_draft_content=False,
                ))

    return cards


@router.post(
    "/reports-to/{project_id}/evaluate/{user_id}",
    response_model=ProjectReviewResponse,
    status_code=status.HTTP_201_CREATED,
)
def submit_reports_to_evaluation(
    project_id: int,
    user_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    The project's reports-to senior submits the evaluation of a root PM.

    Mirrors submit_pm_evaluation, but the reviewee is a "root" — the project's
    single Primary (single-PM) or one of its top-level members (multi-PM). The
    ProjectReview is stored with user_id = that root and reviewer_id = the
    reports-to senior.
    """
    cycle = _get_active_cycle(db, current_user.org_id)
    project = _resolve_reports_to_target(db, current_user, project_id, user_id)
    pm_user_id = user_id

    if not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
        )

    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == pm_user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Project Manager has already been evaluated for this project this cycle.",
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
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
            )
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=pm_user_id,
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

    _sync_review_comments_json(db, review)
    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer_user_id=current_user.id)


@router.patch(
    "/reports-to/{project_id}/evaluate/{user_id}/draft",
    response_model=ProjectReviewResponse,
)
def save_reports_to_evaluation_draft(
    project_id: int,
    user_id: int,
    payload: PMEvaluationDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """Reports-to senior saves an in-progress evaluation of a root PM as DRAFT."""
    cycle = _get_active_cycle(db, current_user.org_id)
    project = _resolve_reports_to_target(db, current_user, project_id, user_id)
    pm_user_id = user_id

    if not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
        )

    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == pm_user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This Project Manager has already been evaluated; drafts can no "
                "longer be saved."
            ),
        )

    if not review:
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot start a new review on a completed project. Re-open it first.",
            )
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=pm_user_id,
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
            setattr(review, field, value.value if hasattr(value, "value") else value)
        else:
            setattr(review, field, value)

    _sync_review_comments_json(db, review)
    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer_user_id=current_user.id)


# =====================================================================
# SECONDARY EVALUATOR ENDPOINTS
# =====================================================================

def _authorize_secondary_write(
    db: DbSession, current_user: User, project_id: int, user_id: int
) -> Project:
    """Shared guard for the secondary write routes.

    Returns the Project when the caller may write a Secondary impact statement
    for `user_id` on `project_id`; raises the appropriate HTTPException
    otherwise. Ordering mirrors the PM-evaluate guards.
    """
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    if not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )
    if not _is_member_secondary(db, current_user, project, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this team member.",
        )
    # The reviewee must actually be on the team (single-PM's _is_member_secondary
    # is project-level, so it passes for any user_id — this catches non-members).
    if _member_assignment(db, current_user.org_id, project.id, user_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This user is not assigned to this project.",
        )
    return project


def _get_or_create_secondary_review(
    db: DbSession, current_user: User, project: Project, user_id: int
) -> ProjectReview:
    """Return the active-cycle ProjectReview for (project, member), lazily
    creating a reviewer-less PENDING placeholder when the PM hasn't started —
    so a Secondary can write their impact BEFORE the PM evaluates. The PM's
    later evaluate finds this same row (by project+user+cycle) and promotes it
    to REVIEWED, preserving the impact. Raises 409 when a new row would have to
    be created on a completed project."""
    cycle = _get_active_cycle(db, current_user.org_id)
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project.id,
        ProjectReview.cycle == cycle,
        ProjectReview.is_deleted == False,  # noqa: E712
    ).first()
    if review:
        return review
    if project.status == PROJECT_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot start a new review on a completed project. Re-open it first.",
        )
    review = ProjectReview(
        org_id=current_user.org_id,
        user_id=user_id,
        project_id=project.id,
        reviewer_id=None,
        cycle=cycle,
        status=ProjectReviewStatus.PENDING.value,
    )
    db.add(review)
    db.flush()  # assign review.id for the evaluator row + response
    return review


@router.get("/secondary-queue", response_model=List[SecondaryEvalCard])
def get_secondary_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List every team member the current user is a Secondary evaluator for,
    across ALL cycles — one card per existing review plus an active-cycle
    placeholder when none exists yet. A Secondary can write BEFORE the PM
    evaluates, so members surface here immediately (the old gate that required
    the PM's review to be `reviewed` first is gone). Each card reflects the
    SECONDARY's own progress (pending / draft / submitted), not the PM's.

    The frontend defaults its Cycle filter to the active cycle, so the default
    view shows the current half; switching exposes historical entries.
    """
    active_cycle = _get_active_cycle(db, current_user.org_id)

    # Two secondary bindings, by mode:
    #  - single-PM: the project-level Project.secondary_evaluator_id → I review
    #    every member on that project,
    #  - multi-PM: the per-member ProjectAssignment.secondary_evaluator_id → I
    #    review only the specific members who name me.
    single_projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.secondary_evaluator_id == current_user.id,
            Project.multi_pm_enabled == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            Project.review_eligible == True,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )
    multi_assignments = (
        db.query(ProjectAssignment)
        .join(Project, Project.id == ProjectAssignment.project_id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.secondary_evaluator_id == current_user.id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
            Project.multi_pm_enabled == True,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            Project.review_eligible == True,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )

    # The (project, member) pairs I'm the secondary for, de-duplicated but order
    # preserved (single-PM projects first, then multi-PM members).
    projects_by_id: dict[int, Project] = {p.id: p for p in single_projects}
    seen: set[tuple[int, int]] = set()
    ordered_pairs: list[tuple[Project, int]] = []
    # The reviewed member's department on this project (from their assignment),
    # keyed by (project_id, user_id) so the Department column can be filled.
    dept_id_by_pair: dict[tuple[int, int], Optional[int]] = {}

    for p in single_projects:
        members = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.project_id == p.id,
                ProjectAssignment.user_id != current_user.id,
                ProjectAssignment.is_deleted == False,  # noqa: E712
            )
            .all()
        )
        for m in members:
            if (p.id, m.user_id) not in seen:
                seen.add((p.id, m.user_id))
                ordered_pairs.append((p, m.user_id))
                dept_id_by_pair[(p.id, m.user_id)] = m.department_id

    for a in multi_assignments:
        proj = projects_by_id.get(a.project_id)
        if proj is None:
            proj = db.query(Project).filter(
                Project.id == a.project_id,
                Project.org_id == current_user.org_id,
            ).first()
            if proj is not None:
                projects_by_id[proj.id] = proj
        if proj is not None and a.user_id != current_user.id and (proj.id, a.user_id) not in seen:
            seen.add((proj.id, a.user_id))
            ordered_pairs.append((proj, a.user_id))
            dept_id_by_pair[(proj.id, a.user_id)] = a.department_id

    if not ordered_pairs:
        return []

    # ── Batch lookups (members, reviews, my evaluator rows) ──────────
    member_ids = {uid for (_p, uid) in ordered_pairs}
    project_ids = {p.id for (p, _uid) in ordered_pairs}
    users_by_id = {
        u.id: u for u in db.query(User).filter(User.id.in_(member_ids)).all()
    }
    dept_ids = {d for d in dept_id_by_pair.values() if d is not None}
    depts_by_id = {
        d.id: d
        for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()
    } if dept_ids else {}

    reviews_by_pair: dict[tuple[int, int], list[ProjectReview]] = {}
    review_ids: list[int] = []
    for rv in (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.user_id.in_(member_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    ):
        if (rv.project_id, rv.user_id) in seen:
            reviews_by_pair.setdefault((rv.project_id, rv.user_id), []).append(rv)
            review_ids.append(rv.id)

    # My (the secondary's) own evaluator row per review — carries draft/submitted
    # state + the impact text to prefill the modal.
    my_eval_by_review: dict[int, ProjectReviewEvaluator] = {}
    if review_ids:
        for ev in (
            db.query(ProjectReviewEvaluator)
            .filter(
                ProjectReviewEvaluator.project_review_id.in_(review_ids),
                ProjectReviewEvaluator.evaluator_id == current_user.id,
            )
            .all()
        ):
            my_eval_by_review[ev.project_review_id] = ev

    def _card(project: Project, user: User, review: Optional[ProjectReview]) -> SecondaryEvalCard:
        mine = my_eval_by_review.get(review.id) if review else None
        submitted = bool(mine and mine.status == EvaluatorStatus.SUBMITTED.value)
        has_draft = bool(
            mine
            and mine.status == EvaluatorStatus.DRAFT.value
            and (mine.impact_statement or "").strip()
        )
        # The Secondary is a reviewer (not the rated employee), so they see the
        # PM's rating once the PM finalises the review — NOT gated by the
        # employee-facing per-FY visibility toggle (that's the PM/Reports-To
        # reviewer convention). The PM's unsubmitted draft rating stays hidden.
        pm_submitted = (
            review is not None
            and review.status == ProjectReviewStatus.REVIEWED.value
        )
        rating = review.performance_group if pm_submitted else None
        dept_id = dept_id_by_pair.get((project.id, user.id))
        dept = depts_by_id.get(dept_id) if dept_id is not None else None
        return SecondaryEvalCard(
            project_id=project.id,
            project_name=project.name,
            project_code=project.project_code,
            user_id=user.id,
            employee_name=user.full_name,
            cycle=review.cycle if review else active_cycle,
            review_id=review.id if review else None,
            review_status="submitted" if submitted else "pending",
            has_draft_content=has_draft,
            existing_impact=(mine.impact_statement if mine else None),
            department_name=dept.name if dept else None,
            performance_group=rating,
            pm_submitted=pm_submitted,
        )

    cards: list[SecondaryEvalCard] = []
    for project, member_id in ordered_pairs:
        user = users_by_id.get(member_id)
        if not user or user.is_deleted:
            continue
        reviews = reviews_by_pair.get((project.id, member_id), [])
        cycles_with_review = {r.cycle for r in reviews}
        for rv in reviews:
            cards.append(_card(project, user, rv))
        # Active-cycle placeholder when no review row exists for it yet.
        if active_cycle not in cycles_with_review:
            cards.append(_card(project, user, None))
    return cards


def _secondary_eval_response(
    db: DbSession, evaluator: ProjectReviewEvaluator
) -> SecondaryEvalResponse:
    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.post("/{project_id}/secondary/{user_id}", response_model=SecondaryEvalResponse, status_code=status.HTTP_201_CREATED)
def submit_secondary_evaluation(
    project_id: int,
    user_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator submits an impact statement for a team member.

    PM-first gate: the Secondary may SUBMIT only once the member's PM
    evaluation is in — i.e. the (project, member, cycle) ``ProjectReview`` is
    REVIEWED. Before then they can still park a draft (see
    ``save_secondary_draft``), mirroring the Annual-Goals mentor-review rule
    ("draft anytime, submit only after the prior review lands"). Keyed on
    (project, member), not a review id.
    """
    project = _authorize_secondary_write(db, current_user, project_id, user_id)

    cycle = _get_active_cycle(db, current_user.org_id)
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project.id,
        ProjectReview.cycle == cycle,
        ProjectReview.is_deleted == False,  # noqa: E712
    ).first()

    # No review row, or a still-pending / draft one, means the PM hasn't
    # submitted their evaluation for this member yet. A draft may have lazily
    # created a reviewer-less PENDING row, so "row exists" alone isn't enough —
    # only a REVIEWED row unlocks the Secondary's submit. Draft stays open.
    if review is None or review.status != ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The Project Manager has not yet submitted their evaluation "
                "for this team member. You can save a draft in the meantime."
            ),
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
    return _secondary_eval_response(db, evaluator)


@router.patch("/{project_id}/secondary/{user_id}/draft", response_model=SecondaryEvalResponse)
def save_secondary_draft(
    project_id: int,
    user_id: int,
    payload: SecondaryEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Secondary evaluator saves an in-progress impact statement as DRAFT.
    The row uses ``EvaluatorStatus.DRAFT`` so the PM, mentor, and mentee
    don't see it until the evaluator submits. Like submit, this may run
    before the PM starts and lazily creates the parent PENDING review.
    """
    project = _authorize_secondary_write(db, current_user, project_id, user_id)
    review = _get_or_create_secondary_review(db, current_user, project, user_id)

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
    return _secondary_eval_response(db, evaluator)


@router.put("/{project_id}/secondary/{user_id}", response_model=SecondaryEvalResponse)
def update_secondary_evaluation(
    project_id: int,
    user_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator updates their existing impact statement (active
    cycle). Requires a row to already exist — use POST to create."""
    project = _authorize_secondary_write(db, current_user, project_id, user_id)

    cycle = _get_active_cycle(db, current_user.org_id)
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project.id,
        ProjectReview.cycle == cycle,
        ProjectReview.is_deleted == False,  # noqa: E712
    ).first()
    existing = (
        db.query(ProjectReviewEvaluator).filter(
            ProjectReviewEvaluator.project_review_id == review.id,
            ProjectReviewEvaluator.evaluator_id == current_user.id,
        ).first()
        if review
        else None
    )

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existing secondary evaluation found to update.",
        )

    existing.impact_statement = payload.impact_statement
    db.commit()
    db.refresh(existing)
    return _secondary_eval_response(db, existing)


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
            Project.review_eligible == True,  # noqa: E712
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
            Project.review_eligible == True,  # noqa: E712
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

    Returns one AdminProjectSummary per project that has non-PM members. Each
    lists per-member review status PLUS the PM's own review (authored by the
    project's reports-to senior), suffixed "(PM)". `total_members` and
    `reviewed_count` therefore include the PM row when the project has a
    Primary. Uses eager loading + a review_map dict for O(1) lookups.
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
            Project.review_eligible == True,  # noqa: E712
        )
        .all()
    )

    # All reviews for this org + cycle in one query → O(1) dict lookup
    all_reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == resolved_cycle,
            ProjectReview.is_deleted == False,  # noqa: E712
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
        # In multi-PM a project can have several roots (Primaries); each is
        # shown as a "(PM)" row. Single-PM keeps its lone Primary.
        pm_assignments: list[ProjectAssignment] = []

        for a in project.assignments:
            if not a.user or a.user.is_deleted:
                continue

            if a.evaluator_type == "Primary":
                if pm_name is None:
                    pm_name = a.user.full_name
                pm_assignments.append(a)  # PM rows are appended after the loop
                continue

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

        # Each root's OWN review (authored by the project's reports-to senior) is
        # tracked alongside the team so admins can see it. Suffixed "(PM)".
        for pm_assignment in pm_assignments:
            pm_review = review_map.get((project.id, pm_assignment.user_id))
            pm_status = pm_review.status if pm_review else "not_started"
            if pm_status == ProjectReviewStatus.REVIEWED.value:
                reviewed_count += 1
            members.append(AdminMemberReviewRow(
                review_id=pm_review.id if pm_review else None,
                user_id=pm_assignment.user_id,
                employee_name=f"{pm_assignment.user.full_name} (PM)",
                assignment_role=pm_assignment.assignment_role,
                department_name=pm_assignment.department.name if pm_assignment.department else None,
                review_status=pm_status,
                performance_group=pm_review.performance_group if pm_review else None,
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
    Edit an already-submitted review.

    Authorization: the review's AUTHOR (review.reviewer_id == current_user —
    the PM for a team review, or the reports-to senior for a PM's own review),
    the project's current Primary PM, or an Admin. The employee who was
    reviewed can NEVER edit their own review — including a PM trying to rewrite
    the evaluation their reports-to senior wrote about them.
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

    # Ineligible project — its reviews are hidden everywhere and not editable.
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
    ).first()
    if project is not None and not project.review_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This project is not eligible for review.",
        )

    is_admin = current_user.role == "Admin"
    is_reviewer = review.reviewer_id == current_user.id
    # The PM who evaluates THIS review's member may edit it (mode-aware): the
    # member's direct manager in multi-PM, or a current Primary in single-PM.
    # This lets a reassigned PM continue/own in-flight evaluations, but never
    # lets a sub-PM edit a review outside their own direct reports.
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
    ).first()
    is_current_pm = bool(project) and _is_member_pm(db, current_user, project, review.user_id)

    if not (is_reviewer or is_current_pm or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the project's PM (or an Admin) may edit this review.",
        )

    # A reviewee can never edit their OWN review. This matters now that the PM
    # is itself a reviewee (evaluated by the project's reports-to senior): the
    # PM is also the project's Primary, so is_current_pm would otherwise let
    # them rewrite their own evaluation.
    if review.user_id == current_user.id and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot edit your own review.",
        )

    # Keep attribution truthful: the acting editor becomes the recorded reviewer.
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

    _sync_review_comments_json(db, review)
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

    # The project — needed for the mode-aware PM / secondary / reports-to checks.
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
    ).first()

    # The PM who evaluates THIS review's member may view it (mode-aware): the
    # member's direct manager in multi-PM, or a current Primary in single-PM.
    # NOT "any active member" — that would leak peers' reviews.
    is_pm = bool(project) and _is_member_pm(db, current_user, project, review.user_id)

    # The member's Secondary evaluator — per-member in multi-PM, project-level
    # in single-PM.
    is_secondary = bool(project) and _is_member_secondary(db, current_user, project, review.user_id)
    # Project's reports-to senior — evaluates the PM, so they may view reviews
    # on their project (a project-level role, like the secondary evaluator).
    is_reports_to = bool(project and project.reports_to_id == current_user.id)

    # Reviewee's live mentor (also drives rating visibility below).
    reviewee = db.query(User).filter(User.id == review.user_id).first()
    is_mentor = bool(reviewee and reviewee.mentor_id == current_user.id)

    if not (is_owner or is_reviewer or is_pm or is_secondary or is_reports_to or is_mentor or is_admin):
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
