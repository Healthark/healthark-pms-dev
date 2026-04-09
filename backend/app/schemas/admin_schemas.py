from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import datetime


# ---------------------------------------------------------------------------
# Reference Schemas (used as nested objects inside UserResponse)
# ---------------------------------------------------------------------------

class DepartmentBrief(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)


class DesignationBrief(BaseModel):
    id: int
    name: str
    level: int
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# User Schemas
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str = Field(..., description="One of: Admin, Manager, Principal, Staff")
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    # Admin sets a temporary password on creation; changed by user via Profile later
    password: str = Field(..., min_length=8, description="Minimum 8 characters")


class UserUpdate(BaseModel):
    # Every field is optional — only sent fields are written to the DB
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    employee_code: Optional[str] = None
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None


class UserResponse(BaseModel):
    id: int
    org_id: int
    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    is_deleted: bool
    created_at: datetime

    # Nested objects resolved from SQLAlchemy relationships
    department: Optional[DepartmentBrief] = None
    designation: Optional[DesignationBrief] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# System Settings Schemas
# ---------------------------------------------------------------------------

class SystemSettingsResponse(BaseModel):
    id: int
    org_id: int
    active_cycle: Optional[str] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class SystemSettingsUpdate(BaseModel):
    active_cycle: str = Field(..., description='e.g. "H1 FY26"')