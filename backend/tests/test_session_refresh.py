"""
Sliding idle-session timeout.

POST /auth/refresh re-mints the access cookie with a fresh expiry so an active
user is never logged out. The auto-logout itself is not a server-side timer —
it falls out of the access token simply expiring and the next request 401ing in
get_current_user. Both halves are covered here:

  - refresh_session() re-issues a cookie with a ~30-min-ahead exp and reuses the
    existing CSRF value (mints one only if absent).
  - an expired token is rejected with 401 (the frontend's logout trigger).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api import dependencies
from app.api.routes import auth_routes
from app.core.config import settings
from app.core.database import Base
from app.core.security import ALGORITHM, create_access_token, get_password_hash
from app.models.organization_models import Organization
from app.models.user_models import User


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_user(db, email="dave@example.com"):
    org = Organization(name="Org", enabled_features=["dashboard"])
    db.add(org)
    db.flush()
    u = User(
        org_id=org.id,
        employee_code="EMP-0001",
        full_name="Dave",
        email=email,
        role="Staff",
        password_hash=get_password_hash("correct-horse"),
        is_deleted=False,
    )
    db.add(u)
    db.commit()
    return u


def _set_cookies(response: Response) -> dict[str, str]:
    """Parse name -> value out of every Set-Cookie header on the response."""
    out: dict[str, str] = {}
    for key, value in response.raw_headers:
        if key == b"set-cookie":
            cookie = value.decode()
            name, _, rest = cookie.partition("=")
            out[name] = rest.split(";", 1)[0]
    return out


def _token_payload(user: User) -> dict:
    return {
        "sub": user.email,
        "user_id": user.id,
        "org_id": user.org_id,
        "role": user.role,
    }


def test_refresh_reissues_access_cookie_with_fresh_expiry(db):
    user = _make_user(db)
    request = SimpleNamespace(cookies={settings.CSRF_COOKIE_NAME: "csrf-abc"})
    response = Response()

    session = auth_routes.refresh_session(user, db, request, response)
    # Live claims come back so the caller can refresh role/feature flags too.
    assert session["user_id"] == user.id

    cookies = _set_cookies(response)
    assert settings.ACCESS_COOKIE_NAME in cookies
    # The existing CSRF value is reused (the double-submit pair must stay matched).
    assert cookies[settings.CSRF_COOKIE_NAME] == "csrf-abc"

    payload = jwt.decode(
        cookies[settings.ACCESS_COOKIE_NAME],
        settings.SECRET_KEY,
        algorithms=[ALGORITHM],
    )
    assert payload["user_id"] == user.id
    exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    minutes_ahead = (exp - datetime.now(timezone.utc)).total_seconds() / 60
    # Window slid forward to ~ACCESS_TOKEN_EXPIRE_MINUTES (allow clock slack).
    assert (
        settings.ACCESS_TOKEN_EXPIRE_MINUTES - 2
        <= minutes_ahead
        <= settings.ACCESS_TOKEN_EXPIRE_MINUTES + 1
    )


def test_refresh_mints_csrf_when_cookie_absent(db):
    user = _make_user(db)
    request = SimpleNamespace(cookies={})
    response = Response()

    auth_routes.refresh_session(user, db, request, response)

    cookies = _set_cookies(response)
    # Fallback path still issues a usable, non-empty CSRF token.
    assert cookies.get(settings.CSRF_COOKIE_NAME)


def test_expired_token_yields_401(db):
    """The auto-logout trigger: once the window lapses, the cookie's token is
    expired and get_current_user rejects it — which the frontend turns into a
    redirect to /login with the idle notice."""
    user = _make_user(db)
    expired = create_access_token(
        data=_token_payload(user),
        expires_delta=timedelta(minutes=-1),
    )
    with pytest.raises(HTTPException) as exc:
        dependencies.get_current_user(db, cookie_token=expired, authorization=None)
    assert exc.value.status_code == 401
