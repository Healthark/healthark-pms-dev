"""
Project Routes — HR/Admin Project Management (Revised).

Changes:
    - Removed allocated_hours
    - expected_end_date instead of end_date
    - reports_to_id on project (senior who reviews the PM)
    - department_id on assignments (auto-filled from user, editable)
    - assignment_role auto-filled from user's designation (editable)
    - reports_to_name resolved in responses
    - department_name resolved in assignment responses
"""

from typing import List
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func

from app.api.dependencies import DbSession, CurrentUser
from app.models.project_models import Project, ProjectAssignment
from app.models.user_models import User
from app.models.reference_models import Department
from app.schemas.project_schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetail,
    AssignmentCreate, AssignmentUpdate, AssignmentResponse,
)

router = APIRouter()


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage projects.",
        )


def _build_assignment_response(assignment: ProjectAssignment, db: DbSession) -> AssignmentResponse:
    """Resolve user name and department name for an assignment."""
    user = db.query(User).filter(User.id == assignment.user_id).first()
    dept = db.query(Department).filter(Department.id == assignment.department_id).first() if assignment.department_id else None

    return AssignmentResponse(
        id=assignment.id,
        project_id=assignment.project_id,
        user_id=assignment.user_id,
        user_name=user.full_name if user else "Unknown",
        assignment_role=assignment.assignment_role,
        department_id=assignment.department_id,
        department_name=dept.name if dept else None,
        evaluator_type=assignment.evaluator_type,
        assigned_date=assignment.assigned_date,
        created_at=assignment.created_at,
    )


def _resolve_reports_to_name(db: DbSession, reports_to_id: int | None) -> str | None:
    if not reports_to_id:
        return None
    user = db.query(User).filter(User.id == reports_to_id).first()
    return user.full_name if user else None


def _build_project_response(project: Project, db: DbSession, count: int) -> ProjectResponse:
    resp = ProjectResponse.model_validate(project)
    resp.member_count = count
    resp.reports_to_name = _resolve_reports_to_name(db, project.reports_to_id)
    return resp


def _auto_fill_assignment(assignment_in: AssignmentCreate, db: DbSession) -> AssignmentCreate:
    """
    Auto-fill assignment_role from designation and department_id from user
    if not explicitly provided.
    """
    user = db.query(User).filter(User.id == assignment_in.user_id).first()
    if not user:
        return assignment_in

    if not assignment_in.assignment_role and user.designation_id:
        from app.models.reference_models import Designation
        desig = db.query(Designation).filter(Designation.id == user.designation_id).first()
        if desig:
            assignment_in.assignment_role = desig.name

    if not assignment_in.department_id and user.department_id:
        assignment_in.department_id = user.department_id

    return assignment_in


# =====================================================================
# PROJECT CRUD
# =====================================================================

@router.get("/", response_model=List[ProjectResponse])
def list_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """List all active projects with member counts."""
    _require_admin(current_user)

    projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .order_by(Project.created_at.desc())
        .all()
    )

    count_map = dict(
        db.query(ProjectAssignment.project_id, func.count(ProjectAssignment.id))
        .filter(ProjectAssignment.org_id == current_user.org_id)
        .group_by(ProjectAssignment.project_id)
        .all()
    )

    return [_build_project_response(p, db, count_map.get(p.id, 0)) for p in projects]


