"""
Notification service — the single write-path for in-app + email notifications.

Design:
    * Rows are ``db.add()``-ed but NOT committed here — the calling endpoint's
      existing ``db.commit()`` flushes them, so a notification is atomic with
      the business write that produced it (and rolls back together).
    * Email is best-effort and post-commit: when requested AND SMTP is
      configured AND a ``BackgroundTasks`` was passed, the send is enqueued so
      the SMTP handshake never blocks the request thread. Mirrors the pattern
      in ``admin_routes.create_user`` / ``auth_routes.forgot_password``.
    * This module imports models + ``send_email`` only — never route modules —
      so it can be imported anywhere without an import cycle.
"""
from __future__ import annotations

from typing import Optional, Sequence

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.notification_models import Notification
from app.models.project_models import ProjectAssignment
from app.models.user_models import User
from app.services.send_email import is_smtp_configured, send_notification_email


def _abs_link(link: Optional[str]) -> Optional[str]:
    """Turn a relative in-app path into an absolute URL for emails."""
    if not link:
        return None
    if link.startswith(("http://", "https://")):
        return link
    return f"{settings.APP_BASE_URL.rstrip('/')}/{link.lstrip('/')}"


def create_notification(
    db: Session,
    *,
    org_id: int,
    recipient_id: int,
    category: str,
    type: str,
    title: str,
    body: str,
    link: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    actor_id: Optional[int] = None,
    email: bool = False,
    background_tasks: Optional[BackgroundTasks] = None,
    recipient_email: Optional[str] = None,
    recipient_name: Optional[str] = None,
    cta_label: Optional[str] = None,
    email_subject: Optional[str] = None,
    email_intro: Optional[str] = None,
    email_details: Optional[list[tuple[str, str]]] = None,
    snapshot_title: str = "Snapshot",
) -> Notification:
    """Create one in-app notification row and optionally enqueue an email.

    The row is added to the session but NOT committed — the caller's commit
    flushes it. Email (if requested) fires post-response via ``background_tasks``
    and is silently skipped when SMTP is unconfigured or no recipient email is
    known.

    The in-app row always stays a clean ``title`` + short ``body``. The
    ``email_*`` fields only enrich the email into the formal, snapshot style
    (subject override, greeting via ``recipient_name``, lead paragraph, and a
    labelled details table) — omit them and the email keeps the generic look.
    """
    notif = Notification(
        org_id=org_id,
        recipient_id=recipient_id,
        actor_id=actor_id,
        category=category,
        type=type,
        title=title,
        body=body,
        link=link,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(notif)

    if (
        email
        and background_tasks is not None
        and recipient_email
        and is_smtp_configured()
    ):
        background_tasks.add_task(
            send_notification_email,
            to_email=recipient_email,
            title=title,
            body=body,
            cta_link=_abs_link(link),
            cta_label=cta_label,
            org_id=org_id,
            subject=email_subject,
            recipient_name=recipient_name,
            intro=email_intro,
            details=email_details,
            snapshot_title=snapshot_title,
        )
    return notif


def broadcast_notification(
    db: Session,
    *,
    org_id: int,
    recipients: Sequence[User],
    category: str,
    type: str,
    title: str,
    body: str,
    link: Optional[str] = None,
    actor_id: Optional[int] = None,
    write_inapp: bool = True,
    send_email: bool = False,
    background_tasks: Optional[BackgroundTasks] = None,
    cta_label: Optional[str] = None,
    email_subject: Optional[str] = None,
    email_intro: Optional[str] = None,
    email_details: Optional[list[tuple[str, str]]] = None,
    snapshot_title: str = "Snapshot",
) -> int:
    """Fan out one notification to many recipients (one row each).

    Returns the recipient count. When ``write_inapp`` is set (default) an in-app
    row is batch-added per recipient (not committed). When ``send_email`` is set
    + SMTP configured + ``background_tasks`` present, a single batched email task
    is enqueued so the SMTP connection is reused. Setting ``write_inapp=False``
    with ``send_email=True`` is an email-only broadcast (no in-app rows).

    ``email_subject``/``email_intro``/``email_details`` are shared by every
    recipient; the per-recipient greeting name is taken from each ``User`` so a
    fan-out email still addresses people by name.
    """
    if write_inapp:
        rows = [
            Notification(
                org_id=org_id,
                recipient_id=u.id,
                actor_id=actor_id,
                category=category,
                type=type,
                title=title,
                body=body,
                link=link,
            )
            for u in recipients
        ]
        if rows:
            db.add_all(rows)

    if send_email and background_tasks is not None and is_smtp_configured():
        # (email, name) pairs so the batch worker can greet each recipient.
        targets = [(u.email, u.full_name) for u in recipients if u.email]
        if targets:
            background_tasks.add_task(
                _send_batch_emails,
                targets=targets,
                title=title,
                body=body,
                cta_link=_abs_link(link),
                cta_label=cta_label,
                org_id=org_id,
                subject=email_subject,
                intro=email_intro,
                details=email_details,
                snapshot_title=snapshot_title,
            )
    return len(recipients)


def _send_batch_emails(
    *,
    targets: Sequence[tuple[str, Optional[str]]],
    title: str,
    body: str,
    cta_link: Optional[str],
    cta_label: Optional[str],
    org_id: int,
    subject: Optional[str] = None,
    intro: Optional[str] = None,
    details: Optional[list[tuple[str, str]]] = None,
    snapshot_title: str = "Snapshot",
) -> None:
    """Background worker: send the same notification email to many recipients.

    ``targets`` is a sequence of ``(email, recipient_name)`` pairs so each
    message can greet its recipient by name while sharing one subject / intro /
    details block. Best-effort per recipient — a single failure is logged inside
    ``_send`` and does not abort the rest of the batch.
    """
    for to_email, recipient_name in targets:
        send_notification_email(
            to_email=to_email,
            title=title,
            body=body,
            cta_link=cta_link,
            cta_label=cta_label,
            org_id=org_id,
            subject=subject,
            recipient_name=recipient_name,
            intro=intro,
            details=details,
            snapshot_title=snapshot_title,
        )


# ── Recipient resolvers ──────────────────────────────────────────────
# Reuse the org-scoped, soft-delete-aware idiom from goal_routes._mentee_ids_for.


def active_org_users(db: Session, org_id: int) -> list[User]:
    """Every active user in the org — the audience for org-wide announcements."""
    return (
        db.query(User)
        .filter(User.org_id == org_id, User.is_deleted == False)  # noqa: E712
        .all()
    )


def mentor_users(db: Session, org_id: int) -> list[User]:
    """Active users who mentor at least one active user in the org."""
    mentor_ids = (
        db.query(User.mentor_id)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            User.mentor_id.isnot(None),
        )
        .distinct()
    )
    return (
        db.query(User)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            User.id.in_(mentor_ids),
        )
        .all()
    )


