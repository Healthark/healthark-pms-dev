"""
Admin Routes — The HR Administrator's Control Panel.

Endpoints:
    GET    /api/v1/admin/users              → List all org users
    POST   /api/v1/admin/users              → Create a new user
    PATCH  /api/v1/admin/users/{user_id}    → Update user details
    DELETE /api/v1/admin/users/{user_id}    → Soft-delete (deactivate) a user
    GET    /api/v1/admin/departments         → List departments (for dropdowns)
    GET    /api/v1/admin/designations        → List designations (for dropdowns)
    GET    /api/v1/admin/settings            → Get simplified active cycle info
    PATCH  /api/v1/admin/settings            → Update active cycle

Security Layers Applied (ALL endpoints):
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Every query filters by current_user.org_id
    Layer 3 — Role Authorization: Every endpoint requires role == "Admin"
    Layer 4 — Ownership:        Not applicable (Admin operates on all org data)
"""

import secrets
import string
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import aliased, joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.core.cache import (
    admin_settings_cache,
    departments_cache,
    designations_cache,
    invalidate_settings,
)
from app.core.config import settings
from app.core.cycle_utils import (
    YEAR_OVERRIDE_FLAGS,
    _cycle_to_fy_label,
    _format_fy_span,
    ensure_year_override_row,
    extract_fy_label,
    next_cycle,
    parse_cycle,
)
from app.core.security import get_password_hash
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.notification_models import NotificationCategory
from app.models.project_models import (
    PROJECT_STATUS_COMPLETED,
    Project,
    ProjectAssignment,
)
from app.models.reference_models import Department, Designation
from app.models.cycle_rollout_log_models import CycleRolloutLog
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from app.schemas.admin_schemas import (
    AdminNotifyRequest,
    AdminNotifyResult,
    AdminSettingsResponse,
    AdminSettingsUpdate,
    CoverageGaps,
    CoverageGapProject,
    CoverageGapUser,
    CycleEffects,
    CycleSetRequest,
    CycleStatusResponse,
    DepartmentBrief,
    DesignationBrief,
    UserCreate,
    UserResponse,
    UserUpdate,
    YearOption,
    YearOptionsResponse,
    YearPreflightEntry,
    YearPreflightResponse,
    YearSettingsResponse,
    YearSettingsUpdate,
)
from app.schemas.pagination import Page, PaginationParams
from app.services.notifications import (
    active_org_users,
    broadcast_notification,
    create_notification,
    notify_audience,
    warn_admins_coverage_gap,
)
from app.services.send_email import (
    is_smtp_configured,
    send_welcome_user_email,
)

_TEMP_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _generate_temp_password(length: int = 12) -> str:
    """Crypto-random temp password using `secrets.choice`. Letters+digits only
    to avoid ambiguous shell-escape characters when the admin relays it."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))

router = APIRouter()


# ── Reusable Admin Guard ─────────────────────────────────────────────

def _require_admin(current_user: User) -> None:
    """Raise 403 if the caller is not an Admin. Used by every endpoint."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can access this resource.",
        )


# =====================================================================
# USER MANAGEMENT
# =====================================================================

# Maps the FE `sort_by` value to a callable returning the SQL column to
# sort on, given the aliased Mentor/Department/Designation joins. Anything
# not in the map falls back to the default created_at order — a bad
# sort_by never 500s.
_USERS_SORT_COLUMNS = {
    "full_name": lambda M, Dept, Desig: User.full_name,
    "email": lambda M, Dept, Desig: User.email,
    "mentor_name": lambda M, Dept, Desig: M.full_name,
    "department_name": lambda M, Dept, Desig: Dept.name,
    "designation_name": lambda M, Dept, Desig: Desig.name,
    # is_deleted=False (active) sorts before True (inactive) on asc.
    "status": lambda M, Dept, Desig: User.is_deleted,
}


@router.get("/users", response_model=Page[UserResponse])
def list_users(
    db: DbSession,
    current_user: CurrentUser,
    pg: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Matches name, email, or employee code"),
    role: Optional[str] = Query(None, description="Admin | Staff"),
    status_filter: Optional[str] = Query(
        None, alias="status", description="active | inactive | all"
    ),
    department_id: Optional[int] = Query(None),
    designation_id: Optional[int] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
):
    """
    Paginated org user list for the Admin Users table.

    Server-side search / role / status / department / designation filtering
    + sort + offset pagination so the FE never holds the whole directory in
    memory. Returns Page[UserResponse]; mentor_name is resolved via a
    self-join. The non-paginated picker list lives at GET /admin/users/all.
    """
    _require_admin(current_user)

    Mentor = aliased(User)
    EmpDept = aliased(Department)
    EmpDesig = aliased(Designation)

    query = (
        db.query(User, Mentor.full_name.label("mentor_name"))
        .options(joinedload(User.department), joinedload(User.designation))
        .outerjoin(Mentor, User.mentor_id == Mentor.id)
        .outerjoin(EmpDept, User.department_id == EmpDept.id)
        .outerjoin(EmpDesig, User.designation_id == EmpDesig.id)
        .filter(User.org_id == current_user.org_id)
    )

    # ── Filters (SQL, before pagination) ─────────────────────────────
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                User.full_name.ilike(term),
                User.email.ilike(term),
                User.employee_code.ilike(term),
            )
        )
    if role:
        query = query.filter(User.role == role)
    if status_filter == "active":
        query = query.filter(User.is_deleted.is_(False))
    elif status_filter == "inactive":
        query = query.filter(User.is_deleted.is_(True))
    if department_id is not None:
        query = query.filter(User.department_id == department_id)
    if designation_id is not None:
        query = query.filter(User.designation_id == designation_id)

    # Total across all pages (after filtering). Swap the SELECT list for a
    # COUNT so the multi-entity select doesn't confuse the count.
    total = query.with_entities(func.count(User.id)).order_by(None).scalar() or 0

    # ── Sort (with stable id tiebreaker) ─────────────────────────────
    col_fn = _USERS_SORT_COLUMNS.get(sort_by) if sort_by else None
    if col_fn is not None:
        sort_col = col_fn(Mentor, EmpDept, EmpDesig)
        direction = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
        query = query.order_by(direction, User.id.asc())
    else:
        query = query.order_by(User.created_at.desc(), User.id.asc())

    rows = query.offset(pg.offset).limit(pg.limit).all()

    items: list[UserResponse] = []
    for user, mentor_name in rows:
        # Inject the resolved mentor name so UserResponse.from_attributes
        # reads it (the ORM User has no `mentor_name` attribute).
        user.mentor_name = mentor_name
        items.append(UserResponse.model_validate(user))

    return Page[UserResponse](
        items=items, total=total, page=pg.page, per_page=pg.per_page
    )


