"""
Support Routes — the in-app "Report an Issue" intake + admin queue.

Endpoints (all under /api/v1/support):
    POST /tickets            → submit a ticket (any authenticated user)
    GET  /tickets            → list the org's tickets (Admin only)
    GET  /tickets/{id}       → one ticket, photos included (Admin only)

Security layers:
    Layer 1 — Authentication:   CurrentUser (JWT) on every endpoint.
    Layer 2 — Tenant isolation: every query filters by current_user.org_id.
    Layer 3 — Role:             the two read endpoints require role == "Admin"
                                (the queue is HR-facing). Submitting is open to
                                every authenticated user by design.

Photos live on a child table and are deliberately NOT loaded by the list
endpoint — it returns a `photo_count` from a single grouped query so the
Responses queue stays lean regardless of how many megabytes of base64 the
tickets carry.
"""

from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import func, or_

from app.api.dependencies import CurrentUser, DbSession
from app.core.config import settings
from app.models.support_models import (
    SUPPORT_STATUSES,
    SupportTicket,
    SupportTicketPhoto,
)
from app.models.user_models import User
from app.schemas.support_schemas import (
    SupportPhotoOut,
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketRow,
    SupportTicketStatusResponse,
    SupportTicketStatusUpdate,
)
from app.services.support_notify import (
    build_ticket_notification,
    send_ticket_notifications,
    support_notify_recipients,
)

router = APIRouter()


