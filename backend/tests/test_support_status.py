"""
Support ticket status schema.

Pure-schema tests: the status-update payload accepts only the three
lifecycle values, and the row/detail schemas default to "pending".
"""
from __future__ import annotations

from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.support_schemas import (
    SupportTicketRow,
    SupportTicketStatusUpdate,
)

_WHEN = datetime(2026, 7, 7, 9, 0, 0)


@pytest.mark.parametrize("value", ["pending", "in_progress", "completed"])
def test_status_update_accepts_valid(value):
    assert SupportTicketStatusUpdate(status=value).status == value


@pytest.mark.parametrize(
    "bad", ["done", "open", "", "Pending", "in-progress", None, 1]
)
def test_status_update_rejects_invalid(bad):
    with pytest.raises(ValidationError):
        SupportTicketStatusUpdate(status=bad)


def test_row_status_defaults_to_pending():
    row = SupportTicketRow(
        id=1,
        submitter_name="Riya",
        pms_page="Dashboard",
        description="d",
        created_at=_WHEN,
    )
    assert row.status == "pending"
