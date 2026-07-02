"""
attachment_url scheme allowlisting (stored-XSS prevention).

A goal's attachment_url is a mentee-supplied reference link that later lands in
an anchor href in the mentor's view. GoalCreate / GoalUpdate must reject any
non-http(s) scheme (javascript:, data:, …) at the API boundary while accepting
ordinary web links. These are pure schema tests — no DB or app needed.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.url_safety import validate_optional_http_url
from app.schemas.goal_schemas import GoalCreate, GoalUpdate

# Payloads that must be refused. Includes browser-normalised smuggling:
# leading whitespace and an embedded tab both collapse to `javascript:` when a
# browser follows the href.
MALICIOUS = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(document.cookie)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "//evil.example.com",          # protocol-relative — no scheme
    "not a url",                    # bare text
    "mailto:someone@example.com",
]

# Legitimate reference links a mentee would paste for their mentor.
VALID = [
    "https://drive.google.com/drive/folders/abc123",
    "http://example.com/report.pdf",
    "https://healthark.sharepoint.com/sites/x/Docs",
    "  https://drive.google.com/drive/folders/trimmed  ",  # surrounding ws ok
]


@pytest.mark.parametrize("bad", MALICIOUS)
def test_goal_create_rejects_dangerous_url(bad):
    with pytest.raises(ValidationError):
        GoalCreate(title="Q", attachment_url=bad)


@pytest.mark.parametrize("bad", MALICIOUS)
def test_goal_update_rejects_dangerous_url(bad):
    with pytest.raises(ValidationError):
        GoalUpdate(attachment_url=bad)


@pytest.mark.parametrize("good", VALID)
def test_goal_create_accepts_http_links(good):
    goal = GoalCreate(title="Q", attachment_url=good)
    assert goal.attachment_url == good.strip()


@pytest.mark.parametrize("value", [None, "", "   "])
def test_blank_attachment_url_normalises_to_none(value):
    assert GoalCreate(title="Q", attachment_url=value).attachment_url is None
    assert GoalUpdate(attachment_url=value).attachment_url is None


def test_overlong_url_rejected():
    long_url = "https://example.com/" + ("a" * 3000)
    with pytest.raises(ValidationError):
        GoalCreate(title="Q", attachment_url=long_url)


def test_helper_is_pure_and_reusable():
    # The shared helper returns the trimmed value / None and raises on bad input.
    assert validate_optional_http_url(None) is None
    assert validate_optional_http_url("  ") is None
    assert validate_optional_http_url("https://x.co/y") == "https://x.co/y"
    with pytest.raises(ValueError):
        validate_optional_http_url("javascript:alert(1)")
