import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.config import settings
from app.models.user_models import User
from app.models.organization_models import Organization
from app.models.password_reset_token_models import PasswordResetToken
from app.schemas.auth_schemas import (
    SessionResponse,
    TokenResponse,
    ResetPasswordRequest,
)
from app.schemas.user_schemas import UserProfile as UserProfileResponse
from app.api.dependencies import CurrentUser

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


def _build_session(user: User, db: Session) -> dict:
    """
    Compute the live set of auth claims for a user. Used both by /login (at
    token issue time) and /session (so the frontend can refresh its cached
    claims — role, features, mentor/mentee state — without forcing a re-login).
    """
    org = db.query(Organization).filter(Organization.id == user.org_id).first()
    features: list[str] = (org.enabled_features or []) if org else []

    # `has_mentor` is true only when the mentor pointer actually resolves to
    # an active user — a dangling FK to a soft-deleted mentor must not gate
    # annual-goal creation open.
    has_mentor = False
    if user.mentor_id is not None:
        has_mentor = db.query(User.id).filter(
            User.id == user.mentor_id,
            User.is_deleted == False,  # noqa: E712
        ).first() is not None

    has_mentees = db.query(User.id).filter(
        User.mentor_id == user.id,
        User.org_id == user.org_id,
        User.is_deleted == False,  # noqa: E712
    ).first() is not None

    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "features": features,
        "has_mentees": has_mentees,
        "has_mentor": has_mentor,
        "must_change_password": bool(user.must_change_password),
        "is_management": bool(user.is_management) and user.role == "Admin",
    }


@router.post("/login", response_model=TokenResponse)
def login(
    request: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
    response: Response,
):
    # Normalize email to lowercase so "David@x.com" and "david@x.com" both log
    # in the same account. Requires emails to be stored lowercase — enforced
    # at user creation time and verified with case-insensitive lookup here.
    email = (request.username or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated.",
        )

    session = _build_session(user, db)

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

    # The JWT rides in an HttpOnly cookie so JS (and therefore XSS) cannot
    # read it. The CSRF token rides in a parallel non-HttpOnly cookie so the
    # frontend can copy it into the X-CSRF-Token header (double-submit).
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    cookie_kwargs = settings.cookie_kwargs()

    response.set_cookie(
        key=settings.ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        max_age=max_age,
        **cookie_kwargs,
    )
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(32),
        httponly=False,
        max_age=max_age,
        **cookie_kwargs,
    )

    return session


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """
    Clear the auth and CSRF cookies server-side. Idempotent — safe to call
    for an unauthenticated client (the frontend's forceLogout() fires this
    blindly on 401/403-deactivated).
    """
    cookie_kwargs = settings.cookie_kwargs()
    response.delete_cookie(key=settings.ACCESS_COOKIE_NAME, **cookie_kwargs)
    response.delete_cookie(key=settings.CSRF_COOKIE_NAME, **cookie_kwargs)
    return None


@router.get("/session", response_model=SessionResponse)
def get_session(current_user: CurrentUser, db: DbSession):
    """
    Live-refresh the auth claims (role, features, has_mentor, has_mentees) that
    were cached at login. The frontend calls this on app mount so promotions,
    feature toggles, and mentor assignments take effect without re-login.
    """
    return _build_session(current_user, db)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: ResetPasswordRequest, db: DbSession):
    """
    Public endpoint — consumes a one-time reset token and sets a new password.

    Called by the frontend `/reset-password?token=…` page after the user
    arrives via the email link. The token is validated by hashing the
    submitted plaintext and looking up `password_reset_tokens.token_hash`;
    the row must exist, not be expired, and not have been used. On success
    we update `password_hash`, clear `must_change_password`, and stamp
    `used_at` so the token cannot be replayed.

    Generic error messages are intentional — we do NOT distinguish "token
    not found" from "token expired" from "token already used" externally,
    so an attacker probing tokens cannot tell which condition failed.

    Unauthenticated by design (the user has lost access to their account).
    The CSRF middleware exempts this path because no auth/CSRF cookies
    exist at the time of call.
    """
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    record = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == token_hash)
        .first()
    )

    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Ask your administrator to issue a new one.",
    )

    if record is None or record.used_at is not None:
        raise invalid

    # `expires_at` is stored as timezone-aware UTC. Compare in the same zone.
    now = datetime.now(timezone.utc)
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        # SQLite returns naive datetimes; treat as UTC.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise invalid

    user = db.query(User).filter(User.id == record.user_id).first()
    if user is None or user.is_deleted:
        raise invalid

    user.password_hash = get_password_hash(payload.new_password)
    user.must_change_password = False
    record.used_at = now
    db.commit()

    return None


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