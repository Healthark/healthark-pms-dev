"""
Project Schemas — Revised for PM-centric flow.

Changes:
    - Removed allocated_hours
    - Renamed end_date → expected_end_date
    - Added reports_to_id + reports_to_name on Project
    - Added department_id + department_name on Assignment
    - Evaluator type: Primary | Secondary | null (no Peer)
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import date, datetime


# ── Assignment Schemas ───────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    """Payload for adding a member to a project."""
    user_id: int
    assignment_role: Optional[str] = Field(
        default=None, max_length=100,
        description="Auto-filled from designation, editable per project"
    )
    department_id: Optional[int] = Field(
        default=None,
        description="Auto-filled from user's department, editable per project"
    )
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^(Primary|Secondary)$",
    )
    assigned_date: Optional[date] = None


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role or evaluator type."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    department_id: Optional[int] = None
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^(Primary|Secondary)$"
    )
    assigned_date: Optional[date] = None


class AssignmentResponse(BaseModel):
    """Assignment with resolved user/department names."""
    id: int
    project_id: int
    user_id: int
    user_name: str
    assignment_role: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    evaluator_type: Optional[str] = None
    assigned_date: Optional[date] = None
    created_at: datetime


# ── Project Schemas ──────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    """Payload from the Admin Panel when creating a project."""
    project_code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = Field(
        default=None,
        description="Senior person who reviews the PM on this project"
    )
    assignments: list[AssignmentCreate] = []


class ProjectUpdate(BaseModel):
    """Payload for updating project metadata."""
    project_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = None


class ProjectResponse(BaseModel):
    """Lightweight project record for list views."""
    id: int
    org_id: int
    project_code: str
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = None
    reports_to_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    member_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectResponse):
    """Full project with nested assignments."""
    assignments: list[AssignmentResponse] = []