@router.post("/", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project(
    project_in: ProjectCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Create a project with optional initial team assignments."""
    _require_admin(current_user)

    existing = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.project_code == project_in.project_code,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Project code '{project_in.project_code}' already exists.",
        )

    primary_count = sum(1 for a in project_in.assignments if a.evaluator_type == "Primary")
    if primary_count > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A project can have at most one Primary evaluator (Project Manager).",
        )

    new_project = Project(
        org_id=current_user.org_id,
        project_code=project_in.project_code,
        name=project_in.name,
        description=project_in.description,
        start_date=project_in.start_date,
        expected_end_date=project_in.expected_end_date,
        reports_to_id=project_in.reports_to_id,
    )
    db.add(new_project)
    db.flush()

    for assignment_in in project_in.assignments:
        assignment_in = _auto_fill_assignment(assignment_in, db)
        db.add(ProjectAssignment(
            org_id=current_user.org_id,
            project_id=new_project.id,
            user_id=assignment_in.user_id,
            assignment_role=assignment_in.assignment_role,
            department_id=assignment_in.department_id,
            evaluator_type=assignment_in.evaluator_type,
            assigned_date=assignment_in.assigned_date,
        ))

    db.commit()
    db.refresh(new_project)

    assignment_responses = [_build_assignment_response(a, db) for a in new_project.assignments]

    return ProjectDetail(
        id=new_project.id,
        org_id=new_project.org_id,
        project_code=new_project.project_code,
        name=new_project.name,
        description=new_project.description,
        start_date=new_project.start_date,
        expected_end_date=new_project.expected_end_date,
        reports_to_id=new_project.reports_to_id,
        reports_to_name=_resolve_reports_to_name(db, new_project.reports_to_id),
        is_deleted=new_project.is_deleted,
        created_at=new_project.created_at,
        updated_at=new_project.updated_at,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project_detail(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Get a project with all team assignments."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    assignment_responses = [_build_assignment_response(a, db) for a in project.assignments]

    return ProjectDetail(
        id=project.id,
        org_id=project.org_id,
        project_code=project.project_code,
        name=project.name,
        description=project.description,
        start_date=project.start_date,
        expected_end_date=project.expected_end_date,
        reports_to_id=project.reports_to_id,
        reports_to_name=_resolve_reports_to_name(db, project.reports_to_id),
        is_deleted=project.is_deleted,
        created_at=project.created_at,
        updated_at=project.updated_at,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    project_in: ProjectUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update project metadata."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    update_data = project_in.model_dump(exclude_unset=True)

    if "project_code" in update_data and update_data["project_code"] != project.project_code:
        existing = db.query(Project).filter(
            Project.org_id == current_user.org_id,
            Project.project_code == update_data["project_code"],
            Project.is_deleted == False,  # noqa: E712
            Project.id != project_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Project code '{update_data['project_code']}' already exists.",
            )

    for field, value in update_data.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)

    count = db.query(func.count(ProjectAssignment.id)).filter(
        ProjectAssignment.project_id == project.id
    ).scalar() or 0

    return _build_project_response(project, db, count)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Soft-delete a project."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    project.is_deleted = True
    db.commit()
    return None


# =====================================================================
# ASSIGNMENT CRUD
# =====================================================================

@router.post("/{project_id}/assignments", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def add_assignment(
    project_id: int,
    assignment_in: AssignmentCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Add a team member to a project. Auto-fills role and department from user profile."""
    _require_admin(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    existing = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == assignment_in.user_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user is already assigned to this project.",
        )

    if assignment_in.evaluator_type == "Primary":
        existing_primary = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
        ).first()
        if existing_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This project already has a Primary evaluator (Project Manager).",
            )

    # Auto-fill role and department from user profile
    assignment_in = _auto_fill_assignment(assignment_in, db)

    new_assignment = ProjectAssignment(
        org_id=current_user.org_id,
        project_id=project_id,
        user_id=assignment_in.user_id,
        assignment_role=assignment_in.assignment_role,
        department_id=assignment_in.department_id,
        evaluator_type=assignment_in.evaluator_type,
        assigned_date=assignment_in.assigned_date,
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    return _build_assignment_response(new_assignment, db)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentResponse)
def update_assignment(
    assignment_id: int,
    assignment_in: AssignmentUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update a member's project role, department, or evaluator type."""
    _require_admin(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    update_data = assignment_in.model_dump(exclude_unset=True)

    if update_data.get("evaluator_type") == "Primary":
        existing_primary = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == assignment.project_id,
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.id != assignment_id,
        ).first()
        if existing_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This project already has a Primary evaluator.",
            )

    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    return _build_assignment_response(assignment, db)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Remove a member from a project."""
    _require_admin(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()

    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    db.delete(assignment)
    db.commit()
    return None