"""
Project Models — The Project Registry and Team Assignment.

Two models in one file:
    Project            — The org-scoped project entity
    ProjectAssignment   — Junction table mapping users to projects with
                          project roles, evaluator types, and assignment dates

Design Decisions:
    - assignment_role is free-text (e.g. "Frontend Developer", "Tester") because
      project roles vary wildly across orgs and projects. System roles (Admin,
      Manager, Staff) remain in the users table.
    - evaluator_type designates what kind of evaluator this person is for OTHER
      members of the project. "Primary" means they evaluate all other members.
      "Secondary" and "Peer" provide lighter impact-statement-only feedback.
      null means they are a regular member who doesn't evaluate others.
    - assigned_date tracks when the employee joined the project (distinct from
      project start_date). This solves the "2-year project, 3-month member"
      display problem.
"""

from sqlalchemy import (
    Column, Integer, String, Text, Date, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    project_code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    allocated_hours = Column(String, nullable=True)

    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_projects_org_code", "org_id", "project_code", unique=True),
    )

    # Relationships
    organization = relationship("Organization")
    assignments = relationship(
        "ProjectAssignment",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectAssignment(Base):
    __tablename__ = "project_assignments"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # What this person does ON the project (free-text)
    # e.g. "Frontend Developer", "Tester", "Project Manager"
    assignment_role = Column(String, nullable=True)

    # What kind of evaluator this person is FOR other members
    # "Primary" = evaluates all other members (one per project)
    # "Secondary" / "Peer" = provides impact statement only
    # null = regular member, not an evaluator
    evaluator_type = Column(String, nullable=True)

    # When this employee was assigned to the project
    # (distinct from project.start_date)
    assigned_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # One assignment per user per project
        Index("ix_project_assignments_org_proj_user", "org_id", "project_id", "user_id", unique=True),
    )

    # Relationships
    project = relationship("Project", back_populates="assignments")
    user = relationship("User")