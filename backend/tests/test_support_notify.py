"""
Support ticket notification content + recipients.

Pure-function tests (no SMTP): the recipient list parses from config, and
the built email carries the issue in the defined format (subject names the
page; body carries description + remarks; the details table has the expected
labelled rows, with a dash for a missing tab/email).
"""
from __future__ import annotations

from app.core.config import settings
from app.services.support_notify import (
    build_ticket_notification,
    support_notify_recipients,
)


def test_default_recipients_are_the_configured_inboxes():
    recips = support_notify_recipients()
    assert recips == [
        "amol@healthark.ai",
        "devanshi@healthark.ai",
        "trapti@healthark.ai",
        "aakash.p@healthark.ai",
    ]


def test_recipients_parse_and_trim(monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_NOTIFY_EMAILS", " a@x.com , b@x.com ,")
    assert support_notify_recipients() == ["a@x.com", "b@x.com"]


def test_recipients_empty_when_unset(monkeypatch):
    monkeypatch.setattr(settings, "SUPPORT_NOTIFY_EMAILS", "   ")
    assert support_notify_recipients() == []


def test_build_notification_full():
    subject, body, details = build_ticket_notification(
        submitter_name="Riya Sharma",
        submitter_email="riya@corp.com",
        pms_page="Annual Goals",
        tab="Team Goals",
        description="The approve button does nothing.",
        remarks="Chrome 126.",
        photo_count=2,
        submitted_display="07 Jul 2026, 09:15 UTC",
    )
    assert subject == "New Support Issue — Annual Goals"
    # Body carries the free-text with labels.
    assert "The approve button does nothing." in body
    assert "Remarks:" in body and "Chrome 126." in body
    # Details table — labelled snapshot rows.
    d = dict(details)
    assert d["Reporter"] == "Riya Sharma"
    assert d["Reporter email"] == "riya@corp.com"
    assert d["PMS Page"] == "Annual Goals"
    assert d["Tab"] == "Team Goals"
    assert d["Photos attached"] == "2"
    assert d["Submitted"] == "07 Jul 2026, 09:15 UTC"


def test_build_notification_omits_remarks_and_dashes_missing_fields():
    subject, body, details = build_ticket_notification(
        submitter_name="Sam",
        submitter_email=None,
        pms_page="Dashboard",
        tab=None,
        description="Numbers look wrong.",
        remarks=None,
        photo_count=0,
        submitted_display="07 Jul 2026, 09:15 UTC",
    )
    assert "Remarks:" not in body
    d = dict(details)
    assert d["Tab"] == "—"
    assert d["Reporter email"] == "—"
    assert d["Photos attached"] == "0"
