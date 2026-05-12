"""
ExportAuditLog — Compliance trail for HR/management Excel exports.

Every download initiated through /api/v1/exports/* inserts a row with
status='started' BEFORE the workbook is built and streamed. On success
the row is updated to status='succeeded' with row_count and
completed_at; on failure to status='failed' with error_message. The
started-first commit means a mid-stream crash still leaves a real
audit record rather than nothing — which is the whole point of an
audit log rather than a happy-path log.

403 responses do not reach the audit insert: those are permission
denials, not "granted attempts", and belong in standard request logs.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func

from app.core.database import Base


class ExportAuditLog(Base):
    __tablename__ = "export_audit_log"

    id = Column(Integer, primary_key=True, index=True)

    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # users / goals / annual_reviews / project_reviews / projects / combined / per_employee
    export_type = Column(String, nullable=False)
    # central (AdminPanel Export tab) or inline (per-page toolbar button)
    scope = Column(String, nullable=False)

    # Raw FY token used (e.g. "FY26-27") or "ALL" when caller did not filter.
    fy_filter = Column(String, nullable=True)

    # Non-null only for per_employee exports — points at the subject employee.
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Filled in the post-stream update; may stay NULL if the build aborted early.
    row_count = Column(Integer, nullable=True)

    # started → succeeded | failed
    status = Column(String, nullable=False, default="started", server_default="started")

    file_name = Column(String, nullable=True)

    requested_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Truncated server-side to 500 chars before insert.
    error_message = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_export_audit_org_requested", "org_id", "requested_at"),
        Index("ix_export_audit_org_user", "org_id", "user_id"),
    )
