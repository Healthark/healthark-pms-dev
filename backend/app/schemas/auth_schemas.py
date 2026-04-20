from pydantic import BaseModel, EmailStr

# 1. The Incoming Request (What the React frontend sends us)
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# 2. The Outgoing Response (What we send back to React)
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

    # We also send some basic user info so the frontend knows who logged in
    user_id: int
    full_name: str
    role: str
    org_id: int
    features: list[str]
    # True when at least one active user reports to this user via mentor_id.
    # Drives mentor-only UI (e.g. the Team Goals tab) independent of role,
    # since mentorship is an FK relationship, not a role attribute.
    has_mentees: bool = False