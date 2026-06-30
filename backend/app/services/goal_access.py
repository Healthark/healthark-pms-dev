"""
goal_access — per-employee annual-goal gate exceptions.

Centralises the lookup helpers for `GoalAccessOverride` so the goal gate
(`goal_routes`) and the admin endpoints (`admin_routes`) share one source of
truth for "does this employee have an active grant?". Imports models +
cycle_utils only — never route modules — so it stays import-cycle-free.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from app.core.cycle_utils import (
    _half_label_of_cycle_string,
    goal_cycle_name_for_active,
)
from app.models.goal_access_override_models import GoalAccessOverride

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.system_settings_models import SystemSettings


def active_half_label(settings: "SystemSettings") -> Optional[str]:
    """Canonical HALF label ("H1 FY26-27") for the org's active cycle — the half
    new annual goals are stamped into, and the one the "allow new goals" grant
    is keyed to. None when the active cycle can't be parsed."""
    return _half_label_of_cycle_string(
        goal_cycle_name_for_active(settings.active_cycle_name)
    )


def get_active_override(
    db: "Session",
    org_id: int,
    user_id: int,
    period_label: Optional[str],
) -> Optional[GoalAccessOverride]:
    """The non-revoked grant row for (org, user, half), or None when the label
    is missing or no active grant exists."""
    if not period_label:
        return None
    return (
        db.query(GoalAccessOverride)
        .filter(
            GoalAccessOverride.org_id == org_id,
            GoalAccessOverride.user_id == user_id,
            GoalAccessOverride.period_label == period_label,
            GoalAccessOverride.revoked_at.is_(None),
        )
        .first()
    )


def user_has_goal_grant(
    db: "Session",
    org_id: int,
    user_id: int,
    half_label: Optional[str],
    action: str,
) -> bool:
    """True when the employee holds an active grant covering `action`
    ("create" | "edit") for `half_label`. Used by the goal gate as the
    fallback when the org-wide half is closed."""
    override = get_active_override(db, org_id, user_id, half_label)
    if override is None:
        return False
    return override.allow_create if action == "create" else override.allow_edit