@router.get("/users/all", response_model=List[UserResponse])
def list_all_users(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Full, non-paginated org user list — for client-side pickers
    (UserCombobox: PM / secondary-evaluator / mentor selection). These need
    every user in memory to filter-as-you-type without a request per
    keystroke. The Admin table uses the paginated GET /admin/users instead.

    Resolves mentor_name via the same self-join the paginated route uses,
    so both endpoints return an identical, fully-populated UserResponse
    (no field-completeness drift between the two).
    """
    _require_admin(current_user)

    Mentor = aliased(User)
    rows = (
        db.query(User, Mentor.full_name.label("mentor_name"))
        .options(
            joinedload(User.department),
            joinedload(User.designation),
        )
        .outerjoin(Mentor, User.mentor_id == Mentor.id)
        .filter(User.org_id == current_user.org_id)
        .order_by(User.created_at.desc())
        .all()
    )

    items: list[UserResponse] = []
    for user, mentor_name in rows:
        user.mentor_name = mentor_name
        items.append(UserResponse.model_validate(user))
    return items


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Create a new user in the organization.

    The email is checked for uniqueness within the org (not globally)
    because the composite index ix_users_org_email enforces this.

    On success, a welcome email containing the email + plaintext password
    is queued for delivery (best-effort via BackgroundTasks). Failed
    delivery does NOT roll back the creation — the user row is already
    persisted and the admin can relay the credentials manually.
    """
    _require_admin(current_user)

    # Check for duplicate email within this org
    existing = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.email == user_in.email,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email '{user_in.email}' already exists in this organization.",
        )

    # Check for duplicate employee code within this org
    existing_code = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.employee_code == user_in.employee_code,
    ).first()

    if existing_code:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Employee code '{user_in.employee_code}' is already in use.",
        )

    new_user = User(
        org_id=current_user.org_id,  # Forced from JWT — never trusted from body
        employee_code=user_in.employee_code,
        full_name=user_in.full_name,
        email=user_in.email,
        phone=user_in.phone,
        role=user_in.role,
        department_id=user_in.department_id,
        designation_id=user_in.designation_id,
        mentor_id=user_in.mentor_id,
        password_hash=get_password_hash(user_in.password),
        # Force a password change on first login. The admin chose the
        # initial password and emailed it to the user; ProtectedRoute
        # routes the user to /change-password until they pick their own.
        must_change_password=True,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Send the welcome email after the row is committed so a delivery
    # failure can't prevent account creation. The plaintext password is
    # only available here (we hashed it before storage); after this
    # function returns, no other code path can reconstruct it.
    if is_smtp_configured():
        login_url = f"{settings.APP_BASE_URL.rstrip('/')}/login"
        background_tasks.add_task(
            send_welcome_user_email,
            to_email=new_user.email,
            full_name=new_user.full_name,
            password=user_in.password,
            login_url=login_url,
            org_id=new_user.org_id,
        )

    # Eagerly load relationships for the response
    return _load_user_with_relations(db, new_user.id)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_in: UserUpdate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Update a user's details (name, role, department, mentor, etc.).

    Email is intentionally NOT updatable — the frontend makes the field
    read-only during edit mode to prevent orphaned JWT tokens.
    """
    _require_admin(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Snapshot the mentor before applying the update so we can detect a
    # reassignment and notify the mentee (in-app + email).
    old_mentor_id = user.mentor_id

    # If employee_code is changing, check for duplicates
    update_data = user_in.model_dump(exclude_unset=True)

    if "employee_code" in update_data and update_data["employee_code"] != user.employee_code:
        existing_code = db.query(User).filter(
            User.org_id == current_user.org_id,
            User.employee_code == update_data["employee_code"],
            User.id != user_id,
        ).first()

        if existing_code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Employee code '{update_data['employee_code']}' is already in use.",
            )

    for field, value in update_data.items():
        setattr(user, field, value)

    # ── Mid-cycle mentor reassignment ────────────────────────────────
    # Access already follows the LIVE mentor link (get_mentee_reviews,
    # goal gates, submit re-stamps), so the new mentor can act immediately
    # and the old one loses access. But a couple of things still read the
    # per-row mentor STAMP — the dashboard "pending mentor" count and the
    # mentor-side review drafts — so when the mentor actually changes we
    # re-point the mentee's IN-FLIGHT annual reviews to the new mentor and
    # wipe the previous mentor's half-typed draft (new mentor starts fresh;
    # also stops the old mentor's dashboard from over-counting). Completed /
    # pending-management rows stay frozen for audit attribution.
    mentor_changed = "mentor_id" in update_data and user.mentor_id != old_mentor_id
    if mentor_changed:
        inflight_reviews = (
            db.query(AnnualReview)
            .filter(
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.user_id == user.id,
                AnnualReview.status == ReviewStatus.PENDING_MENTOR.value,
            )
            .all()
        )
        for review in inflight_reviews:
            review.mentor_id = user.mentor_id  # new mentor, or None on unassign
            review.mentor_overall_review_draft = None
            review.mentor_performance_rating_draft = None

        # Re-point the mentee's still-active goals to the new mentor so the
        # goals page "Mentor" column + the Excel export reflect who owns them
        # now (manager_id is a creation-time snapshot, never re-read otherwise).
        # Goals whose final review cycle is done (h2 / q4 mentor-reviewed) keep
        # the mentor who actually reviewed them — historical attribution.
        terminal_goal_states = (
            ApprovalStatus.H2_MENTOR_REVIEWED.value,
            ApprovalStatus.Q4_MENTOR_REVIEWED.value,
        )
        inflight_goals = (
            db.query(Goal)
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.user_id == user.id,
                Goal.approval_status.notin_(terminal_goal_states),
                Goal.is_deleted == False,  # noqa: E712
            )
            .all()
        )
        for goal in inflight_goals:
            goal.manager_id = user.mentor_id  # new mentor, or None on unassign

        # Notify the affected parties. New mentor + mentee only when there's
        # a new mentor; the old mentor whenever they were replaced/removed.
        new_mentor = (
            db.query(User).filter(User.id == user.mentor_id).first()
            if user.mentor_id is not None
            else None
        )
        old_mentor = (
            db.query(User)
            .filter(User.id == old_mentor_id, User.is_deleted == False)  # noqa: E712
            .first()
            if old_mentor_id is not None
            else None
        )

        # Notifications fire only on a true REASSIGNMENT (mentor → a new,
        # non-null mentor). A bare unassign (→ None) intentionally notifies
        # nobody — that path is usually mentor deactivation, which is surfaced
        # via the admin coverage-gap warnings instead.
        if new_mentor is not None:
            create_notification(
                db,
                org_id=current_user.org_id,
                recipient_id=user.id,
                category=NotificationCategory.PERSONAL.value,
                type="mentor_reassigned",
                title="Your mentor has changed",
                body=f"{new_mentor.full_name} is now your mentor.",
                link="/profile",
                entity_type="user",
                entity_id=user.id,
                actor_id=current_user.id,
                email=True,
                background_tasks=background_tasks,
                recipient_email=user.email,
            )
            create_notification(
                db,
                org_id=current_user.org_id,
                recipient_id=new_mentor.id,
                category=NotificationCategory.PERSONAL.value,
                type="mentee_assigned",
                title="New mentee assigned",
                body=f"{user.full_name} has been assigned to you as a mentee.",
                link="/my-mentees",
                entity_type="user",
                entity_id=user.id,
                actor_id=current_user.id,
                email=True,
                background_tasks=background_tasks,
                recipient_email=new_mentor.email,
            )
            if old_mentor is not None:
                create_notification(
                    db,
                    org_id=current_user.org_id,
                    recipient_id=old_mentor.id,
                    category=NotificationCategory.PERSONAL.value,
                    type="mentee_unassigned",
                    title="Mentee reassigned",
                    body=f"{user.full_name} is no longer your mentee.",
                    link="/my-mentees",
                    entity_type="user",
                    entity_id=user.id,
                    actor_id=current_user.id,
                    email=True,
                    background_tasks=background_tasks,
                    recipient_email=old_mentor.email,
                )

    db.commit()

    # Return with eagerly loaded relationships
    return _load_user_with_relations(db, user.id)


@router.post("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Reverse a soft-delete (set is_deleted = False).

    The user's historical password, mentor assignment, reviews, and goals
    are preserved — reactivation just flips the access flag. They can log
    in with their old password immediately. If admin wants a clean slate,
    they should follow up with a password reset.
    """
    _require_admin(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if not user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user is already active.",
        )

    user.is_deleted = False
    db.commit()

    return _load_user_with_relations(db, user.id)


# =====================================================================
# COVERAGE GAPS (mentor / PM removal impact)
# =====================================================================

def _orphaned_mentees(db: DbSession, org_id: int) -> list[User]:
    """Active users whose `mentor_id` points at a soft-deleted user — i.e.
    their mentor was removed and the link now dangles. Reassign to clear."""
    Mentor = aliased(User)
    return (
        db.query(User)
        .join(Mentor, Mentor.id == User.mentor_id)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            Mentor.is_deleted == True,  # noqa: E712
        )
        .order_by(User.full_name)
        .all()
    )


