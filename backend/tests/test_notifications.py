"""
Tests for the generic notification platform (PR 1).

Two layers:
  * Pure-function tests for the link builder + email template rendering
    (escaping, CTA gating) — no DB needed.
  * Service tests against an in-memory SQLite session — exercise
    create_notification / broadcast_notification and the recipient resolvers.
    (The legacy suite was pure-function only; a throwaway in-memory engine is
    a contained way to cover the DB-bound write-path without standing up the
    full app/auth stack.)
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.core.database import Base
from app.models.notification_models import Notification, NotificationCategory
from app.models.organization_models import Organization
from app.models.user_models import User
from app.services import notifications as notif_svc
from app.services.send_email import (
    _notification_html,
    _notification_text,
    _resolve_theme,
)

# ── Pure functions ───────────────────────────────────────────────────


def test_abs_link_prefixes_relative_paths():
    out = notif_svc._abs_link("/annual-goals?tab=team")
    assert out is not None
    assert out.startswith("http")  # APP_BASE_URL is absolute
    assert out.endswith("/annual-goals?tab=team")


def test_abs_link_passes_through_absolute_urls():
    assert notif_svc._abs_link("https://x.example/foo") == "https://x.example/foo"
    assert notif_svc._abs_link("http://x.example/foo") == "http://x.example/foo"


def test_abs_link_none_or_empty():
    assert notif_svc._abs_link(None) is None
    assert notif_svc._abs_link("") is None


def test_notification_category_values():
    assert NotificationCategory.PERSONAL.value == "personal"
    assert NotificationCategory.ANNOUNCEMENT.value == "announcement"


def test_notification_html_escapes_user_content():
    theme = _resolve_theme(None)
    html = _notification_html(
        title="<script>alert(1)</script>",
        body="line1\nline2",
        cta_link="https://x.example/go",
        cta_label="Open it",
        theme=theme,
    )
    # The raw tag must never reach the rendered HTML — only its escaped form.
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    # Body newlines become <br> so multi-line announcements read naturally.
    assert "line1<br>line2" in html


def test_notification_html_renders_cta_only_with_link():
    theme = _resolve_theme(None)
    with_link = _notification_html("Title", "Body", "https://x.example/go", "Open it", theme)
    assert 'href="https://x.example/go"' in with_link
    assert "Open it" in with_link

    without_link = _notification_html("Title", "Body", None, None, theme)
    # The only anchors in the template are the CTA button — none without a link.
    assert "href=" not in without_link


def test_notification_text_open_line_gated_on_link():
    with_link = _notification_text("Title", "Body", "https://x.example/go", "PMS")
    assert "Title" in with_link and "Body" in with_link
    assert "Open: https://x.example/go" in with_link

    without_link = _notification_text("Title", "Body", None, "PMS")
    assert "Open:" not in without_link


# ── Service (in-memory SQLite) ───────────────────────────────────────


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


_counter = {"n": 0}


def _make_org(db, name: str = "Org") -> Organization:
    org = Organization(name=name, enabled_features=[])
    db.add(org)
    db.flush()
    return org


def _make_user(
    db,
    org_id: int,
    *,
    role: str = "Staff",
    is_deleted: bool = False,
    mentor_id: int | None = None,
) -> User:
    _counter["n"] += 1
    i = _counter["n"]
    user = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_deleted=is_deleted,
        mentor_id=mentor_id,
    )
    db.add(user)
    db.flush()
    return user


def test_create_notification_adds_a_row(db):
    org = _make_org(db)
    user = _make_user(db, org.id)

    notif_svc.create_notification(
        db,
        org_id=org.id,
        recipient_id=user.id,
        category=NotificationCategory.PERSONAL.value,
        type="goal_approved",
        title="Goal approved",
        body="Your goal was approved.",
        link="/annual-goals?tab=my",
    )
    db.commit()

    rows = db.query(Notification).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.recipient_id == user.id
    assert row.category == "personal"
    assert row.type == "goal_approved"
    assert row.link == "/annual-goals?tab=my"
    assert row.is_read is False


def test_create_notification_email_without_background_tasks_is_safe(db):
    # email=True but no background_tasks → no SMTP attempted; row still created.
    org = _make_org(db)
    user = _make_user(db, org.id)
    notif_svc.create_notification(
        db,
        org_id=org.id,
        recipient_id=user.id,
        category="personal",
        type="t",
        title="T",
        body="B",
        email=True,
        recipient_email=user.email,
    )
    db.commit()
    assert db.query(Notification).count() == 1


def test_active_org_users_excludes_soft_deleted(db):
    org = _make_org(db)
    _make_user(db, org.id)
    _make_user(db, org.id)
    _make_user(db, org.id, is_deleted=True)
    db.commit()
    assert len(notif_svc.active_org_users(db, org.id)) == 2


def test_broadcast_creates_one_row_per_recipient(db):
    org = _make_org(db)
    _make_user(db, org.id)
    _make_user(db, org.id)
    db.commit()

    recipients = notif_svc.active_org_users(db, org.id)
    count = notif_svc.broadcast_notification(
        db,
        org_id=org.id,
        recipients=recipients,
        category=NotificationCategory.ANNOUNCEMENT.value,
        type="admin_broadcast",
        title="Heads up",
        body="All hands.",
    )
    db.commit()

    assert count == 2
    assert (
        db.query(Notification)
        .filter(Notification.category == "announcement")
        .count()
        == 2
    )


def test_mentor_users_returns_only_active_mentors(db):
    org = _make_org(db)
    mentor = _make_user(db, org.id, role="Admin")
    _make_user(db, org.id, mentor_id=mentor.id)  # a mentee
    _make_user(db, org.id)  # mentors nobody, no mentor
    db.commit()

    mentors = notif_svc.mentor_users(db, org.id)
    assert [m.id for m in mentors] == [mentor.id]


def test_mentor_users_excludes_deleted_mentor(db):
    org = _make_org(db)
    mentor = _make_user(db, org.id, is_deleted=True)
    _make_user(db, org.id, mentor_id=mentor.id)
    db.commit()
    assert notif_svc.mentor_users(db, org.id) == []
