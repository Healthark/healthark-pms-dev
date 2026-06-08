"""
Notification Routes — The Topbar's Data Feed.

Endpoints:
    GET  /api/v1/notifications/summary             →  Any authenticated user
    POST /api/v1/notifications/{id}/mark-read       →  Recipient only
    POST /api/v1/notifications/mark-all-read        →  Recipient (optional ?category)

The summary serves persisted rows from the generic `notifications` table,
split into `personal` (events) and `announcements` (org-wide broadcasts) for
the two Topbar tabs. Rows are written by the notification service
(app/services/notifications.py) on module events / admin broadcasts.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Ownership:        Stored rows are scoped to current_user.id as
                                the recipient — a user only ever sees their own.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import CurrentUser, DbSession
from app.core.cycle_utils import get_current_cycle_info, resolve_today
from app.models.notification_models import (
    NOTIFICATION_RETENTION_DAYS,
    Notification,
    NotificationCategory,
)
from app.models.system_settings_models import SystemSettings
from app.schemas.notification_schemas import (
    StoredNotificationItem,
    TopbarSummary,
)

router = APIRouter()


@router.get("/summary", response_model=TopbarSummary)
def get_topbar_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle name and the user's stored notifications
    (personal events + org-wide announcements) for the Topbar bell.
    """
    # ── Retention: lazy purge (no scheduler exists) ──────────────────
    # Drop this org's stored rows older than the retention window on the
    # read path. One indexed bulk DELETE (ix_notifications_org covers the
    # org filter) so the summary GET stays cheap; the CLI
    # (app.scripts.purge_notifications) covers orgs that never load the app.
    cutoff = datetime.now(timezone.utc) - timedelta(days=NOTIFICATION_RETENTION_DAYS)
    db.query(Notification).filter(
        Notification.org_id == current_user.org_id,
        Notification.created_at < cutoff,
    ).delete(synchronize_session=False)
    db.commit()

    # ── Active Cycle ─────────────────────────────────────────────────
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    # Dynamically calculate the active cycle based on the org's cadence
    if settings:
        active_cycle = get_current_cycle_info(
            current_date=resolve_today(settings),
            cycle_type=settings.cycle_type,
            fiscal_start_month=settings.fiscal_start_month
        )
    else:
        active_cycle = None

    # ── Stored notifications (generic table), split by category ──────
    # Personal events feed the "Notifications" tab; announcements feed the
    # "Announcements" tab. Each is the newest 20, recipient + org scoped.
    def _recent(category: str) -> list[StoredNotificationItem]:
        rows = (
            db.query(Notification)
            .filter(
                Notification.recipient_id == current_user.id,
                Notification.org_id == current_user.org_id,
                Notification.category == category,
            )
            .order_by(Notification.created_at.desc())
            .limit(20)
            .all()
        )
        return [
            StoredNotificationItem(
                id=n.id,
                category=n.category,
                type=n.type,
                title=n.title,
                body=n.body,
                link=n.link,
                created_at=n.created_at,
                is_read=n.is_read,
            )
            for n in rows
        ]

    return TopbarSummary(
        active_cycle=active_cycle,
        personal=_recent(NotificationCategory.PERSONAL.value),
        announcements=_recent(NotificationCategory.ANNOUNCEMENT.value),
    )


@router.post("/{notification_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notification_read(
    notification_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Mark a single stored notification as read (personal OR announcement).

    Scoped to the current user (recipient) + tenant, so a user can only ever
    flip their own notifications. A missing/foreign id returns 404 rather than
    silently succeeding. Computed standing-count notifications carry no read
    state — they clear themselves when the underlying data is resolved.
    """
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_id == current_user.id,
        Notification.org_id == current_user.org_id,
    ).first()

    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    if not notif.is_read:
        notif.is_read = True
        db.commit()
    return None


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    db: DbSession,
    current_user: CurrentUser,
    category: str | None = None,
):
    """Mark the current user's stored notifications as read.

    Optional `?category=personal|announcement` scopes the bulk action to a
    single Topbar tab; omitting it clears both. An unrecognised category value
    is ignored (treated as "no filter") rather than erroring.
    """
    query = db.query(Notification).filter(
        Notification.recipient_id == current_user.id,
        Notification.org_id == current_user.org_id,
        Notification.is_read == False,  # noqa: E712
    )
    if category in (
        NotificationCategory.PERSONAL.value,
        NotificationCategory.ANNOUNCEMENT.value,
    ):
        query = query.filter(Notification.category == category)

    query.update({"is_read": True})
    db.commit()
    return None
