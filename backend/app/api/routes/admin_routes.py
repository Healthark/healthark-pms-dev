from typing import List
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.user_models import User
from app.models.reference_models import Department, Designation
from app.models.system_settings_models import SystemSettings
from app.schemas.admin_schemas import (
    UserCreate, UserUpdate, UserResponse,
    DepartmentBrief, DesignationBrief,
    SystemSettingsResponse, SystemSettingsUpdate,
)
from app.core.security import get_password_hash

router = APIRouter()


def _require_admin(current_user: User) -> None:
    """
    Shared role guard for every route in this file.
    Raises 403 immediately if the caller is not an Admin.
    Keeps individual routes clean — no repeated if-blocks.
    """
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[UserResponse])
def list_users(db: DbSession, current_user: CurrentUser):
    """
    Returns ALL users in the org (including deactivated) so the admin
    can see the full roster and re-activate or audit past accounts.
    """
    _require_admin(current_user)
    return (
        db.query(User)
        .filter(User.org_id == current_user.org_id)
        .order_by(User.created_at.desc())
        .all()
    )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(user_in: UserCreate, db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)

    # Duplicate email check within the tenant
    if db.query(User).filter(
        User.org_id == current_user.org_id,
        User.email == user_in.email,
    ).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists in your organization.",
        )

    # Duplicate employee code check within the tenant
    if db.query(User).filter(
        User.org_id == current_user.org_id,
        User.employee_code == user_in.employee_code,
    ).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this employee code already exists in your organization.",
        )

    new_user = User(
        org_id=current_user.org_id,  # Tenant isolation — never from request body
        employee_code=user_in.employee_code,
        full_name=user_in.full_name,
        email=user_in.email,
        phone=user_in.phone,
        role=user_in.role,
        department_id=user_in.department_id,
        designation_id=user_in.designation_id,
        mentor_id=user_in.mentor_id,
        password_hash=get_password_hash(user_in.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_in: UserUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    _require_admin(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    for field, value in user_in.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: int, db: DbSession, current_user: CurrentUser):
    """
    Soft delete only — sets is_deleted = True.
    Hard deletes are never performed per architecture standards.
    """
    _require_admin(current_user)

    # Prevent admins from accidentally locking themselves out
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    user.is_deleted = True
    db.commit()


# ---------------------------------------------------------------------------
# Reference Data — for Add/Edit User form dropdowns
# ---------------------------------------------------------------------------

@router.get("/departments", response_model=List[DepartmentBrief])
def list_departments(db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    return (
        db.query(Department)
        .filter(
            Department.org_id == current_user.org_id,
            Department.is_active == True,
        )
        .all()
    )


@router.get("/designations", response_model=List[DesignationBrief])
def list_designations(db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    return (
        db.query(Designation)
        .filter(
            Designation.org_id == current_user.org_id,
            Designation.is_active == True,
        )
        .order_by(Designation.level)
        .all()
    )


# ---------------------------------------------------------------------------
# System Settings
# ---------------------------------------------------------------------------

@router.get("/settings", response_model=SystemSettingsResponse)
def get_settings(db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    # Auto-provision a blank settings row on first access — no manual seeding needed
    if not settings:
        settings = SystemSettings(org_id=current_user.org_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return settings


@router.patch("/settings", response_model=SystemSettingsResponse)
def update_settings(
    settings_in: SystemSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    _require_admin(current_user)
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    if not settings:
        settings = SystemSettings(
            org_id=current_user.org_id,
            active_cycle=settings_in.active_cycle,
        )
        db.add(settings)
    else:
        settings.active_cycle = settings_in.active_cycle

    db.commit()
    db.refresh(settings)
    return settings