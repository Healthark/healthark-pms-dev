from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.core.security import verify_password, get_password_hash
from app.schemas.user_schemas import PasswordChangeRequest

router = APIRouter()


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

    # 3. Hash and persist
    current_user.password_hash = get_password_hash(request.new_password)
    db.commit()

    return {"message": "Password updated successfully."}