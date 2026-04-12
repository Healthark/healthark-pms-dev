from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta

from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.core.config import settings
from app.models.user_models import User
from app.models.organization_models import Organization
from app.schemas.auth_schemas import TokenResponse
from app.schemas.user_schemas import UserProfile as UserProfileResponse
from app.api.dependencies import CurrentUser

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.post("/login", response_model=TokenResponse)
def login(
    request: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
):
    user = db.query(User).filter(User.email == request.username).first()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated.",
        )

    org = db.query(Organization).filter(Organization.id == user.org_id).first()
    features: list[str] = (org.enabled_features or []) if org else []

    token_payload = {
        "sub": user.email,
        "user_id": user.id,
        "org_id": user.org_id,
        "role": user.role,
    }
    access_token = create_access_token(
        data=token_payload,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "features": features,
    }


@router.get("/me", response_model=UserProfileResponse)
def get_my_profile(current_user: CurrentUser):
    """
    Returns the full profile of the authenticated user.
    Used by the Profile page — richer than the JWT payload alone.
    """
    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        employee_code=current_user.employee_code,
        phone=current_user.phone,
        role=current_user.role,
        department=current_user.department.name if current_user.department else None,
        designation=current_user.designation.name if current_user.designation else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
    )