def _require_admin(current_user: User) -> None:
    """The Responses queue is HR-facing — only Admins may read it."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view support responses.",
        )


# ── Submit ──────────────────────────────────────────────────────────


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
def create_ticket(
    payload: SupportTicketCreate,
    current_user: CurrentUser,
    db: DbSession,
    background_tasks: BackgroundTasks,
):
    """Record a support ticket for the current user's org. `submitter_name`
    is snapshotted so the queue still shows who filed it even if the account
    is later renamed or deactivated. Photo size/MIME/count are already
    validated by the schema.

    After the row is committed, a formatted notification email is queued to
    the SUPPORT_NOTIFY_EMAILS inboxes (best-effort via BackgroundTasks — a
    delivery failure never affects the submission)."""
    ticket = SupportTicket(
        org_id=current_user.org_id,
        user_id=current_user.id,
        submitter_name=current_user.full_name,
        pms_page=payload.pms_page,
        tab=payload.tab,
        description=payload.description,
        remarks=payload.remarks,
    )
    db.add(ticket)
    db.flush()  # assign ticket.id before attaching photos

    for idx, photo in enumerate(payload.photos):
        db.add(
            SupportTicketPhoto(
                ticket_id=ticket.id,
                data_uri=photo.data_uri,
                filename=photo.filename,
                sort_order=idx,
            )
        )

    db.commit()
    db.refresh(ticket)

    # Notify the support inboxes. Snapshot every value we need into plain
    # locals now — the ORM instance is tied to this request's session, which
    # is gone by the time the background task runs.
    recipients = support_notify_recipients()
    if recipients:
        submitted_display = (
            ticket.created_at.strftime("%d %b %Y, %H:%M UTC")
            if ticket.created_at
            else ""
        )
        subject, body, details = build_ticket_notification(
            submitter_name=ticket.submitter_name,
            submitter_email=current_user.email,
            pms_page=ticket.pms_page,
            tab=ticket.tab,
            description=ticket.description,
            remarks=ticket.remarks,
            photo_count=len(payload.photos),
            submitted_display=submitted_display,
        )
        cta_link = f"{settings.APP_BASE_URL.rstrip('/')}/support"
        background_tasks.add_task(
            send_ticket_notifications,
            recipients=recipients,
            subject=subject,
            body=body,
            details=details,
            cta_link=cta_link,
            org_id=ticket.org_id,
        )

    return {"id": ticket.id}


# ── Read (Admin) ──────────────────────────────────────────────────────


@router.get("/tickets", response_model=List[SupportTicketRow])
def list_tickets(
    current_user: CurrentUser,
    db: DbSession,
    pms_page: Optional[str] = Query(
        None, description="Exact PMS-page filter (e.g. 'Annual Goals')."
    ),
    q: Optional[str] = Query(
        None, description="Case-insensitive search over reporter, description, remarks."
    ),
    status_filter: Optional[str] = Query(
        None,
        alias="status",
        description="Filter by lifecycle status (pending, in_progress, completed).",
    ),
):
    """List the org's support tickets, newest first. Optional `pms_page`,
    `status`, and free-text `q` filters. Photos are excluded — each row
    carries only a `photo_count`."""
    _require_admin(current_user)

    query = db.query(SupportTicket).filter(
        SupportTicket.org_id == current_user.org_id
    )

    if pms_page and pms_page.strip():
        query = query.filter(SupportTicket.pms_page == pms_page.strip())

    if status_filter and status_filter in SUPPORT_STATUSES:
        query = query.filter(SupportTicket.status == status_filter)

    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                SupportTicket.submitter_name.ilike(like),
                SupportTicket.description.ilike(like),
                SupportTicket.remarks.ilike(like),
                SupportTicket.tab.ilike(like),
            )
        )

    tickets = query.order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc()).all()
    if not tickets:
        return []

    # One grouped query for all photo counts — no N+1.
    ticket_ids = [t.id for t in tickets]
    count_rows = (
        db.query(
            SupportTicketPhoto.ticket_id,
            func.count(SupportTicketPhoto.id),
        )
        .filter(SupportTicketPhoto.ticket_id.in_(ticket_ids))
        .group_by(SupportTicketPhoto.ticket_id)
        .all()
    )
    counts = {int(tid): int(cnt) for tid, cnt in count_rows}

    return [
        SupportTicketRow(
            id=t.id,
            submitter_name=t.submitter_name,
            pms_page=t.pms_page,
            tab=t.tab,
            description=t.description,
            remarks=t.remarks,
            status=t.status,
            photo_count=counts.get(t.id, 0),
            created_at=t.created_at,
        )
        for t in tickets
    ]


@router.get("/tickets/{ticket_id}", response_model=SupportTicketDetail)
def get_ticket(
    ticket_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    """A single ticket with its photos. Tenant-fenced to the admin's org."""
    _require_admin(current_user)

    ticket = (
        db.query(SupportTicket)
        .filter(
            SupportTicket.id == ticket_id,
            SupportTicket.org_id == current_user.org_id,
        )
        .first()
    )
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support ticket not found.",
        )

    return SupportTicketDetail(
        id=ticket.id,
        submitter_name=ticket.submitter_name,
        pms_page=ticket.pms_page,
        tab=ticket.tab,
        description=ticket.description,
        remarks=ticket.remarks,
        status=ticket.status,
        created_at=ticket.created_at,
        photos=[
            SupportPhotoOut(id=p.id, data_uri=p.data_uri, filename=p.filename)
            for p in ticket.photos
        ],
    )


# ── Update status (Admin) ─────────────────────────────────────────────


@router.patch(
    "/tickets/{ticket_id}/status",
    response_model=SupportTicketStatusResponse,
)
def update_ticket_status(
    ticket_id: int,
    payload: SupportTicketStatusUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Set a ticket's lifecycle status. Admin-only, tenant-fenced. Any status
    may be set from any status — the queue is a free-form triage board, not a
    one-way ladder."""
    _require_admin(current_user)

    ticket = (
        db.query(SupportTicket)
        .filter(
            SupportTicket.id == ticket_id,
            SupportTicket.org_id == current_user.org_id,
        )
        .first()
    )
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Support ticket not found.",
        )

    ticket.status = payload.status
    db.commit()
    return SupportTicketStatusResponse(id=ticket.id, status=ticket.status)
