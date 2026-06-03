"""
purge_notifications.py - Remove stored notifications past the retention window.

Deletes every `notifications` row across ALL orgs whose `created_at` is older
than the retention window (default: NOTIFICATION_RETENTION_DAYS = 100 days).

This is the scheduled-cleanup half of notification retention. The read path
(GET /notifications/summary) already purges the requesting org lazily; this CLI
covers orgs that never load the app, and can be wired to cron / a Render
scheduled job. No new dependency — it reuses the app's SessionLocal.

Run:
  cd backend && python purge_notifications.py
  cd backend && python purge_notifications.py --days 30   # override window
"""

import argparse
import logging
from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal
from app.models.notification_models import (
    NOTIFICATION_RETENTION_DAYS,
    Notification,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("purge_notifications")


def purge_older_than(db, cutoff: datetime) -> int:
    """Delete notifications created before `cutoff` on the given session and
    commit. Returns the row count removed. Session-accepting so it's unit
    testable against an in-memory DB."""
    deleted = (
        db.query(Notification)
        .filter(Notification.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def purge(days: int = NOTIFICATION_RETENTION_DAYS) -> int:
    """Delete notifications older than `days` across all orgs. Returns the row
    count removed."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = SessionLocal()
    try:
        return purge_older_than(db, cutoff)
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge expired notifications.")
    parser.add_argument(
        "--days",
        type=int,
        default=NOTIFICATION_RETENTION_DAYS,
        help=f"Retention window in days (default: {NOTIFICATION_RETENTION_DAYS}).",
    )
    args = parser.parse_args()

    deleted = purge(args.days)
    logger.info(
        "Purged %d notification(s) older than %d day(s).", deleted, args.days
    )


if __name__ == "__main__":
    main()
