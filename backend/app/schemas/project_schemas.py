"""
Project Schemas — Revised for PM-centric flow.

Changes:
    - Removed allocated_hours
    - Renamed end_date → expected_end_date
    - Added reports_to_id + reports_to_name on Project (required on create)
    - Added pm_id + pm_name on Project (Primary evaluator, resolved in responses)
    - Added secondary_evaluator_id + secondary_evaluator_name on Project
      (single project-level secondary; replaces multi-row Secondary assignments)
    - Added department_id + department_name on Assignment
    - Assignment.evaluator_type is "Primary" or null only
    - ProjectCreate validates: reports_to_id required, exactly one Primary
"""

from pydantic import BaseModel, Field, ConfigDict, model_validator
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
        default=None, pattern=r"^Primary$",
        description="'Primary' marks the PM. Secondary lives on the project, not the assignment.",
    )
    assigned_date: Optional[date] = None
    # Multi-PM hierarchy (project.multi_pm_enabled). The PM who evaluates this
    # member; None for the top PM. Per-member Secondary evaluator.
    manager_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role or PM flag."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    department_id: Optional[int] = None
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^Primary$"
    )
    assigned_date: Optional[date] = None
    manager_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None


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
    # Multi-PM hierarchy — the member's PM + per-member Secondary, with names
    # resolved for display. Null on single-PM projects.
    manager_id: Optional[int] = None
    manager_name: Optional[str] = None
    secondary_evaluator_id: Optional[int] = None
    secondary_evaluator_name: Optional[str] = None
    created_at: datetime
    # Soft-delete audit. is_deleted=True members render greyed at the bottom of
    # the team list; removed_by_name/removed_at power the "… was removed by …
    # on …" line. Active members have is_deleted=False and null removal fields.
    is_deleted: bool = False
    removed_at: Optional[datetime] = None
    removed_by_name: Optional[str] = None


