"""
Tests for the formal, snapshot-style notification email rendering (PR B).

These exercise the pure template builders directly — NOT send_notification_email,
which would hand a real message to the SMTP server (configured in this env). The
builders return strings, so we assert structure: subject/heading, greeting,
intro, every snapshot label+value, the footer, HTML-escaping, and the
project-team "+N others" truncation. Back-compat: with no formal fields the
template renders the original generic shape.
"""
from __future__ import annotations

from app.api.routes.project_routes import (
    _format_date,
    _format_team,
    _format_timeline,
)
from app.services.send_email import (
    _DEFAULT_THEME,
    _notification_html,
    _notification_text,
)

DETAILS = [
    ("Project Manager", "Dana Lee"),
    ("Timeline", "Mar 05, 2026 – Sep 30, 2026"),
]


def _html(**kw):
    return _notification_html(
        "You have been added to: Apollo",
        "in-app body",
        "https://app.example.com/project-reviews",
        "View project",
        _DEFAULT_THEME,
        **kw,
    )


def _text(**kw):
    return _notification_text(
        "You have been added to: Apollo",
        "in-app body",
        "https://app.example.com/project-reviews",
        "Healthark PMS",
        **kw,
    )


# ── Formal template content ──────────────────────────────────────────


def test_html_renders_greeting_intro_snapshot_and_footer():
    html = _html(
        recipient_name="Alice Smith",
        intro="You have been added to the project \"Apollo\" in Healthark PMS.",
        details=DETAILS,
        snapshot_title="Project Snapshot",
    )
    assert "You have been added to: Apollo" in html  # heading
    assert "Hi Alice Smith," in html  # greeting
    assert "added to the project" in html  # intro
    assert "Project Snapshot" in html  # snapshot label
    for label, value in DETAILS:
        assert label in html
        assert value in html
    assert "View project" in html  # CTA
    assert "This is an automated message" in html  # footer
    # The in-app body is replaced by the intro in the formal path.
    assert "in-app body" not in html


def test_text_fallback_mirrors_the_snapshot():
    text = _text(
        recipient_name="Alice Smith",
        intro="You have been added to the project \"Apollo\".",
        details=DETAILS,
        snapshot_title="Project Snapshot",
    )
    assert "Hi Alice Smith," in text
    assert "Project Snapshot:" in text
    assert "Project Manager: Dana Lee" in text
    assert "Timeline: Mar 05, 2026 – Sep 30, 2026" in text


def test_html_escapes_injection_in_recipient_name():
    html = _html(recipient_name="Bobby <img onerror=alert(1)>", details=DETAILS)
    assert "<img onerror" not in html  # neutralized
    assert "&lt;img" in html


def test_generic_render_is_backcompat_without_formal_fields():
    # No recipient_name / intro / details → original look: body paragraph, no
    # greeting, no snapshot block.
    html = _html()
    assert "Hi " not in html
    assert "Snapshot" not in html
    assert "in-app body" in html  # falls back to body when no intro


# ── Project helpers ──────────────────────────────────────────────────


def test_format_team_truncates_after_four():
    names = ["A", "B", "C", "D", "E", "F"]
    assert _format_team(names) == "A, B, C, D + 2 others"


def test_format_team_no_truncation_at_or_below_limit():
    assert _format_team(["A", "B", "C", "D"]) == "A, B, C, D"


def test_format_date_and_timeline_handle_none():
    from datetime import date

    assert _format_date(None) == "—"
    assert _format_date(date(2026, 3, 5)) == "Mar 05, 2026"
    assert _format_timeline(date(2026, 3, 5), None) == "Mar 05, 2026 – —"
