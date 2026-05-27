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
from typing import List
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.core.cache import (
    admin_settings_cache,
    departments_cache,
    designations_cache,
    invalidate_settings,
)
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user_models import User
from app.models.reference_models import Department, Designation
from app.models.system_settings_models import SystemSettings, CycleType
from app.core.cycle_utils import get_current_cycle_info, resolve_today
from app.services.send_email import (
    is_smtp_configured,
    send_welcome_user_email,
)
from datetime import date, datetime, timedelta, timezone
from app.schemas.admin_schemas import (
    DepartmentBrief,
    DesignationBrief,
    UserResponse,
    UserCreate,
    UserUpdate,
    AdminSettingsResponse,
    AdminSettingsUpdate,
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

@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return every user in the organization (including deactivated ones).

    Uses joinedload to eagerly fetch department + designation in ONE query,
    avoiding the N+1 problem when the table renders 50+ rows.
    """
    _require_admin(current_user)

    users = (
        db.query(User)
        .options(
            joinedload(User.department),
            joinedload(User.designation),
        )
        .filter(User.org_id == current_user.org_id)
        .order_by(User.created_at.desc())
        .all()
    )

    return users


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

        # Recompute on read against resolve_today(row) so the label always
        # matches what the rest of the app will see — covers both real
        # clock-roll-over since the last write and an active simulation.
        fresh_cycle = get_current_cycle_info(
            resolve_today(row),
            CycleType(row.cycle_type),
            row.fiscal_start_month,
        )

        return AdminSettingsResponse(
            id=row.id,
            org_id=row.org_id,
            active_cycle=fresh_cycle,
            cycle_type=row.cycle_type,
            fiscal_start_month=row.fiscal_start_month,
            goals_edit_enabled=row.goals_edit_enabled,
            annual_goals_edit_enabled=row.annual_goals_edit_enabled,
            project_ratings_visible=row.project_ratings_visible,
            annual_reviews_enabled=row.annual_reviews_enabled,
            annual_review_final_rating_visible=row.annual_review_final_rating_visible,
            simulated_today=row.simulated_today,
            simulation_allowed=settings.ALLOW_DATE_SIMULATION,
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

    # ── Date-simulation gates (run BEFORE applying any writes) ──────
    # 1. Env-flag gate. Any attempt to set/clear simulated_today on a
    #    deployment with ALLOW_DATE_SIMULATION=false is rejected outright
    #    — keeps production safe from accidental cycle-time shifts.
    # 2. Authorization gate. Even on dev/staging, only Admin +
    #    is_management can pin a simulated date. Other admins can save
    #    everything else on this PATCH, but not the simulation fields.
    wants_simulation_write = (
        settings_in.simulated_today is not None
        or bool(settings_in.clear_simulated_today)
    )
    if wants_simulation_write:
        if not settings.ALLOW_DATE_SIMULATION:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Date simulation is disabled for this deployment. "
                    "Set ALLOW_DATE_SIMULATION=true on the backend to enable."
                ),
            )
        if not (current_user.role == "Admin" and current_user.is_management):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Date simulation requires Admin + management.",
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

    # Apply simulated_today write. clear flag wins over set (defensive —
    # both should never be sent together, but if they are, clear takes
    # priority so the operator can recover from a stuck simulation).
    if settings_in.clear_simulated_today:
        settings_row.simulated_today = None
    elif settings_in.simulated_today is not None:
        settings_row.simulated_today = settings_in.simulated_today

    # Recompute the cycle label from the (possibly updated) cadence +
    # fiscal month, against resolve_today(settings_row) so a freshly-set
    # simulated date also recomputes the label immediately.
    settings_row.active_cycle_name = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
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
        simulated_today=settings_row.simulated_today,
        simulation_allowed=settings.ALLOW_DATE_SIMULATION,
        updated_at=settings_row.updated_at,
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