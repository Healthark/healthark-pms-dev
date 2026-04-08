from typing import Annotated
from fastapi import APIRouter,Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta

from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.core.config import settings
from app.models.user_models import User
from app.schemas.auth_schemas import TokenResponse
from app.api.dependencies import CurrentUser
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]

@router.post("/login", response_model=TokenResponse)
def login(request: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession):
    """
    Authenticate a user and return a JWT token.
    """
    # 1. Look up the user by email
    user = db.query(User).filter(User.email == request.username).first()
    
    # 2. Verify existence and password
    if not user or not verify_password(request.password, user.password_hash):
        # Architect Note: We use a generic error message here intentionally. 
        # Never tell a hacker "Password incorrect" vs "Email not found".
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated."
        )

    # 3. Generate the VIP Pass (JWT)
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    # The payload contains non-sensitive identity data
    token_payload = {
        "sub": user.email,
        "user_id": user.id,
        "org_id": user.org_id,
        "role": user.role
    }
    
    access_token = create_access_token(
        data=token_payload, expires_delta=access_token_expires
    )

    # 4. Return the TokenResponse schema
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id
    }

@router.get("/me")
def get_my_profile(current_user: CurrentUser):
    """
    Fetch the profile of the currently logged-in user.
    If you don't pass a valid JWT token, this endpoint will reject you.
    """
    # Because our CurrentUser dependency already did all the hard work 
    # (checking the token, querying the database, verifying active status),
    # by the time the code reaches here, `current_user` is a guaranteed, secure database object!
    
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "department": current_user.department.name if current_user.department else None,
        "designation": current_user.designation.name if current_user.designation else None
    }