def notify_audience(
    db: Session,
    org_id: int,
    *,
    mentors_only: bool = False,
    department_ids: Optional[Sequence[int]] = None,
    designation_ids: Optional[Sequence[int]] = None,
) -> list[User]:
    """Active org users narrowed by the Admin Notify filters (AND-combined).

    No filter set → every active user. Each filter further narrows the set:
    ``mentors_only`` keeps only users who mentor someone; ``department_ids`` /
    ``designation_ids`` keep only users in those departments / designations.
    Empty lists are treated as "no filter on that dimension".
    """
    query = db.query(User).filter(
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    )

    if mentors_only:
        mentor_ids = (
            db.query(User.mentor_id)
            .filter(
                User.org_id == org_id,
                User.is_deleted == False,  # noqa: E712
                User.mentor_id.isnot(None),
            )
            .distinct()
        )
        query = query.filter(User.id.in_(mentor_ids))

    if department_ids:
        query = query.filter(User.department_id.in_(department_ids))

    if designation_ids:
        query = query.filter(User.designation_id.in_(designation_ids))

    return query.all()


def project_team_users(db: Session, org_id: int, project_id: int) -> list[User]:
    """Active users assigned to a project (distinct) — the audience for
    project-level notices like 'project completed'."""
    user_ids = (
        db.query(ProjectAssignment.user_id)
        .filter(
            ProjectAssignment.project_id == project_id,
            ProjectAssignment.org_id == org_id,
            ProjectAssignment.is_deleted == False,  # noqa: E712
        )
        .distinct()
    )
    return (
        db.query(User)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            User.id.in_(user_ids),
        )
        .all()
    )
