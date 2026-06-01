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
) -> Notification:
    """Create one in-app notification row and optionally enqueue an email.

    The row is added to the session but NOT committed — the caller's commit
    flushes it. Email (if requested) fires post-response via ``background_tasks``
    and is silently skipped when SMTP is unconfigured or no recipient email is
    known.
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
    send_email: bool = False,
    background_tasks: Optional[BackgroundTasks] = None,
    cta_label: Optional[str] = None,
) -> int:
    """Fan out one notification to many recipients (one row each).

    Returns the recipient count. Rows are batch-added (not committed). When
    ``send_email`` is set + SMTP configured + ``background_tasks`` present, a
    single batched email task is enqueued so the SMTP connection is reused.
    """
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
        targets = [u.email for u in recipients if u.email]
        if targets:
            background_tasks.add_task(
                _send_batch_emails,
                to_emails=targets,
                title=title,
                body=body,
                cta_link=_abs_link(link),
                cta_label=cta_label,
                org_id=org_id,
            )
    return len(rows)


def _send_batch_emails(
    *,
    to_emails: Sequence[str],
    title: str,
    body: str,
    cta_link: Optional[str],
    cta_label: Optional[str],
    org_id: int,
) -> None:
    """Background worker: send the same notification email to many recipients.

    Best-effort per recipient — a single failure is logged inside ``_send`` and
    does not abort the rest of the batch.
    """
    for to_email in to_emails:
        send_notification_email(
            to_email=to_email,
            title=title,
            body=body,
            cta_link=cta_link,
            cta_label=cta_label,
            org_id=org_id,
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
