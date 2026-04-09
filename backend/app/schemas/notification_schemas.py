from pydantic import BaseModel
from typing import Optional, Literal


class NotificationItem(BaseModel):
    type: str
    message: str
    count: int
    severity: Literal["info", "warning", "blocking"]


class TopbarSummaryResponse(BaseModel):
    """
    Single payload for the Topbar — one round-trip covers both the active
    cycle badge and the notification bell on every page load.
    """
    active_cycle: Optional[str] = None
    notifications: list[NotificationItem]