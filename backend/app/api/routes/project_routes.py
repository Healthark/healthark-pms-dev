"""
Project Routes — HR/Admin Project Management (Revised).

Changes:
    - Removed allocated_hours
    - expected_end_date instead of end_date
    - reports_to_id on project (senior who reviews the PM, required on create)
    - secondary_evaluator_id on project (single project-level Secondary, optional)
    - department_id on assignments (auto-filled from user, editable)
    - assignment_role auto-filled from user's designation (editable)
    - reports_to_name resolved in responses
    - pm_id/pm_name resolved in responses (Primary evaluator on the project)
    - secondary_evaluator_name resolved in responses
    - department_name resolved in assignment responses
"""

from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_

from app.api.dependencies import DbSession, CurrentUser
from app.models.notification_models import NotificationCategory
from app.services.notifications import (
    broadcast_notification,
    create_notification,
    project_team_users,
    warn_admins_coverage_gap,
)
from app.models.project_models import (
    Project, ProjectAssignment,
    PROJECT_STATUS_ACTIVE, PROJECT_STATUS_COMPLETED,
)
from app.models.user_models import User
from app.models.reference_models import Department
from app.schemas.project_schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetail,
    AssignmentCreate, AssignmentUpdate, AssignmentResponse,
    ProjectsFilterOptions,
)
from app.schemas.pagination import Page, PaginationParams

router = APIRouter()


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage projects.",
        )


def _validate_org_user(
    db: DbSession, org_id: int, user_id: int | None, label: str
) -> None:
    """Ensure a referenced user exists, belongs to this org, and is active.

    Guards reviewer / member references (reports_to, secondary evaluator,
    assignment members) against dangling IDs (FK 500 on Postgres / silent
    dangling ref on SQLite) and cross-org references (tenant leak). Pass
    None to skip — optional fields (e.g. secondary_evaluator_id) call this
    unconditionally and it no-ops when unset.
    """
    if user_id is None:
        return
    exists = db.query(User.id).filter(
        User.id == user_id,
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    ).first()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label} is not a valid, active user in your organization.",
        )


def _build_assignment_response(assignment: ProjectAssignment, db: DbSession) -> AssignmentResponse:
    """Resolve user name and department name for an assignment."""
    user = db.query(User).filter(User.id == assignment.user_id).first()
    dept = db.query(Department).filter(Department.id == assignment.department_id).first() if assignment.department_id else None

    return AssignmentResponse(
        id=assignment.id,
        project_id=assignment.project_id,
        user_id=assignment.user_id,
        user_name=user.full_name if user else "Unknown",
        assignment_role=assignment.assignment_role,
        department_id=assignment.department_id,
        department_name=dept.name if dept else None,
        evaluator_type=assignment.evaluator_type,
        assigned_date=assignment.assigned_date,
        manager_id=assignment.manager_id,
        manager_name=_resolve_user_name(db, assignment.manager_id),
        secondary_evaluator_id=assignment.secondary_evaluator_id,
        secondary_evaluator_name=_resolve_user_name(db, assignment.secondary_evaluator_id),
        created_at=assignment.created_at,
        is_deleted=bool(assignment.is_deleted),
        removed_at=assignment.removed_at,
        removed_by_name=_resolve_user_name(db, assignment.removed_by_id),
    )


def _resolve_user_name(db: DbSession, user_id: int | None) -> str | None:
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    return user.full_name if user else None


def _build_project_response(
    project: Project,
    db: DbSession,
    count: int,
    pm_id: int | None = None,
    pm_name: str | None = None,
) -> ProjectResponse:
    resp = ProjectResponse.model_validate(project)
    resp.member_count = count
    resp.reports_to_name = _resolve_user_name(db, project.reports_to_id)
    resp.secondary_evaluator_name = _resolve_user_name(db, project.secondary_evaluator_id)
    resp.completed_by_name = _resolve_user_name(db, project.completed_by_id)
    resp.pm_id = pm_id
    resp.pm_name = pm_name
    return resp