# ── Project Schemas ──────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    """Payload from the Admin Panel when creating a project.

    Validation:
        - reports_to_id is required.
        - assignments must contain exactly one entry with evaluator_type='Primary'
          (the PM). Members beyond the PM are optional.
        - secondary_evaluator_id is optional (editable later).
    """
    # No max_length / character pattern: project codes are free-form and may
    # contain spaces and hyphens (e.g. "Project ERROR Replication - 1"). The DB
    # column is an unbounded String, so only the "required, non-empty" rule
    # (min_length=1) is enforced here.
    project_code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: int = Field(
        ...,
        description="Senior person who reviews the PM on this project (required)",
    )
    secondary_evaluator_id: Optional[int] = Field(
        default=None,
        description="Single Secondary evaluator for the project; optional, editable later.",
    )
    assignments: list[AssignmentCreate] = Field(default_factory=list)
    multi_pm_enabled: bool = Field(
        default=False,
        description="When True the team uses a PM hierarchy (per-member manager_id + secondary) instead of one Primary evaluating everyone.",
    )

    @model_validator(mode="after")
    def _require_one_primary(self) -> "ProjectCreate":
        # Multi-PM projects validate their hierarchy in _validate_hierarchy
        # instead of the single-Primary rule.
        if self.multi_pm_enabled:
            return self
        primaries = [a for a in self.assignments if a.evaluator_type == "Primary"]
        if len(primaries) != 1:
            raise ValueError(
                "A project must have exactly one Primary evaluator (PM). "
                "Mark exactly one member with evaluator_type='Primary'."
            )
        return self

    @model_validator(mode="after")
    def _assignment_joined_after_start(self) -> "ProjectCreate":
        """Each member's joined date (assigned_date) must be on or after the
        project's start_date. Only checked when both are set — the fields
        remain individually optional."""
        if self.start_date is None:
            return self
        for a in self.assignments:
            if a.assigned_date is not None and a.assigned_date < self.start_date:
                raise ValueError(
                    "A member's Joined Date cannot be earlier than the project Start Date."
                )
        return self

    @model_validator(mode="after")
    def _validate_hierarchy(self) -> "ProjectCreate":
        """Multi-PM only: validate the per-member PM graph.

        The hierarchy is a forest of members: each member's manager_id is the
        PM who evaluates them, or None when they're a top-level member reviewed
        by "PM Reports To". Rules (PR2 — routing is now hierarchy-aware):

        - a member cannot be their own Project Manager or their own Secondary,
        - the manager graph (member -> member edges) has no cycles.

        Deliberately NOT constrained (per the multi-PM design decisions):
        - the number of roots is open — zero, one, or many top-level members
          are allowed; "PM Reports To" reviews every root,
        - a member's Project Manager may be ANY org user, not only a project
          member (a non-member PM just has no review of their own here); org
          membership is validated at the route layer,
        - "PM Reports To" may itself be one of the project's Project Managers.
          No one ever reviews themselves — the routing layer skips self-pairs.
        """
        if not self.multi_pm_enabled:
            return self
        assignments = self.assignments
        if not assignments:
            raise ValueError("A multi-PM project needs at least one member.")
        for a in assignments:
            if a.manager_id is not None and a.manager_id == a.user_id:
                raise ValueError("A member cannot be their own Project Manager.")
            if (
                a.secondary_evaluator_id is not None
                and a.secondary_evaluator_id == a.user_id
            ):
                raise ValueError("A member cannot be their own Secondary Evaluator.")
        # Cycle detection — follow member -> member manager edges only. A
        # manager who isn't a project member ends the walk (they can't loop
        # back in), so only cycles among members are rejected.
        manager_of = {a.user_id: a.manager_id for a in assignments}
        member_ids = set(manager_of)
        for a in assignments:
            seen: set[int] = set()
            cur: Optional[int] = a.user_id
            while cur is not None and cur in member_ids:
                if cur in seen:
                    raise ValueError("The PM hierarchy contains a cycle.")
                seen.add(cur)
                cur = manager_of.get(cur)
        return self

    @model_validator(mode="after")
    def _no_reviewer_role_overlap(self) -> "ProjectCreate":
        """The PM, the senior who reviews them ("Reports To"), and the
        Secondary evaluator must be three distinct people. Allowing any
        two of these to be the same user would let one person review
        themselves or hold both reviewer roles, breaking the chain.
        """
        # Single-PM only — multi-PM distinctness is handled in _validate_hierarchy.
        if self.multi_pm_enabled:
            return self
        primaries = [a for a in self.assignments if a.evaluator_type == "Primary"]
        pm_user_id = primaries[0].user_id if primaries else None

        if pm_user_id is not None and self.reports_to_id == pm_user_id:
            raise ValueError(
                "PM Reports To must be a different user than the PM."
            )
        if (
            self.secondary_evaluator_id is not None
            and pm_user_id is not None
            and self.secondary_evaluator_id == pm_user_id
        ):
            raise ValueError(
                "Secondary Evaluator must be a different user than the PM."
            )
        if (
            self.secondary_evaluator_id is not None
            and self.secondary_evaluator_id == self.reports_to_id
        ):
            raise ValueError(
                "Secondary Evaluator must be a different user than PM Reports To."
            )
        # The Secondary evaluator is an OUTSIDE reviewer — they cannot also be a
        # member of the team they evaluate (that would make them both reviewer
        # and reviewee on the project).
        member_ids = {a.user_id for a in self.assignments}
        if (
            self.secondary_evaluator_id is not None
            and self.secondary_evaluator_id in member_ids
        ):
            raise ValueError(
                "Secondary Evaluator cannot also be a team member of the project."
            )
        return self

    @model_validator(mode="after")
    def _no_duplicate_members(self) -> "ProjectCreate":
        """Each user may appear at most once in the initial assignments.
        The (org, project, user) unique index would otherwise raise a DB
        IntegrityError (500) on the duplicate insert."""
        ids = [a.user_id for a in self.assignments]
        if len(ids) != len(set(ids)):
            raise ValueError(
                "A user can only be added to a project once; remove the duplicate member."
            )
        return self


class ProjectUpdate(BaseModel):
    """Payload for updating project metadata."""
    # Mirrors ProjectCreate: free-form code, no length/character cap.
    project_code: Optional[str] = Field(default=None, min_length=1)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None
    multi_pm_enabled: Optional[bool] = None


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
    pm_id: Optional[int] = None
    pm_name: Optional[str] = None
    secondary_evaluator_id: Optional[int] = None
    secondary_evaluator_name: Optional[str] = None
    multi_pm_enabled: bool = False
    status: str = "active"
    completed_at: Optional[datetime] = None
    completed_by_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    member_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectResponse):
    """Full project with nested assignments."""
    assignments: list[AssignmentResponse] = []


class ProjectsFilterOptions(BaseModel):
    """Distinct start years + PM names across the org's non-deleted
    projects. Drives the Projects tab's Year + PM filter dropdowns once
    the list is paginated. Served from a dedicated endpoint, cached with
    a long staleTime like the other paginated grids' filter-options.
    """
    years: list[int]
    pms: list[str]