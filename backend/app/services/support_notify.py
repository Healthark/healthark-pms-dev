"""
Support ticket notifications.

When a user submits a "Report an Issue" ticket, a small set of inboxes
(config: SUPPORT_NOTIFY_EMAILS) get a formatted email so the issue is seen
without anyone having to poll the admin Responses queue.

The email is built from the shared `send_notification_email` snapshot
template (labelled key/value "Issue details" table + a body carrying the
free-text description/remarks), so it renders consistently with the rest of
the PMS mail.

The content builder (`build_ticket_notification`) is a pure function so the
"defined format" can be unit-tested without SMTP. Delivery is best-effort:
`send_ticket_notifications` loops the recipients and swallows per-recipient
failures — a support ticket is already persisted before this runs, and the
admin Responses queue is the source of truth.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.config import settings
from app.services.send_email import send_notification_email

logger = logging.getLogger(__name__)


def support_notify_recipients() -> list[str]:
    """Parse SUPPORT_NOTIFY_EMAILS (comma-separated) into a clean list."""
    return [e.strip() for e in settings.SUPPORT_NOTIFY_EMAILS.split(",") if e.strip()]


def build_ticket_notification(
    *,
    submitter_name: str,
    submitter_email: Optional[str],
    pms_page: str,
    tab: Optional[str],
    description: str,
    remarks: Optional[str],
    photo_count: int,
    submitted_display: str,
) -> tuple[str, str, list[tuple[str, str]]]:
    """Build the (subject, body, details) for a new-ticket email.

    `body` carries the free-text (description + optional remarks) with real
    newlines — the HTML template converts them to <br> and the text
    fallback keeps them as-is. `details` is the labelled snapshot table."""
    subject = f"New Support Issue — {pms_page}"

    body_parts = [
        "A new issue was reported via the Performance Evaluation System.",
        "",
        "Description:",
        description,
    ]
    if remarks:
        body_parts += ["", "Remarks:", remarks]
    body = "\n".join(body_parts)

    details: list[tuple[str, str]] = [
        ("Reporter", submitter_name),
        ("Reporter email", submitter_email or "—"),
        ("PMS Page", pms_page),
        ("Tab", tab or "—"),
        ("Photos attached", str(photo_count)),
        ("Submitted", submitted_display),
    ]
    return subject, body, details


def send_ticket_notifications(
    *,
    recipients: list[str],
    subject: str,
    body: str,
    details: list[tuple[str, str]],
    cta_link: Optional[str] = None,
    org_id: Optional[int] = None,
) -> None:
    """Email every recipient about a new support ticket. Best-effort — a
    failure for one inbox is logged and does not stop the others. Intended
    to be invoked via FastAPI BackgroundTasks so the SMTP handshake never
    sits on the request thread."""
    for to_email in recipients:
        try:
            send_notification_email(
                to_email=to_email,
                title=subject,
                subject=subject,
                body=body,
                intro=body,
                details=details,
                snapshot_title="Issue details",
                cta_link=cta_link,
                cta_label="Open in PMS" if cta_link else None,
                org_id=org_id,
            )
        except Exception:  # noqa: BLE001 — best-effort; never break the batch
            logger.exception("Failed to send support notification to %s", to_email)
