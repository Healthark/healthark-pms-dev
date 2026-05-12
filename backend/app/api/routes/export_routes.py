"""
Excel Export Routes — HR/Management-gated download endpoints.

All endpoints share the same shape:
    1. _require_export_access(current_user, db)       → 403 if not HR/management
    2. Insert ExportAuditLog(status='started') + commit
    3. Build workbook via app.services.exporters.*
    4. Update audit row: status='succeeded', row_count, completed_at
    5. Return StreamingResponse with the BytesIO bytes

If step 3 or 4 raises, the audit row is flipped to status='failed' with
the truncated error_message before re-raising. The 'started' commit is
on its own transaction so even mid-stream crashes leave evidence.

Tenant fence: every query that reaches the exporters receives
current_user.org_id as the org_id arg; the per-employee endpoint
additionally verifies the target user belongs to the same org.
"""

import io
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentUser, DbSession
from app.models.export_audit_log_models import ExportAuditLog
from app.models.reference_models import Department
from app.models.user_models import User
from app.services import exporters

router = APIRouter()


XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ── Auth gate ────────────────────────────────────────────────────────

def _is_hr_user(user: User, db: Session) -> bool:
    if user.department_id is None:
        return False
    dept = (
        db.query(Department)
        .filter(
            Department.id == user.department_id,
            Department.org_id == user.org_id,
        )
        .first()
    )
    if not dept or not dept.name:
        return False
    return dept.name.strip().lower() == "hr"


def _require_export_access(current_user: User, db: Session) -> None:
    if current_user.is_management:
        return
    if _is_hr_user(current_user, db):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only HR or Management users can export data.",
    )


# ── Helpers ──────────────────────────────────────────────────────────

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(value: str) -> str:
    """Strip whitespace / special chars so the filename is Windows-safe."""
    return _SAFE_NAME_RE.sub("-", value.strip()) or "x"


def _build_filename(kind: str, fy: Optional[str], extra: Optional[str] = None) -> str:
    parts = ["pms", _safe_segment(kind)]
    if extra:
        parts.append(_safe_segment(extra))
    parts.append(_safe_segment(fy) if fy else "all")
    parts.append(datetime.now(timezone.utc).strftime("%Y%m%d-%H%M"))
    return "-".join(parts) + ".xlsx"


