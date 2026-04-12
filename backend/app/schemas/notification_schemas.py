"""
Notification Schemas — The Topbar's API Contract.

These schemas mirror the TypeScript interfaces in notification.service.ts exactly:
    - NotificationItem  →  { type, message, count, severity }
    - TopbarSummary     →  { active_cycle, notifications[] }

No database table backs these — they are computed on the fly from
Goals, Users, and SystemSettings data. When a dedicated notifications
table is built later (Epic 5), these schemas remain the response contract
and the route simply switches from computing to reading.
"""

from pydantic import BaseModel
from typing import Optional, Literal


class NotificationItem(BaseModel):
    """A single actionable notification displayed in the Topbar dropdown."""
    type: str                                           # e.g. "goals_pending", "goals_changes_requested"
    message: str                                        # Human-readable summary shown in the dropdown
    count: int                                          # Numeric badge value (e.g. 3 pending goals)
    severity: Literal["info", "warning", "blocking"]    # Controls icon + background color on the frontend


class TopbarSummary(BaseModel):
    """
    Lightweight payload consumed by the Topbar on every page load.

    Kept intentionally small — one round-trip, no joins, no pagination.
    The frontend silently swallows failures so the Topbar stays functional
    even if this endpoint is temporarily unavailable.
    """
    active_cycle: Optional[str] = None
    notifications: list[NotificationItem] = []