from pydantic import BaseModel, Field
from typing import Optional


class UserProfileResponse(BaseModel):
    """Returned by GET /auth/me — the complete profile of the authenticated user."""
    id: int
    email: str
    full_name: str
    employee_code: str
    phone: Optional[str] = None
    role: str
    department: Optional[str] = None
    designation: Optional[str] = None
    mentor_name: Optional[str] = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, description="Minimum 8 characters")