"""
User Routes — Self-Service Endpoints for Authenticated Users.

Endpoints:
    GET  /api/v1/users/me            → Fetch own profile (rich data for Profile page)
    POST /api/v1/users/me/password   → Change own password

These are NOT admin endpoints — any authenticated user can access them,
but they only ever return or modify the current user's own data.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Implicit (only reads current_user's own record)
    Layer 3 — Role Authorization: Not needed (self-service, no privilege required)
    Layer 4 — Ownership:        Guaranteed (CurrentUser IS the owner)
"""

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import CurrentUser, DbSession
from app.core.security import get_password_hash, verify_password
from app.schemas.user_schemas import PasswordChangeRequest, UserProfile, UserRoleExpectationResponse
from app.services.competency_service import get_competency_set

router = APIRouter()


@router.get("/me", response_model=UserProfile)
def get_my_profile(
    current_user: CurrentUser,
):
    """
    Return the authenticated user's full profile for the Profile page.

    This is richer than GET /auth/me (which returns minimal identity data).
    It includes org name, department/designation names, and mentor name —
    all resolved from SQLAlchemy relationships so the frontend doesn't
    need to make separate lookups.
    """
    return UserProfile(
        id=current_user.id,
        org_id=current_user.org_id,
        org_name=current_user.organization.name if current_user.organization else "Unknown",
        employee_code=current_user.employee_code,
        full_name=current_user.full_name,
        email=current_user.email,
        phone=current_user.phone,
        role=current_user.role,
        avatar_url=current_user.avatar_url,
        department=current_user.department.name if current_user.department else None,
        designation=current_user.designation.name if current_user.designation else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
        created_at=current_user.created_at,
    )


@router.post("/me/password", status_code=status.HTTP_200_OK)
def change_password(
    request: PasswordChangeRequest,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Allows any authenticated user to change their own password.
    Requires the current password for verification — prevents session
    hijacking from an unlocked screen.
    """
    # 1. Verify they actually know their current password
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    # 2. Prevent no-op changes
    if request.current_password == request.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password.",
        )

    # 3. Hash and persist. Also clear the admin-reset flag so subsequent
    # logins don't force the user back into the change-password screen.
    current_user.password_hash = get_password_hash(request.new_password)
    current_user.must_change_password = False
    db.commit()

    return {"message": "Password updated successfully."}

@router.get("/me/expectations", response_model=UserRoleExpectationResponse)
def get_my_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the role expectations (8 competencies) specific to the
    current user's Department and Designation.
    """
    dept_name = current_user.department.name if current_user.department else "Unassigned"
    desig_name = current_user.designation.name if current_user.designation else "Unassigned"

    # Default fallback object
    fallback_response = UserRoleExpectationResponse(
        department_name=dept_name,
        designation_name=desig_name,
        exp_task_execution="Role expectation not defined",
        exp_ownership="Role expectation not defined",
        exp_project_management="Role expectation not defined",
        exp_client_deliverables="Role expectation not defined",
        exp_communication="Role expectation not defined",
        exp_mentoring="Role expectation not defined",
        exp_firm_growth="Role expectation not defined",
        exp_competency_skills="Role expectation not defined",
    )

    # If the user doesn't have a department or designation, return fallbacks immediately
    if not current_user.department_id or not current_user.designation_id:
        return fallback_response

    # Resolve the competency framework for this role's (department, level).
    # Expectation text now lives on the competency, so this stays consistent
    # with the project-review eval form; an unmapped (dept, level) falls back to
    # the org default set (which carries "Not defined").
    level = current_user.designation.level if current_user.designation else None
    comps, _is_default = get_competency_set(
        db, current_user.org_id, current_user.department_id, level
    )
    if not comps:
        return fallback_response

    nf = "Role expectation not defined"
    by_key = {c.key: (c.expectation or nf) for c in comps}
    return UserRoleExpectationResponse(
        department_name=dept_name,
        designation_name=desig_name,
        exp_task_execution=by_key.get("task_execution", nf),
        exp_ownership=by_key.get("ownership", nf),
        exp_project_management=by_key.get("project_management", nf),
        exp_client_deliverables=by_key.get("client_deliverables", nf),
        exp_communication=by_key.get("communication", nf),
        exp_mentoring=by_key.get("mentoring", nf),
        exp_firm_growth=by_key.get("firm_growth", nf),
        exp_competency_skills=by_key.get("competency_skills", nf),
        expectations={str(c.id): c.expectation for c in comps},
    )
