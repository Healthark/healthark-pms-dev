"""
Notification Schemas — The Topbar's API Contract.

These schemas mirror the TypeScript interfaces in notification.service.ts:
    - StoredNotificationItem →  a persisted `notifications` row
    - TopbarSummary          →  { active_cycle, personal[], announcements[] }

`StoredNotificationItem` is backed by the generic `notifications` table
(see app/models/notification_models.py) and is written by the notification
service on module events / admin broadcasts.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class StoredNotificationItem(BaseModel):
    """A persisted notification row — either a personal event or an
    org-wide announcement. Mirrors the generic Notification model and feeds
    the two Topbar tabs (Notifications / Announcements)."""
    id: int
    category: str
    type: str
    title: str
    body: str
    link: Optional[str] = None
    created_at: datetime
    is_read: bool


class TopbarSummary(BaseModel):
    """Lightweight payload consumed by the Topbar on every page load.

    `personal` and `announcements` are persisted Notification rows split by
    category — they back the two tabs of the bell dropdown."""
    active_cycle: Optional[str] = None
    personal: list[StoredNotificationItem] = []
    announcements: list[StoredNotificationItem] = []