def _resolve_project_pm(db: DbSession, project_id: int, org_id: int) -> tuple[int | None, str | None]:
    """Look up the Primary evaluator (Project Manager) for a single project."""
    row = (
        db.query(ProjectAssignment.user_id, User.full_name)
        .join(User, User.id == ProjectAssignment.user_id)
        .filter(
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    if not row:
        return None, None
    return row[0], row[1]


def _warn_if_project_pm_less(
    db: DbSession, org_id: int, actor_id: int, project_id: int
) -> None:
    """If the project now has no active Primary (PM), broadcast an in-app
    coverage-gap warning to all admins. Called after a PM demotion."""
    remaining_primary = db.query(ProjectAssignment.id).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.org_id == org_id,
        ProjectAssignment.evaluator_type == "Primary",
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first()
    if remaining_primary is not None:
        return
    project = db.query(Project).filter(Project.id == project_id).first()
    warn_admins_coverage_gap(
        db,
        org_id=org_id,
        actor_id=actor_id,
        title="Action required: project without a PM",
        body=(
            f'"{project.name}" has no Primary evaluator (PM). '
            "Assign a new PM from the Admin Panel."
            if project
            else "A project has no PM. Reassign from the Admin Panel."
        ),
        link="/admin",
    )
    db.commit()


def _format_date(value) -> str:
    """Human date for emails (e.g. 'Mar 05, 2026'); em-dash when unset."""
    return value.strftime("%b %d, %Y") if value else "—"


def _format_timeline(start, end) -> str:
    """'start – end' for the project-snapshot Timeline row."""
    return f"{_format_date(start)} – {_format_date(end)}"


def _format_team(names: list[str], limit: int = 4) -> str:
    """First `limit` member names, then '+N others' for the rest."""
    if len(names) <= limit:
        return ", ".join(names)
    return ", ".join(names[:limit]) + f" + {len(names) - limit} others"


def _auto_fill_assignment(assignment_in: AssignmentCreate, db: DbSession) -> AssignmentCreate:
    """
    Auto-fill assignment_role from designation and department_id from user
    if not explicitly provided.
    """
    user = db.query(User).filter(User.id == assignment_in.user_id).first()
    if not user:
        return assignment_in

    if not assignment_in.assignment_role and user.designation_id:
        from app.models.reference_models import Designation
        desig = db.query(Designation).filter(Designation.id == user.designation_id).first()
        if desig:
            assignment_in.assignment_role = desig.name

    if not assignment_in.department_id and user.department_id:
        assignment_in.department_id = user.department_id

    return assignment_in


# =====================================================================
# PROJECT CRUD
# =====================================================================

def _project_pm_name_subquery(db: DbSession, org_id: int):
    """Correlated scalar subquery → the Primary evaluator's name for the
    outer Project row. Used for server-side PM sort + filter without
    multiplying the main query's rows (≤1 active Primary per project).
    Excludes soft-deleted assignments so a removed PM never shows."""
    return (
        db.query(User.full_name)
        .join(ProjectAssignment, ProjectAssignment.user_id == User.id)
        .filter(
            ProjectAssignment.project_id == Project.id,
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .correlate(Project)
        .limit(1)
        .scalar_subquery()
    )


def _project_reports_to_name_subquery(db: DbSession):
    """Correlated scalar subquery → the PM-reviewer (reports_to) name."""
    return (
        db.query(User.full_name)
        .filter(User.id == Project.reports_to_id)
        .correlate(Project)
        .limit(1)
        .scalar_subquery()
    )


def _project_member_count_subquery(db: DbSession, org_id: int):
    """Correlated scalar subquery → active assignment count for the outer
    Project row. Used for server-side member_count sort. Excludes
    soft-deleted assignments so removed members aren't counted."""
    return (
        db.query(func.count(ProjectAssignment.id))
        .filter(
            ProjectAssignment.project_id == Project.id,
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .correlate(Project)
        .scalar_subquery()
    )


@router.get("/", response_model=Page[ProjectResponse])
def list_projects(
    db: DbSession,
    current_user: CurrentUser,
    pg: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Matches project name or code"),
    status_filter: Optional[str] = Query(
        None, alias="status", description="active | completed | all"
    ),
    year: Optional[int] = Query(None, description="Project start year"),
    pm: Optional[str] = Query(None, description="Exact PM (Primary evaluator) name"),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    """
    Paginated project list with member counts + resolved PM. Admin-only.

    Server-side search / status / year / PM filtering + sort + offset
    pagination. The member-count and PM lookups are scoped to the page
    slice (not the whole org) so they don't fetch data for off-page
    projects. Soft-deleted assignments are excluded from member counts
    and PM resolution. Filter-dropdown options come from
    GET /projects/filter-options.
    """
    _require_admin(current_user)

    pm_name_sq = _project_pm_name_subquery(db, current_user.org_id)
    member_count_sq = _project_member_count_subquery(db, current_user.org_id)
    reports_to_name_sq = _project_reports_to_name_subquery(db)

    query = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    )

    # ── Filters (SQL, before pagination) ─────────────────────────────
    if status_filter in (PROJECT_STATUS_ACTIVE, PROJECT_STATUS_COMPLETED):
        query = query.filter(Project.status == status_filter)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(Project.name.ilike(term), Project.project_code.ilike(term))
        )
    if year is not None:
        # Date-range match (portable across SQLite + Postgres; avoids
        # engine-specific year extraction on the DateTime column).
        start = date(year, 1, 1)
        end = date(year + 1, 1, 1)
        query = query.filter(
            Project.start_date >= start, Project.start_date < end
        )
    if pm:
        query = query.filter(pm_name_sq == pm)

    total = query.with_entities(func.count(Project.id)).order_by(None).scalar() or 0

    # ── Sort (with stable id tiebreaker) ─────────────────────────────
    sort_columns = {
        "name": Project.name,
        "project_code": Project.project_code,
        "start_date": Project.start_date,
        "expected_end_date": Project.expected_end_date,
        "status": Project.status,
        "pm_name": pm_name_sq,
        "reports_to_name": reports_to_name_sq,
        "member_count": member_count_sq,
    }
    sort_col = sort_columns.get(sort_by) if sort_by else None
    if sort_col is not None:
        direction = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
        query = query.order_by(direction, Project.id.asc())
    else:
        query = query.order_by(Project.created_at.desc(), Project.id.asc())

    projects = query.offset(pg.offset).limit(pg.limit).all()

    # ── Resolve member counts + PMs for the PAGE slice only ──────────
    page_ids = [p.id for p in projects]
    count_map: dict[int, int] = {}
    pm_map: dict[int, tuple[int, str]] = {}
    if page_ids:
        count_map = dict(
            db.query(ProjectAssignment.project_id, func.count(ProjectAssignment.id))
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.is_deleted == False,  # noqa: E712
                ProjectAssignment.project_id.in_(page_ids),
            )
            .group_by(ProjectAssignment.project_id)
            .all()
        )
        pm_rows = (
            db.query(ProjectAssignment.project_id, ProjectAssignment.user_id, User.full_name)
            .join(User, User.id == ProjectAssignment.user_id)
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.evaluator_type == "Primary",
                ProjectAssignment.is_deleted == False,  # noqa: E712
                ProjectAssignment.project_id.in_(page_ids),
            )
            .all()
        )
        pm_map = {row[0]: (row[1], row[2]) for row in pm_rows}

    items = [
        _build_project_response(
            p,
            db,
            count_map.get(p.id, 0),
            pm_id=pm_map.get(p.id, (None, None))[0],
            pm_name=pm_map.get(p.id, (None, None))[1],
        )
        for p in projects
    ]

    return Page[ProjectResponse](
        items=items, total=total, page=pg.page, per_page=pg.per_page
    )


@router.get("/filter-options", response_model=ProjectsFilterOptions)
def projects_filter_options(
    db: DbSession,
    current_user: CurrentUser,
):
    """Distinct project start years + PM names across the org's
    non-deleted projects. Populates the Projects tab Year + PM
    dropdowns. Declared before /{project_id} so the detail route
    doesn't shadow it."""
    _require_admin(current_user)

    start_dates = (
        db.query(Project.start_date)
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
            Project.start_date.isnot(None),
        )
        .all()
    )
    years = sorted({d[0].year for d in start_dates if d[0]}, reverse=True)

    pm_names = (
        db.query(User.full_name)
        .join(ProjectAssignment, ProjectAssignment.user_id == User.id)
        .join(Project, Project.id == ProjectAssignment.project_id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .all()
    )
    pms = sorted({row[0] for row in pm_names if row[0]})

    return ProjectsFilterOptions(years=years, pms=pms)


@router.post("/", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project(
    project_in: ProjectCreate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """Create a project with optional initial team assignments."""
    _require_admin(current_user)

    # Uniqueness check ignores is_deleted on purpose: the unique index
    # `ix_projects_org_code` spans (org_id, project_code) WITHOUT is_deleted,
    # so a soft-deleted project still owns its code. Filtering to active rows
    # would pass here and then 500 on insert — so we 409 cleanly against any
    # project (deleted or not) already holding the code.
    existing = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.project_code == project_in.project_code,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Project code '{project_in.project_code}' already exists.",
        )

    # Pydantic enforces exactly one Primary, a non-null reports_to_id, and no
    # duplicate members. It can't verify the referenced users exist, so do it
    # here: reviewers (reports_to / secondary) and every member must be a
    # real, active user in this org.
    _validate_org_user(db, current_user.org_id, project_in.reports_to_id, "PM Reports To")
    _validate_org_user(
        db, current_user.org_id, project_in.secondary_evaluator_id, "Secondary Evaluator"
    )
    for _member in project_in.assignments:
        _validate_org_user(db, current_user.org_id, _member.user_id, "Assigned member")
        if project_in.multi_pm_enabled:
            _validate_org_user(db, current_user.org_id, _member.manager_id, "Project Manager")
            _validate_org_user(
                db, current_user.org_id, _member.secondary_evaluator_id, "Secondary Evaluator"
            )

    new_project = Project(
        org_id=current_user.org_id,
        project_code=project_in.project_code,
        name=project_in.name,
        description=project_in.description,
        start_date=project_in.start_date,
        expected_end_date=project_in.expected_end_date,
        reports_to_id=project_in.reports_to_id,
        # In multi-PM mode the Secondary is captured per member, so the
        # project-level field is left unset.
        secondary_evaluator_id=(
            None if project_in.multi_pm_enabled else project_in.secondary_evaluator_id
        ),
        multi_pm_enabled=project_in.multi_pm_enabled,
    )
    db.add(new_project)
    db.flush()

    # Single-PM: the one Primary's user_id, used to populate every other
    # member's manager_id so the per-member evaluation link exists in BOTH
    # modes (multi-PM supplies it directly via the hierarchy).
    single_pm_user_id = (
        None
        if project_in.multi_pm_enabled
        else next(
            (a.user_id for a in project_in.assignments if a.evaluator_type == "Primary"),
            None,
        )
    )

    for assignment_in in project_in.assignments:
        assignment_in = _auto_fill_assignment(assignment_in, db)
        if project_in.multi_pm_enabled:
            # Root (no manager) is the headline Primary; every other member is
            # a regular member whose manager_id drives who evaluates them.
            evaluator_type = "Primary" if assignment_in.manager_id is None else None
            manager_id = assignment_in.manager_id
            secondary_evaluator_id = assignment_in.secondary_evaluator_id
        else:
            evaluator_type = assignment_in.evaluator_type
            manager_id = (
                None
                if assignment_in.user_id == single_pm_user_id
                else single_pm_user_id
            )
            secondary_evaluator_id = None
        db.add(ProjectAssignment(
            org_id=current_user.org_id,
            project_id=new_project.id,
            user_id=assignment_in.user_id,
            assignment_role=assignment_in.assignment_role,
            department_id=assignment_in.department_id,
            evaluator_type=evaluator_type,
            assigned_date=assignment_in.assigned_date,
            manager_id=manager_id,
            secondary_evaluator_id=secondary_evaluator_id,
        ))

    # Notify each initial team member they've been added (in-app + email).
    member_ids = [a.user_id for a in project_in.assignments]
    if member_ids:
        members = db.query(User).filter(
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
            User.id.in_(member_ids),
        ).all()
        broadcast_notification(
            db,
            org_id=current_user.org_id,
            recipients=members,
            category=NotificationCategory.PERSONAL.value,
            type="project_assigned",
            title="Added to a project",
            body=f'You have been added to the project "{new_project.name}".',
            link="/project-reviews",
            actor_id=current_user.id,
            send_email=True,
            background_tasks=background_tasks,
            cta_label="View project reviews",
        )

    db.commit()
    db.refresh(new_project)

    assignment_responses = [_build_assignment_response(a, db) for a in new_project.assignments]
    pm_assignment = next((a for a in assignment_responses if a.evaluator_type == "Primary"), None)

    return ProjectDetail(
        id=new_project.id,
        org_id=new_project.org_id,
        project_code=new_project.project_code,
        name=new_project.name,
        description=new_project.description,
        start_date=new_project.start_date,
        expected_end_date=new_project.expected_end_date,
        reports_to_id=new_project.reports_to_id,
        reports_to_name=_resolve_user_name(db, new_project.reports_to_id),
        secondary_evaluator_id=new_project.secondary_evaluator_id,
        secondary_evaluator_name=_resolve_user_name(db, new_project.secondary_evaluator_id),
        status=new_project.status,
        completed_at=new_project.completed_at,
        completed_by_name=_resolve_user_name(db, new_project.completed_by_id),
        pm_id=pm_assignment.user_id if pm_assignment else None,
        pm_name=pm_assignment.user_name if pm_assignment else None,
        is_deleted=new_project.is_deleted,
        created_at=new_project.created_at,
        updated_at=new_project.updated_at,
        multi_pm_enabled=new_project.multi_pm_enabled,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project_detail(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Get a project with all team assignments."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    assignment_responses = [_build_assignment_response(a, db) for a in project.assignments]
    # Active members first, removed (soft-deleted) members last — the modal
    # renders the removed group greyed at the bottom. Stable sort preserves the
    # existing order within each group.
    assignment_responses.sort(key=lambda a: a.is_deleted)
    pm_assignment = next(
        (a for a in assignment_responses if a.evaluator_type == "Primary" and not a.is_deleted),
        None,
    )

    return ProjectDetail(
        id=project.id,
        org_id=project.org_id,
        project_code=project.project_code,
        name=project.name,
        description=project.description,
        start_date=project.start_date,
        expected_end_date=project.expected_end_date,
        reports_to_id=project.reports_to_id,
        reports_to_name=_resolve_user_name(db, project.reports_to_id),
        secondary_evaluator_id=project.secondary_evaluator_id,
        secondary_evaluator_name=_resolve_user_name(db, project.secondary_evaluator_id),
        status=project.status,
        completed_at=project.completed_at,
        completed_by_name=_resolve_user_name(db, project.completed_by_id),
        pm_id=pm_assignment.user_id if pm_assignment else None,
        pm_name=pm_assignment.user_name if pm_assignment else None,
        is_deleted=project.is_deleted,
        created_at=project.created_at,
        updated_at=project.updated_at,
        multi_pm_enabled=project.multi_pm_enabled,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    project_in: ProjectUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update project metadata."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    update_data = project_in.model_dump(exclude_unset=True)

    if "project_code" in update_data and update_data["project_code"] != project.project_code:
        # Ignore is_deleted (see create_project) — the unique index spans
        # deleted rows, so 409 against any project already holding the code.
        existing = db.query(Project).filter(
            Project.org_id == current_user.org_id,
            Project.project_code == update_data["project_code"],
            Project.id != project_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Project code '{update_data['project_code']}' already exists.",
            )

    # Validate any reviewer reference the payload is changing (existence +
    # same-org + active). Skips fields the payload didn't touch.
    if "reports_to_id" in update_data:
        # reports_to_id is required on create; don't let an update clear it to
        # NULL (which would break the PM-review chain). secondary_evaluator_id
        # below is genuinely optional, so it may be nulled.
        if update_data["reports_to_id"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PM Reports To is required and cannot be cleared.",
            )
        _validate_org_user(
            db, current_user.org_id, update_data["reports_to_id"], "PM Reports To"
        )
    if "secondary_evaluator_id" in update_data:
        _validate_org_user(
            db, current_user.org_id, update_data["secondary_evaluator_id"], "Secondary Evaluator"
        )

    # Validate the *merged* reviewer-role state (current values for fields
    # the payload didn't touch + new values for fields it did). The PM,
    # the senior reviewing them ("Reports To"), and the Secondary evaluator
    # must be three distinct users — same reason ProjectCreate enforces it.
    final_reports_to = update_data.get("reports_to_id", project.reports_to_id)
    final_secondary = update_data.get(
        "secondary_evaluator_id", project.secondary_evaluator_id,
    )
    pm_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.evaluator_type == "Primary",
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).first()
    pm_user_id = pm_assignment.user_id if pm_assignment else None

    if pm_user_id is not None and final_reports_to == pm_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PM Reports To must be a different user than the PM.",
        )
    if (
        final_secondary is not None
        and pm_user_id is not None
        and final_secondary == pm_user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Secondary Evaluator must be a different user than the PM.",
        )
    if (
        final_secondary is not None
        and final_secondary == final_reports_to
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Secondary Evaluator must be a different user than PM Reports To.",
        )
    # The Secondary evaluator must stay an outside reviewer — not a member of
    # the team they evaluate. (secondary == PM is caught above with a clearer
    # message; this covers any other active member.)
    if final_secondary is not None:
        secondary_is_member = db.query(ProjectAssignment.id).filter(
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == final_secondary,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        ).first() is not None
        if secondary_is_member:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Secondary Evaluator cannot also be a team member of the project.",
            )

    for field, value in update_data.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)

    count = db.query(func.count(ProjectAssignment.id)).filter(
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).scalar() or 0

    pm_id, pm_name = _resolve_project_pm(db, project.id, current_user.org_id)
    return _build_project_response(project, db, count, pm_id=pm_id, pm_name=pm_name)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Soft-delete a project."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    project.is_deleted = True
    db.commit()
    return None


# =====================================================================
# ASSIGNMENT CRUD
# =====================================================================

@router.post("/{project_id}/assignments", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def add_assignment(
    project_id: int,
    assignment_in: AssignmentCreate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """Add a team member to a project. Auto-fills role and department from user profile."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if project.status == PROJECT_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot assign members to a completed project. Re-open it first.",
        )

    # The member must be a real, active user in this org (guards dangling
    # FK / cross-org assignment).
    _validate_org_user(db, current_user.org_id, assignment_in.user_id, "Assigned member")
    # Multi-PM references (the member's PM + per-member Secondary) must be valid
    # org users. The PM may be ANY org user — not necessarily a project member
    # (a non-member PM simply has no review of their own on this project).
    if project.multi_pm_enabled:
        _validate_org_user(db, current_user.org_id, assignment_in.manager_id, "Project Manager")
        _validate_org_user(
            db, current_user.org_id, assignment_in.secondary_evaluator_id, "Secondary Evaluator"
        )
        if (
            assignment_in.manager_id is not None
            and assignment_in.manager_id == assignment_in.user_id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member cannot be their own Project Manager.",
            )

    # One row per (project, user) — unique index. A soft-deleted row is
    # RESTORED below (re-add) rather than inserted again; an active row 409s.
    existing = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == assignment_in.user_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if existing and not existing.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user is already assigned to this project.",
        )

    # A member's joined date cannot precede the project's start date.
    # Only enforced when both are set; both fields remain individually optional.
    if (
        project.start_date is not None
        and assignment_in.assigned_date is not None
        and assignment_in.assigned_date < project.start_date
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A member's Joined Date cannot be earlier than the project Start Date.",
        )

    # The project's Secondary evaluator is an OUTSIDE reviewer — they cannot
    # also be a member of the team they evaluate. Applies to every member (PM
    # or regular) and covers both a fresh add and a re-add of a removed row.
    if (
        project.secondary_evaluator_id is not None
        and assignment_in.user_id == project.secondary_evaluator_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This user is the project's Secondary Evaluator and cannot also "
                "be a team member. Change the Secondary Evaluator first."
            ),
        )

    if assignment_in.evaluator_type == "Primary":
        existing_primary = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
        ).first()
        if existing_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This project already has a Primary evaluator (Project Manager).",
            )
        # The PM cannot also be the senior reviewing them — same constraint
        # enforced on project create. (PM == secondary is covered by the
        # member check above.)
        if assignment_in.user_id == project.reports_to_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The PM cannot be the same user as PM Reports To.",
            )

    # Auto-fill role and department from user profile
    assignment_in = _auto_fill_assignment(assignment_in, db)

    # Resolve the per-member evaluation link. Multi-PM takes it from the
    # payload; single-PM links the member to the project's Primary (kept in
    # sync so the per-member link is populated in both modes).
    if project.multi_pm_enabled:
        resolved_manager_id = assignment_in.manager_id
        resolved_secondary_id = assignment_in.secondary_evaluator_id
    else:
        pm_id, _ = _resolve_project_pm(db, project.id, current_user.org_id)
        resolved_manager_id = (
            None if assignment_in.evaluator_type == "Primary" else pm_id
        )
        resolved_secondary_id = None

    if existing:
        # Re-add: restore the soft-deleted row in place (preserves history,
        # honours the unique (project, user) index) with the new field values.
        existing.assignment_role = assignment_in.assignment_role
        existing.department_id = assignment_in.department_id
        existing.evaluator_type = assignment_in.evaluator_type
        existing.assigned_date = assignment_in.assigned_date
        existing.manager_id = resolved_manager_id
        existing.secondary_evaluator_id = resolved_secondary_id
        existing.is_deleted = False
        existing.removed_at = None
        existing.removed_by_id = None
        new_assignment = existing
    else:
        new_assignment = ProjectAssignment(
            org_id=current_user.org_id,
            project_id=project_id,
            user_id=assignment_in.user_id,
            assignment_role=assignment_in.assignment_role,
            department_id=assignment_in.department_id,
            evaluator_type=assignment_in.evaluator_type,
            assigned_date=assignment_in.assigned_date,
            manager_id=resolved_manager_id,
            secondary_evaluator_id=resolved_secondary_id,
        )
        db.add(new_assignment)

    # Notify the newly-assigned member (in-app + email). The email is the
    # formal, snapshot-style template; the in-app row stays a short line.
    member = db.query(User).filter(
        User.id == assignment_in.user_id, User.org_id == current_user.org_id
    ).first()
    _, pm_name = _resolve_project_pm(db, project.id, current_user.org_id)
    create_notification(
        db,
        org_id=current_user.org_id,
        recipient_id=assignment_in.user_id,
        category=NotificationCategory.PERSONAL.value,
        type="project_assigned",
        title="Added to a project",
        body=f'You have been added to the project "{project.name}".',
        link="/project-reviews",
        entity_type="project",
        entity_id=project.id,
        actor_id=current_user.id,
        email=True,
        background_tasks=background_tasks,
        recipient_email=member.email if member else None,
        cta_label="View project",
        email_subject=f"You have been added to: {project.name}",
        recipient_name=member.full_name if member else None,
        email_intro=(
            f'You have been added to the project "{project.name}" in '
            f"Healthark PMS."
        ),
        email_details=[
            ("Project Manager", pm_name or "—"),
            ("Timeline", _format_timeline(project.start_date, project.expected_end_date)),
        ],
        snapshot_title="Project Snapshot",
    )

    db.commit()
    db.refresh(new_assignment)

    return _build_assignment_response(new_assignment, db)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentResponse)
def update_assignment(
    assignment_id: int,
    assignment_in: AssignmentUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update a member's project role, department, or evaluator type."""
    _require_admin(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    # A removed (soft-deleted) row can't be edited — restore it first. Without
    # this, a removed row could be promoted to Primary while staying deleted,
    # which disagrees with PM resolution (it ignores deleted rows).
    if assignment.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This member has been removed. Restore them before editing.",
        )

    update_data = assignment_in.model_dump(exclude_unset=True)

    # Multi-PM references (the member's PM + per-member Secondary) must point at
    # valid users, and a member can't manage themselves. The setattr loop below
    # persists them once validated.
    if update_data.get("manager_id") is not None:
        _validate_org_user(db, current_user.org_id, update_data["manager_id"], "Project Manager")
        if update_data["manager_id"] == assignment.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member cannot be their own Project Manager.",
            )
    if update_data.get("secondary_evaluator_id") is not None:
        _validate_org_user(
            db, current_user.org_id, update_data["secondary_evaluator_id"], "Secondary Evaluator"
        )

    # Joined Date guard — when the client is setting/changing the assigned
    # date, the new value must not precede the project's start date.
    if "assigned_date" in update_data and update_data["assigned_date"] is not None:
        parent_project = db.query(Project).filter(
            Project.id == assignment.project_id,
            Project.org_id == current_user.org_id,
        ).first()
        if (
            parent_project is not None
            and parent_project.start_date is not None
            and update_data["assigned_date"] < parent_project.start_date
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member's Joined Date cannot be earlier than the project Start Date.",
            )

    if update_data.get("evaluator_type") == "Primary":
        existing_primary = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == assignment.project_id,
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.id != assignment_id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        ).first()
        if existing_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This project already has a Primary evaluator.",
            )
        # The promoted PM cannot also be the senior who reviews them or
        # the project's secondary evaluator. Look up the parent project to
        # cross-check both fields.
        parent = db.query(Project).filter(
            Project.id == assignment.project_id,
            Project.org_id == current_user.org_id,
        ).first()
        if parent and assignment.user_id == parent.reports_to_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The PM cannot be the same user as PM Reports To.",
            )
        if (
            parent
            and parent.secondary_evaluator_id is not None
            and assignment.user_id == parent.secondary_evaluator_id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The PM cannot be the same user as the Secondary Evaluator.",
            )

    # Detect a PM demotion (Primary → non-Primary) so we can warn admins if it
    # leaves the project without a PM.
    was_primary = assignment.evaluator_type == "Primary"
    becoming_non_primary = (
        "evaluator_type" in update_data
        and update_data["evaluator_type"] != "Primary"
    )

    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()

    if was_primary and becoming_non_primary:
        _warn_if_project_pm_less(
            db, current_user.org_id, current_user.id, assignment.project_id
        )

    db.refresh(assignment)

    return _build_assignment_response(assignment, db)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Soft-remove a member from a project.

    The row is kept (preserving the team-membership record across review
    cycles) and stamped with who removed them and when. The member then renders
    greyed at the bottom of the team list and can be re-added. Project-review
    rows are unaffected — they key on (user, project, cycle), not the row.
    """
    _require_admin(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if assignment.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This member has already been removed.",
        )

    # A project must always have a PM — refuse to drop the Primary
    # assignment. To swap PMs the admin must first promote another member
    # to Primary (the PATCH endpoint clears the prior Primary in the same
    # call) and then the old non-PM member can be removed normally.
    if assignment.evaluator_type == "Primary":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PM cannot be removed.",
        )

    assignment.is_deleted = True
    assignment.removed_at = datetime.now(timezone.utc)
    assignment.removed_by_id = current_user.id
    db.commit()
    return None


@router.post("/assignments/{assignment_id}/restore", response_model=AssignmentResponse)
def restore_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Re-add a previously removed member by clearing the soft-delete marker.

    A removed row is never the Primary (PM can't be removed), so restoring it
    never reintroduces a second PM.
    """
    _require_admin(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    # Can't re-add members to a completed project — matches add_assignment's
    # guard, so the "re-open it first" invariant holds for restores too.
    project = db.query(Project).filter(
        Project.id == assignment.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    if project.status == PROJECT_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot restore members on a completed project. Re-open it first.",
        )

    # Closes the remove → set-as-secondary → restore bypass: while the member
    # was removed they may have been made the project's Secondary evaluator, so
    # restoring them would recreate the reviewer-is-also-a-member conflict.
    if (
        project.secondary_evaluator_id is not None
        and assignment.user_id == project.secondary_evaluator_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This user is the project's Secondary Evaluator and cannot also "
                "be a team member. Change the Secondary Evaluator first."
            ),
        )

    if assignment.is_deleted:
        assignment.is_deleted = False
        assignment.removed_at = None
        assignment.removed_by_id = None
        db.commit()
        db.refresh(assignment)

    return _build_assignment_response(assignment, db)