def _start_audit(
    db: Session,
    *,
    user: User,
    export_type: str,
    scope: str,
    fy: Optional[str],
    target_user_id: Optional[int],
    file_name: str,
    request: Request,
) -> ExportAuditLog:
    ua = (request.headers.get("user-agent") or "")[:500]
    ip = request.client.host if request.client else None
    audit = ExportAuditLog(
        org_id=user.org_id,
        user_id=user.id,
        export_type=export_type,
        scope=scope,
        fy_filter=fy or "ALL",
        target_user_id=target_user_id,
        status="started",
        file_name=file_name,
        user_agent=ua or None,
        ip_address=ip,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return audit


def _finish_audit_success(db: Session, audit: ExportAuditLog, row_count: int) -> None:
    audit.status = "succeeded"
    audit.row_count = row_count
    audit.completed_at = datetime.now(timezone.utc)
    db.commit()


def _finish_audit_failure(db: Session, audit: ExportAuditLog, err: Exception) -> None:
    try:
        audit.status = "failed"
        audit.error_message = str(err)[:500]
        audit.completed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        # Audit cleanup must never mask the original error
        db.rollback()


def _workbook_to_stream(wb) -> io.BytesIO:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _stream_response(buf: io.BytesIO, filename: str) -> StreamingResponse:
    return StreamingResponse(
        buf,
        media_type=XLSX_MEDIA,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Tell axios's blob layer where to find the filename across CORS
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


# ── Inferred scope from referer ──────────────────────────────────────

def _scope_from_request(request: Request) -> str:
    """Best-effort scope tag. The frontend can also pass ?scope=inline|central
    explicitly; if missing we default to 'central' which matches the most
    common path (Admin Panel Export tab)."""
    explicit = request.query_params.get("scope")
    if explicit in ("inline", "central"):
        return explicit
    return "central"


# ── Eligibility probe ────────────────────────────────────────────────

@router.get("/eligibility")
def get_eligibility(db: DbSession, current_user: CurrentUser):
    """Lightweight check used by the frontend to confirm the gate without
    triggering an audit row. Doesn't raise 403 — returns the boolean."""
    can = bool(current_user.is_management) or _is_hr_user(current_user, db)
    reason = "management" if current_user.is_management else (
        "hr_department" if can else "not_eligible"
    )
    return {"can_export": can, "reason": reason}


# ── Searchable employee list for HR dropdown ─────────────────────────

@router.get("/employees")
def list_employees_for_export(
    db: DbSession,
    current_user: CurrentUser,
    q: Optional[str] = None,
):
    """Returns id/full_name/employee_code/email so the Per-Employee picker
    can populate. Searchable by name/code/email. Tenant-fenced."""
    _require_export_access(current_user, db)
    query = db.query(User).filter(User.org_id == current_user.org_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                User.full_name.ilike(like),
                User.employee_code.ilike(like),
                User.email.ilike(like),
            )
        )
    rows = query.order_by(User.full_name.asc()).limit(100).all()
    return [
        {
            "id": u.id,
            "full_name": u.full_name,
            "employee_code": u.employee_code,
            "email": u.email,
            "is_deleted": bool(u.is_deleted),
        }
        for u in rows
    ]


# ── Generic single-entity downloader ─────────────────────────────────

def _download_single(
    *,
    entity: str,
    kind_label: str,
    db: Session,
    current_user: User,
    request: Request,
    fy: Optional[str],
    user_id: Optional[int] = None,
) -> StreamingResponse:
    _require_export_access(current_user, db)
    filename = _build_filename(kind_label, fy)
    audit = _start_audit(
        db,
        user=current_user,
        export_type=entity,
        scope=_scope_from_request(request),
        fy=fy,
        target_user_id=user_id,
        file_name=filename,
        request=request,
    )
    try:
        wb, row_count = exporters.build_single_entity_workbook(
            entity, db, current_user.org_id, fy, user_id
        )
        buf = _workbook_to_stream(wb)
        _finish_audit_success(db, audit, row_count)
    except Exception as e:
        _finish_audit_failure(db, audit, e)
        raise
    return _stream_response(buf, filename)


# ── Single-entity endpoints ──────────────────────────────────────────

@router.get("/users")
def download_users(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
):
    return _download_single(
        entity="users",
        kind_label="users",
        db=db,
        current_user=current_user,
        request=request,
        fy=fy,
    )


@router.get("/projects")
def download_projects(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
):
    return _download_single(
        entity="projects",
        kind_label="projects",
        db=db,
        current_user=current_user,
        request=request,
        fy=fy,
    )


@router.get("/goals")
def download_goals(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
    user_id: Optional[int] = None,
):
    return _download_single(
        entity="goals",
        kind_label="annual-goals",
        db=db,
        current_user=current_user,
        request=request,
        fy=fy,
        user_id=user_id,
    )


@router.get("/annual-reviews")
def download_annual_reviews(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
    user_id: Optional[int] = None,
):
    return _download_single(
        entity="annual_reviews",
        kind_label="annual-reviews",
        db=db,
        current_user=current_user,
        request=request,
        fy=fy,
        user_id=user_id,
    )


@router.get("/project-reviews")
def download_project_reviews(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
    user_id: Optional[int] = None,
):
    return _download_single(
        entity="project_reviews",
        kind_label="project-reviews",
        db=db,
        current_user=current_user,
        request=request,
        fy=fy,
        user_id=user_id,
    )


# ── Combined workbook ────────────────────────────────────────────────

@router.get("/combined")
def download_combined(
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
):
    _require_export_access(current_user, db)
    filename = _build_filename("combined", fy)
    audit = _start_audit(
        db,
        user=current_user,
        export_type="combined",
        scope=_scope_from_request(request),
        fy=fy,
        target_user_id=None,
        file_name=filename,
        request=request,
    )
    try:
        wb, row_count = exporters.build_combined_workbook(db, current_user.org_id, fy)
        buf = _workbook_to_stream(wb)
        _finish_audit_success(db, audit, row_count)
    except Exception as e:
        _finish_audit_failure(db, audit, e)
        raise
    return _stream_response(buf, filename)


# ── Per-employee workbook ────────────────────────────────────────────

@router.get("/employee/{user_id}")
def download_employee(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
    request: Request,
    fy: Optional[str] = None,
):
    _require_export_access(current_user, db)

    target = (
        db.query(User)
        .filter(User.id == user_id, User.org_id == current_user.org_id)
        .first()
    )
    if target is None:
        # Same response shape whether the user doesn't exist or belongs to
        # another tenant — don't leak which.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found in your organization.",
        )

    filename = _build_filename("employee", fy, extra=target.employee_code)
    audit = _start_audit(
        db,
        user=current_user,
        export_type="per_employee",
        scope=_scope_from_request(request),
        fy=fy,
        target_user_id=user_id,
        file_name=filename,
        request=request,
    )
    try:
        wb, row_count = exporters.build_per_employee_workbook(
            db, current_user.org_id, user_id, fy
        )
        buf = _workbook_to_stream(wb)
        _finish_audit_success(db, audit, row_count)
    except Exception as e:
        _finish_audit_failure(db, audit, e)
        raise
    return _stream_response(buf, filename)