def _pm_less_projects(db: DbSession, org_id: int) -> list[Project]:
    """Active, non-completed projects with no active Primary assignment whose
    user is also active — covers a PM deactivated or demoted without a
    replacement."""
    covered_ids = [
        pid
        for (pid,) in db.query(ProjectAssignment.project_id)
        .join(User, User.id == ProjectAssignment.user_id)
        .filter(
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.is_deleted == False,  # noqa: E712
            User.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .all()
    ]
    return (
        db.query(Project)
        .filter(
            Project.org_id == org_id,
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
            Project.id.notin_(covered_ids),
        )
        .order_by(Project.name)
        .all()
    )


def _warn_if_coverage_gap(db: DbSession, org_id: int, actor_id: int) -> None:
    """Recompute coverage and, if anything is uncovered, broadcast one in-app
    warning to all admins. Called after a removal/edit that could drop
    coverage; idempotent in effect (the banner reflects live state)."""
    mentees = _orphaned_mentees(db, org_id)
    projects = _pm_less_projects(db, org_id)
    if not mentees and not projects:
        return
    parts: list[str] = []
    if mentees:
        parts.append(f"{len(mentees)} mentee(s) without a mentor")
    if projects:
        parts.append(f"{len(projects)} project(s) without a PM")
    warn_admins_coverage_gap(
        db,
        org_id=org_id,
        actor_id=actor_id,
        title="Action required: coverage gap",
        body=" · ".join(parts) + ". Reassign from the Admin Panel.",
        link="/admin",
    )


@router.get("/coverage-gaps", response_model=CoverageGaps)
def get_coverage_gaps(db: DbSession, current_user: CurrentUser):
    """Live mentor/PM coverage gaps for the Admin-Panel warning banner.
    Empty lists ⇒ no banner. Clears as soon as the admin reassigns."""
    _require_admin(current_user)
    mentees = _orphaned_mentees(db, current_user.org_id)
    projects = _pm_less_projects(db, current_user.org_id)
    return CoverageGaps(
        orphaned_mentees=[CoverageGapUser(id=u.id, name=u.full_name) for u in mentees],
        pm_less_projects=[
            CoverageGapProject(id=p.id, name=p.name) for p in projects
        ],
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Soft-delete a user (set is_deleted = True).

    Hard deletes are NEVER used — this preserves audit trails and
    historical review/goal data. The user's JWT will still work until
    it expires, but the CurrentUser dependency checks is_deleted on
    every request, so they are blocked immediately.

    If the removed user was a mentor and/or a project PM, all admins get an
    in-app coverage-gap warning so they can reassign promptly.
    """
    _require_admin(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Guard: Admin should not deactivate themselves
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    user.is_deleted = True
    db.commit()

    # Warn admins if this removal left mentees orphaned or a project PM-less.
    _warn_if_coverage_gap(db, current_user.org_id, current_user.id)
    db.commit()

    return None  # 204 No Content — no body


# =====================================================================
# REFERENCE DATA (for dropdown menus)
# =====================================================================

@router.get("/departments", response_model=List[DepartmentBrief])
def list_departments(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active departments for the org (powers the <select> dropdown)."""
    _require_admin(current_user)

    def _query() -> List[DepartmentBrief]:
        rows = (
            db.query(Department)
            .filter(
                Department.org_id == current_user.org_id,
                Department.is_active == True,  # noqa: E712
            )
            .order_by(Department.name)
            .all()
        )
        # Serialize to plain Pydantic models so the cache holds stable values
        # rather than ORM objects bound to a (now-closed) Session.
        return [DepartmentBrief.model_validate(r, from_attributes=True) for r in rows]

    return departments_cache.get_or_compute(current_user.org_id, _query)


@router.get("/designations", response_model=List[DesignationBrief])
def list_designations(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active designations for the org, sorted by hierarchy level."""
    _require_admin(current_user)

    def _query() -> List[DesignationBrief]:
        rows = (
            db.query(Designation)
            .filter(
                Designation.org_id == current_user.org_id,
                Designation.is_active == True,  # noqa: E712
            )
            .order_by(Designation.level)
            .all()
        )
        return [DesignationBrief.model_validate(r, from_attributes=True) for r in rows]

    return designations_cache.get_or_compute(current_user.org_id, _query)


# =====================================================================
# ADMIN SETTINGS (Simplified Active Cycle View)
# =====================================================================

@router.get("/settings", response_model=AdminSettingsResponse)
def get_admin_settings(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle for the Admin Panel's SystemSettingsTab.

    This is a simplified view of the same SystemSettings table used by
    the /api/v1/settings/ endpoints. The frontend field name 'active_cycle'
    maps to the database column 'active_cycle_name'.
    """
    _require_admin(current_user)

    def _query() -> AdminSettingsResponse:
        row = db.query(SystemSettings).filter(
            SystemSettings.org_id == current_user.org_id,
        ).first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="System settings have not been configured.",
            )

        return AdminSettingsResponse(
            id=row.id,
            org_id=row.org_id,
            active_cycle=row.active_cycle_name,
            cycle_type=row.cycle_type,
            fiscal_start_month=row.fiscal_start_month,
            goals_edit_enabled=row.goals_edit_enabled,
            annual_goals_edit_enabled=row.annual_goals_edit_enabled,
            project_ratings_visible=row.project_ratings_visible,
            annual_reviews_enabled=row.annual_reviews_enabled,
            annual_review_final_rating_visible=row.annual_review_final_rating_visible,
            updated_at=row.updated_at,
        )

    return admin_settings_cache.get_or_compute(current_user.org_id, _query)


@router.patch("/settings", response_model=AdminSettingsResponse)
def update_admin_settings(
    settings_in: AdminSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update cycle configuration and goal access controls from the Admin Panel.

    Cycle cadence and fiscal month are editable; active_cycle_name is
    recomputed automatically from those two values + today's date.
    """
    _require_admin(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()

    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    if settings_in.cycle_type is not None:
        settings_row.cycle_type = settings_in.cycle_type
    if settings_in.fiscal_start_month is not None:
        settings_row.fiscal_start_month = settings_in.fiscal_start_month
    if settings_in.goals_edit_enabled is not None:
        settings_row.goals_edit_enabled = settings_in.goals_edit_enabled
    if settings_in.annual_goals_edit_enabled is not None:
        settings_row.annual_goals_edit_enabled = settings_in.annual_goals_edit_enabled
    if settings_in.project_ratings_visible is not None:
        settings_row.project_ratings_visible = settings_in.project_ratings_visible
    if settings_in.annual_reviews_enabled is not None:
        settings_row.annual_reviews_enabled = settings_in.annual_reviews_enabled
    if settings_in.annual_review_final_rating_visible is not None:
        settings_row.annual_review_final_rating_visible = settings_in.annual_review_final_rating_visible

    # active_cycle_name is NOT touched here — it's advanced only by the
    # cycle roll-out / set endpoints (the single manual source of truth).
    settings_row.updated_by_id = current_user.id

    db.commit()
    db.refresh(settings_row)
    invalidate_settings(current_user.org_id)

    return AdminSettingsResponse(
        id=settings_row.id,
        org_id=settings_row.org_id,
        active_cycle=settings_row.active_cycle_name,
        cycle_type=settings_row.cycle_type,
        fiscal_start_month=settings_row.fiscal_start_month,
        goals_edit_enabled=settings_row.goals_edit_enabled,
        annual_goals_edit_enabled=settings_row.annual_goals_edit_enabled,
        project_ratings_visible=settings_row.project_ratings_visible,
        annual_reviews_enabled=settings_row.annual_reviews_enabled,
        annual_review_final_rating_visible=settings_row.annual_review_final_rating_visible,
        updated_at=settings_row.updated_at,
    )


# =====================================================================
# CYCLE ROLL-OUT (manual active-cycle advancement)
# =====================================================================
#
# The active cycle is a stored, admin-advanced value — NOT date-derived.
# "Roll out" advances to the next cycle in the org's cadence; "set" jumps to
# an arbitrary valid cycle (corrections / first-time setup). Both share the
# same side effects: on an FY rollover the new FY's per-FY windows are created
# all-closed (default-deny), an audit row is written, and an org-wide
# announcement is broadcast.

_CADENCE_CODES = {
    CycleType.HALF_YEARLY.value: ("H1", "H2"),
    CycleType.QUARTERLY.value: ("Q1", "Q2", "Q3", "Q4"),
}


def _settings_or_404(db: DbSession, org_id: int) -> SystemSettings:
    row = db.query(SystemSettings).filter(SystemSettings.org_id == org_id).first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )
    return row


def _cycle_effects(from_cycle: str, to_cycle: str) -> CycleEffects:
    _from_code, from_fy = parse_cycle(from_cycle)
    _to_code, to_fy = parse_cycle(to_cycle)
    fy_rollover = to_fy != from_fy
    return CycleEffects(
        from_cycle=from_cycle,
        to_cycle=to_cycle,
        fy_rollover=fy_rollover,
        requires_typed_confirmation=fy_rollover,
    )


def _validate_target_cycle(target: str, cycle_type: str) -> str:
    """Validate a manual target against the org's cadence and return the
    canonical label. 400 on a malformed or off-cadence value."""
    try:
        code, fy = parse_cycle(target)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{target}' is not a valid cycle label (e.g. 'H1 FY26-27').",
        ) from None
    if cycle_type == CycleType.ANNUAL.value:
        if code is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Annual orgs use a bare FY label (e.g. 'FY26-27').",
            )
        return _format_fy_span(fy)
    allowed = _CADENCE_CODES.get(cycle_type, ())
    if code not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{target}' does not match the org's {cycle_type} cadence.",
        )
    return f"{code} {_format_fy_span(fy)}"


def _apply_cycle_change(
    db: DbSession,
    settings_row: SystemSettings,
    to_cycle: str,
    current_user: User,
    kind: str,
) -> None:
    """Move the org's active cycle to `to_cycle`, handling FY-rollover side
    effects (a fresh all-closed FY config), the audit row, and the org-wide
    announcement. Commits."""
    from_cycle = settings_row.active_cycle_name
    _from_code, from_fy = parse_cycle(from_cycle)
    _to_code, to_fy = parse_cycle(to_cycle)

    # FY rollover → ensure the new FY's override row exists and force every
    # window closed (default-deny — the Admin opens each one for the new year).
    if to_fy != from_fy:
        override = ensure_year_override_row(
            db,
            settings_row.org_id,
            extract_fy_label(to_cycle),
            updated_by_id=current_user.id,
        )
        for flag in YEAR_OVERRIDE_FLAGS:
            setattr(override, flag, False)

    settings_row.active_cycle_name = to_cycle
    settings_row.updated_by_id = current_user.id
    db.add(
        CycleRolloutLog(
            org_id=settings_row.org_id,
            from_cycle=from_cycle,
            to_cycle=to_cycle,
            kind=kind,
            rolled_by_id=current_user.id,
        )
    )

    broadcast_notification(
        db,
        org_id=settings_row.org_id,
        recipients=active_org_users(db, settings_row.org_id),
        category=NotificationCategory.ANNOUNCEMENT.value,
        type="cycle_rollout",
        title="New cycle active",
        body=f"The active performance cycle is now {to_cycle}.",
        link="/dashboard",
        actor_id=current_user.id,
        send_email=False,
    )

    db.commit()
    db.refresh(settings_row)
    invalidate_settings(settings_row.org_id)


def _cycle_status(settings_row: SystemSettings) -> CycleStatusResponse:
    nxt = next_cycle(settings_row.active_cycle_name, settings_row.cycle_type)
    return CycleStatusResponse(
        active_cycle=settings_row.active_cycle_name,
        next_cycle=nxt,
        effects=_cycle_effects(settings_row.active_cycle_name, nxt),
    )


@router.get("/cycle", response_model=CycleStatusResponse)
def get_cycle_status(db: DbSession, current_user: CurrentUser):
    """Current active cycle + the cycle a roll-out would advance to."""
    _require_admin(current_user)
    return _cycle_status(_settings_or_404(db, current_user.org_id))


@router.post("/cycle/rollout", response_model=CycleStatusResponse)
def rollout_cycle(db: DbSession, current_user: CurrentUser):
    """Advance the org to the next cycle in its cadence (one-click)."""
    _require_admin(current_user)
    settings_row = _settings_or_404(db, current_user.org_id)
    to_cycle = next_cycle(settings_row.active_cycle_name, settings_row.cycle_type)
    _apply_cycle_change(db, settings_row, to_cycle, current_user, kind="rollout")
    return _cycle_status(settings_row)


@router.post("/cycle/set", response_model=CycleStatusResponse)
def set_cycle(payload: CycleSetRequest, db: DbSession, current_user: CurrentUser):
    """Manually set the active cycle to an arbitrary valid label (corrections /
    first-time setup)."""
    _require_admin(current_user)
    settings_row = _settings_or_404(db, current_user.org_id)
    to_cycle = _validate_target_cycle(payload.target_cycle, settings_row.cycle_type)
    _apply_cycle_change(db, settings_row, to_cycle, current_user, kind="set")
    return _cycle_status(settings_row)


# =====================================================================
# PER-FISCAL-YEAR ACCESS CONFIGURATION
# =====================================================================
#
# These endpoints back the Year dropdown in the Admin Panel's System
# Settings tab. The four toggles (annual_reviews_enabled,
# annual_review_final_rating_visible, annual_goals_edit_enabled,
# project_ratings_visible) are configured per FY rather than as org-wide
# singletons — so an Admin can re-open FY26-27 review submissions while
# FY27-28 is the system-computed active cycle.

def _current_fy_label(settings_row: SystemSettings) -> str:
    """The active FY label, read from the org's stored active cycle."""
    return extract_fy_label(settings_row.active_cycle_name)


def _build_year_settings_response(
    row: SystemSettingsYearOverride,
    current_fy: str,
) -> YearSettingsResponse:
    return YearSettingsResponse(
        fy_label=row.fy_label,
        annual_reviews_enabled=row.annual_reviews_enabled,
        annual_review_final_rating_visible=row.annual_review_final_rating_visible,
        annual_goals_edit_enabled=row.annual_goals_edit_enabled,
        project_ratings_visible=row.project_ratings_visible,
        annual_goals_final_rating_visible=row.annual_goals_final_rating_visible,
        management_review_enabled=row.management_review_enabled,
        is_current=(row.fy_label == current_fy),
        updated_at=row.updated_at,
    )


@router.get("/settings/years", response_model=YearOptionsResponse)
def list_settings_years(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return selectable years for the System Settings dropdown.

    Sources, unioned and de-duplicated:
        - the current FY plus the two prior and two upcoming FYs
        - every FY that appears on this org's annual reviews
        - every FY that appears on this org's annual goals (D1: goals stamp
          "H1 2026"/"H2 2026", so each is converted via _cycle_to_fy_label)
        - every FY that already has an override row

    `has_override` lets the UI distinguish "configured" vs "untouched"
    years; the toggles reflect default-deny values on years not yet saved.
    """
    _require_admin(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    current_fy = _current_fy_label(settings_row)

    # Current FY ± 2 — a small forward / backward window without cluttering
    # the dropdown. The UNION with FY labels found on real data covers any
    # straggler years outside that window.
    base_year = int(current_fy[2:4]) + 2000 if current_fy[2:4].isdigit() else None
    range_labels: set[str] = set()
    if base_year is not None:
        for delta in range(-2, 3):
            yr = base_year + delta
            range_labels.add(f"FY{yr % 100:02d}-{(yr + 1) % 100:02d}")

    review_labels = {
        row[0] for row in db.query(AnnualReview.cycle_name)
        .filter(AnnualReview.org_id == current_user.org_id)
        .distinct()
        .all()
        if row[0]
    }
    goal_labels = {
        row[0] for row in db.query(Goal.cycle_name)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .all()
        if row[0]
    }
    override_labels = {
        row[0] for row in db.query(SystemSettingsYearOverride.fy_label)
        .filter(SystemSettingsYearOverride.org_id == current_user.org_id)
        .all()
    }

    # D1: review cycle_name is a bare FY token, but goal cycle_name is
    # "H1 2026"/"H2 2026". _cycle_to_fy_label canonicalises BOTH shapes to
    # "FY26-27" (and returns None for anything without a derivable FY).
    all_labels: set[str] = set(range_labels)
    for label in (*review_labels, *goal_labels):
        canonical = _cycle_to_fy_label(label)
        if canonical:
            all_labels.add(canonical)
    all_labels.update(override_labels)

    # Sort descending so the most recent FY (typically the current one) is
    # at the top of the dropdown.
    def _sort_key(fy: str) -> int:
        # "FY26-27" → 2026; fallback 0 for malformed entries.
        head = fy[2:4]
        return 2000 + int(head) if head.isdigit() else 0

    years = sorted(all_labels, key=_sort_key, reverse=True)
    options = [
        YearOption(
            fy_label=fy,
            is_current=(fy == current_fy),
            has_override=(fy in override_labels),
        )
        for fy in years
    ]
    return YearOptionsResponse(years=options)


@router.get("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def get_year_settings(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Return the per-FY override row, lazy-creating from the latest
    existing override (or legacy SystemSettings flags) if missing."""
    _require_admin(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
    )
    return _build_year_settings_response(row, _current_fy_label(settings_row))


# Announcement copy for each per-FY access toggle. Keyed by flag → link +
# (title, body) per resulting state (True = enabled). `{fy}` is filled in.
_TOGGLE_ANNOUNCEMENTS: dict[str, dict] = {
    "annual_goals_edit_enabled": {
        "link": "/annual-goals",
        True: ("Goal submissions opened", "Annual goal submissions are now open for {fy}."),
        False: ("Goal submissions closed", "Annual goal submissions are now closed for {fy}."),
    },
    "annual_reviews_enabled": {
        "link": "/annual-reviews",
        True: ("Annual reviews opened", "Annual reviews are now open for {fy}."),
        False: ("Annual reviews closed", "Annual reviews are now closed for {fy}."),
    },
    "annual_review_final_rating_visible": {
        "link": "/annual-reviews",
        True: ("Final ratings visible", "Final annual-review ratings are now visible for {fy}."),
        False: ("Final ratings hidden", "Final annual-review ratings are now hidden for {fy}."),
    },
    "project_ratings_visible": {
        "link": "/project-reviews",
        True: ("Project ratings visible", "Project ratings are now visible for {fy}."),
        False: ("Project ratings hidden", "Project ratings are now hidden for {fy}."),
    },
    "annual_goals_final_rating_visible": {
        "link": "/annual-goals",
        True: ("Goal reviews visible", "Mentor reviews on annual goals are now visible for {fy}."),
        False: ("Goal reviews hidden", "Mentor reviews on annual goals are now hidden for {fy}."),
    },
    "management_review_enabled": {
        "link": "/management-reviews",
        True: ("Management review opened", "Management review is now open for {fy}."),
        False: ("Management review closed", "Management review is now closed for {fy}."),
    },
}


@router.patch("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def update_year_settings(
    fy_label: str,
    payload: YearSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update the four access toggles for a specific FY."""
    _require_admin(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
        updated_by_id=current_user.id,
    )
    # Snapshot before applying so we can announce only the toggles that flip.
    old_flags = {flag: bool(getattr(row, flag)) for flag in YEAR_OVERRIDE_FLAGS}
    for flag in YEAR_OVERRIDE_FLAGS:
        setattr(row, flag, bool(getattr(payload, flag)))
    row.updated_by_id = current_user.id

    # Announce each flipped toggle to all active org users (in-app only,
    # Announcements tab). Added to this session → committed atomically below.
    flipped = [f for f in YEAR_OVERRIDE_FLAGS if old_flags[f] != bool(getattr(row, f))]
    if flipped:
        recipients = active_org_users(db, current_user.org_id)
        for flag in flipped:
            enabled = bool(getattr(row, flag))
            title, body_tmpl = _TOGGLE_ANNOUNCEMENTS[flag][enabled]
            broadcast_notification(
                db,
                org_id=current_user.org_id,
                recipients=recipients,
                category=NotificationCategory.ANNOUNCEMENT.value,
                type="settings_toggle",
                title=title,
                body=body_tmpl.format(fy=canonical),
                link=_TOGGLE_ANNOUNCEMENTS[flag]["link"],
                actor_id=current_user.id,
                send_email=False,
            )

    db.commit()
    db.refresh(row)
    # The public GET /settings/ banner reads the active-FY override; bust
    # the cache so it re-reads immediately after this write.
    invalidate_settings(current_user.org_id)

    return _build_year_settings_response(row, _current_fy_label(settings_row))


@router.post("/notify", response_model=AdminNotifyResult)
def admin_notify(
    payload: AdminNotifyRequest,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Manual targeted announcement from the Admin "Notify" tab.

    Resolves recipients from the request's filters (specific users / departments /
    designations, AND-combined; no filter → everyone), then delivers per
    ``channel``: "in_app" writes the Announcements-tab row only, "email" sends
    the email only (no in-app row), "both" does both.
    """
    _require_admin(current_user)

    recipients = notify_audience(
        db,
        current_user.org_id,
        user_ids=payload.user_ids,
        department_ids=payload.department_ids,
        designation_ids=payload.designation_ids,
    )
    wants_email = payload.channel in ("email", "both")
    count = broadcast_notification(
        db,
        org_id=current_user.org_id,
        recipients=recipients,
        category=NotificationCategory.ANNOUNCEMENT.value,
        type="admin_broadcast",
        title=payload.subject,
        body=payload.body,
        actor_id=current_user.id,
        write_inapp=payload.channel in ("in_app", "both"),
        send_email=wants_email,
        background_tasks=background_tasks,
    )
    db.commit()
    return AdminNotifyResult(
        recipients=count,
        emailed=bool(wants_email and is_smtp_configured()),
    )


@router.get(
    "/settings/year/{fy_label}/preflight",
    response_model=YearPreflightResponse,
)
def year_settings_preflight(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Year-scoped preflight. Counts users who would be stranded if a gating
    toggle flipped off, filtered to the requested FY.

    Visibility-only flags (project_ratings_visible,
    annual_review_final_rating_visible) always return 0 — flipping them off
    doesn't lock anyone out, it just hides numbers.
    """
    _require_admin(current_user)

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    # Employee population (healthark): everyone who isn't an Admin and is
    # still active — NOT just role == "Staff".
    staff_ids_subq = (
        db.query(User.id)
        .filter(
            User.org_id == current_user.org_id,
            User.role != "Admin",
            User.is_deleted == False,  # noqa: E712
        )
        .subquery()
    )

    # ── annual_goals_edit_enabled (D1) ──────────────────────────────
    # Goal.cycle_name is "H1 2026"/"H2 2026", so match on those for the
    # requested FY's start year rather than on the bare FY token.
    start_year = 2000 + int(canonical[2:4]) if canonical[2:4].isdigit() else 0
    goal_user_ids_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name.in_([f"H1 {start_year}", f"H2 {start_year}"]),
            Goal.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .subquery()
    )
    staff_without_goals = (
        db.query(func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(goal_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )

    # ── annual_reviews_enabled ──────────────────────────────────────
    in_flight_reviews = (
        db.query(func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
            AnnualReview.status.in_([
                ReviewStatus.DRAFT.value,
                ReviewStatus.PENDING_MENTOR.value,
            ]),
        )
        .scalar()
        or 0
    )
    review_user_ids_subq = (
        db.query(AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
        )
        .distinct()
        .subquery()
    )
    staff_without_reviews = (
        db.query(func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(review_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )
    review_in_flight = in_flight_reviews + staff_without_reviews

    # ── management_review_enabled ───────────────────────────────────
    # Reviews awaiting a management rating — closing calibration blocks
    # publishing these until it's re-opened.
    pending_mgmt = (
        db.query(func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
            AnnualReview.status == ReviewStatus.PENDING_MANAGEMENT.value,
        )
        .scalar()
        or 0
    )

    def _msg(count: int, kind: str) -> str | None:
        if count <= 0:
            return None
        noun = "employee" if count == 1 else "employees"
        verb = "hasn't" if count == 1 else "haven't"
        if kind == "goals":
            return (
                f"{count} {noun} {verb} created annual goals for {canonical} yet. "
                f"Disabling will block them from doing so until you re-enable."
            )
        if kind == "management":
            return (
                f"{count} {noun} {verb} received a management rating for {canonical}. "
                f"Disabling will block management from publishing until you re-enable."
            )
        return (
            f"{count} {noun} {verb} completed self-review/mentor evaluation for {canonical}. "
            f"Disabling will block new submissions until you re-enable."
        )

    return YearPreflightResponse(
        fy_label=canonical,
        annual_goals_edit_enabled=YearPreflightEntry(
            in_flight_count=staff_without_goals,
            warning=_msg(staff_without_goals, "goals"),
        ),
        annual_reviews_enabled=YearPreflightEntry(
            in_flight_count=review_in_flight,
            warning=_msg(review_in_flight, "reviews"),
        ),
        project_ratings_visible=YearPreflightEntry(in_flight_count=0, warning=None),
        annual_review_final_rating_visible=YearPreflightEntry(in_flight_count=0, warning=None),
        annual_goals_final_rating_visible=YearPreflightEntry(in_flight_count=0, warning=None),
        management_review_enabled=YearPreflightEntry(
            in_flight_count=pending_mgmt,
            warning=_msg(pending_mgmt, "management"),
        ),
    )


# =====================================================================
# INTERNAL HELPERS
# =====================================================================

def _load_user_with_relations(db: DbSession, user_id: int) -> User:
    """
    Re-query a user with eagerly loaded relationships.

    Called after create/update to ensure the response includes nested
    department and designation objects, not just their IDs.
    """
    return (
        db.query(User)
        .options(
            joinedload(User.department),
            joinedload(User.designation),
        )
        .filter(User.id == user_id)
        .first()
    )
