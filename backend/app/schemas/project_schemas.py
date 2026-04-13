"""
Project Schemas — Admin/HR Project Management API Contract.

Covers:
    Project CRUD:       Create, Update, Response
    Assignment CRUD:    Create, Update, Response (with user name resolution)
    ProjectDetail:      Full project with nested assignments list

The assignment_role is free-text (e.g. "Frontend Developer", "Tester").
The evaluator_type is constrained to Primary/Secondary/null.
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
        description="Project role, e.g. 'Frontend Developer', 'Tester'"
    )
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^(Primary|Secondary)$",
        description="Evaluator designation: Primary, Secondary, or null"
    )
    assigned_date: Optional[date] = None


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role or evaluator type."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^(Primary|Secondary)$"
    )
    assigned_date: Optional[date] = None


class AssignmentResponse(BaseModel):
    """Assignment with resolved user name for display."""
    id: int
    project_id: int
    user_id: int
    user_name: str
    assignment_role: Optional[str] = None
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
    end_date: Optional[date] = None
    allocated_hours: Optional[str] = None
    # Optional: create project with initial members in one shot
    assignments: list[AssignmentCreate] = []


class ProjectUpdate(BaseModel):
    """Payload for updating project metadata (not assignments)."""
    project_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    allocated_hours: Optional[str] = None


class ProjectResponse(BaseModel):
    """Lightweight project record for list views."""
    id: int
    org_id: int
    project_code: str
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    allocated_hours: Optional[str] = None
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    member_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectResponse):
    """Full project with nested assignments — used in the detail/edit view."""
    assignments: list[AssignmentResponse] = []