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
from app.api.dependencies import CurrentUser

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.post("/login", response_model=TokenResponse)
def login(
    request: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
):
    """
    Authenticate a user and return a JWT alongside their organization's
    enabled feature flags. The features list is the single source of truth
    for all frontend routing and sidebar rendering decisions.
    """
    # 1. Credential validation — intentionally generic error to prevent user enumeration
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

    # 2. Resolve the organization's enabled features.
    # We guard with `or []` so a misconfigured org row never crashes login.
    org = db.query(Organization).filter(Organization.id == user.org_id).first()
    features: list[str] = (org.enabled_features or []) if org else []

    # 3. Mint the JWT — payload carries only non-sensitive identity data
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


@router.get("/me")
def get_my_profile(current_user: CurrentUser):
    """
    Returns the authenticated user's profile. The CurrentUser dependency
    handles all JWT validation and soft-delete checks before this runs.
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "department": current_user.department.name if current_user.department else None,
        "designation": current_user.designation.name if current_user.designation else None,
    }