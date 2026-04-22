from pydantic import BaseModel, EmailStr

# 1. The Incoming Request (What the React frontend sends us)
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SessionResponse(BaseModel):
    """Live auth claims — role, features, mentor/mentee flags — refreshed
    independently of the JWT so admin changes take effect without re-login."""
    user_id: int
    full_name: str
    role: str
    org_id: int
    features: list[str]
    # True when at least one active user reports to this user via mentor_id.
    # Drives mentor-only UI (e.g. the Team Goals tab) independent of role,
    # since mentorship is an FK relationship, not a role attribute.
    has_mentees: bool = False
    # False for CEO/founders (mentor_id IS NULL) OR when the assigned mentor
    # is soft-deleted. Yearly goal creation is blocked in both cases because
    # the approval workflow needs a live mentor to route to.
    has_mentor: bool = False
    # True when an admin just reset the user's password. The frontend gates
    # all routes until the user completes the change-password flow, which
    # clears this flag.
    must_change_password: bool = False


# 2. The Outgoing Response (What we send back to React)
# After C12 the JWT rides in an HttpOnly cookie set on the response — it is
# deliberately NOT part of the body so JS can never read it. The body carries
# only the session claims the frontend needs to render.
class TokenResponse(SessionResponse):
    pass