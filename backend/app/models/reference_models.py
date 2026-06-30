from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base

class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # This prevents two "Oncology" departments from existing in the same organization
    __table_args__ = (
        UniqueConstraint('org_id', 'name', name='uix_org_department_name'),
    )

class Designation(Base):
    __tablename__ = "designations"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    # Department this role belongs to. Roles are department-scoped: the same
    # title (e.g. "Consultant") is a SEPARATE row per department, so selecting a
    # department narrows the role list and a role implies its department.
    # Nullable only for legacy/unscoped rows that predate scoping.
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    level = Column(Integer, default=1) # For hierarchical sorting (1=Junior, 5=Partner)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # One role per (org, department, name): a title may repeat across
        # departments, but not within a single department.
        UniqueConstraint('org_id', 'department_id', 'name', name='uix_org_dept_designation_name'),
    )

    department = relationship("Department")