# =====================================================================
# PROJECT LIFECYCLE
# =====================================================================

@router.post("/{project_id}/complete", response_model=ProjectResponse)
def complete_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """Mark a project as completed (Admin-only).

    Flips ``status`` to "completed" and stamps ``completed_at`` /
    ``completed_by_id``. The team list is intentionally preserved —
    re-open is a single status flip. New assignments and new project
    reviews are blocked while completed; in-flight history stays
    queryable.

    Idempotent: re-completing an already-completed project returns
    the current state without rewriting ``completed_at``.
    """
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    count = db.query(func.count(ProjectAssignment.id)).filter(
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).scalar() or 0

    if project.status != PROJECT_STATUS_COMPLETED:
        project.status = PROJECT_STATUS_COMPLETED
        project.completed_at = datetime.now(timezone.utc)
        project.completed_by_id = current_user.id

        # Notify the team the project is complete (in-app + email). Only on the
        # active → completed transition (re-completing is a no-op above).
        team = project_team_users(db, current_user.org_id, project.id)
        _, pm_name = _resolve_project_pm(db, project.id, current_user.org_id)
        broadcast_notification(
            db,
            org_id=current_user.org_id,
            recipients=team,
            category=NotificationCategory.PERSONAL.value,
            type="project_completed",
            title="Project completed",
            body=f'The project "{project.name}" has been marked complete.',
            link="/project-reviews",
            actor_id=current_user.id,
            send_email=True,
            background_tasks=background_tasks,
            cta_label="View project",
            email_subject=f"Project Completed: {project.name}",
            email_intro=(
                f'The project "{project.name}" has been marked complete.'
            ),
            email_details=[
                ("Project Manager", pm_name or "—"),
                ("Completed On", _format_date(project.completed_at)),
                ("Team Members", _format_team([u.full_name for u in team])),
            ],
            snapshot_title="Project Snapshot",
        )

        db.commit()
        db.refresh(project)

    pm_id, pm_name = _resolve_project_pm(db, project.id, current_user.org_id)
    return _build_project_response(project, db, count, pm_id=pm_id, pm_name=pm_name)


@router.post("/{project_id}/reopen", response_model=ProjectResponse)
def reopen_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Re-open a completed project (Admin-only).

    Clears ``status`` / ``completed_at`` / ``completed_by_id``. The team
    list is unchanged from when the project was completed (this version
    does not soft-end assignments), so the project returns to active
    with its prior PM and members intact.

    Idempotent: re-opening an already-active project returns the
    current state without changing the timestamps.
    """
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    count = db.query(func.count(ProjectAssignment.id)).filter(
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.is_deleted == False,  # noqa: E712
    ).scalar() or 0

    if project.status == PROJECT_STATUS_COMPLETED:
        project.status = PROJECT_STATUS_ACTIVE
        project.completed_at = None
        project.completed_by_id = None
        db.commit()
        db.refresh(project)
        # Reopening returns the project to the active review surface — warn
        # admins if it no longer has an active PM (e.g. the PM was deactivated
        # while the project was completed).
        _warn_if_project_pm_less(
            db, current_user.org_id, current_user.id, project.id
        )

    pm_id, pm_name = _resolve_project_pm(db, project.id, current_user.org_id)
    return _build_project_response(project, db, count, pm_id=pm_id, pm_name=pm_name)