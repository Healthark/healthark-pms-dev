"""
Route-level tests for the PR 5 admin / announcement notification hooks.

Same harness as test_goal_notifications.py: the admin endpoints are plain
functions, so we call them directly with an in-memory SQLite session,
fabricated User objects, and a real BackgroundTasks instance. SMTP is
unconfigured in the test env, so the email branch is a no-op — we assert the
in-app Notification rows the hooks write (and the `emailed` flag stays False).

Covers:
  * update_user            → mentor-reassigned (personal, in-app + email)
  * update_year_settings   → settings-toggle announcements (all staff, in-app)
  * admin_notify           → POST /admin/notify broadcast (announcement)
"""
from __future__ import annotations

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.admin_routes import (
    admin_notify,
    update_user,
    update_year_settings,
)
from app.core.database import Base
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.admin_schemas import (
    AdminNotifyRequest,
    UserUpdate,
    YearSettingsUpdate,
)
from app.services.send_email import is_smtp_configured


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


_n = {"i": 0}


def _user(db, org_id, *, role="Staff", mentor_id=None, is_deleted=False):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role=role,
        password_hash="x",
        is_deleted=is_deleted,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _org(db, **flag_overrides):
    """Org + a SystemSettings row with the four access flags explicitly set
    (default all-False) so the year-override seed baseline is deterministic."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    flags = {
        "annual_reviews_enabled": False,
        "annual_review_final_rating_visible": False,
        "annual_goals_edit_enabled": False,
        "project_ratings_visible": False,
    }
    flags.update(flag_overrides)
    db.add(
        SystemSettings(
            org_id=org.id,
            active_cycle_name="H1 FY26-27",
            cycle_type="half_yearly",
            fiscal_start_month=4,
            **flags,
        )
    )
    db.flush()
    return org


# ── Mentor reassignment (update_user) ────────────────────────────────


def test_mentor_reassign_notifies_mentee(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    old_mentor = _user(db, org.id, role="Staff")
    new_mentor = _user(db, org.id, role="Staff")
    mentee = _user(db, org.id, role="Staff", mentor_id=old_mentor.id)
    db.commit()

    update_user(
        mentee.id,
        UserUpdate(mentor_id=new_mentor.id),
        db,
        admin,
        BackgroundTasks(),
    )

    n = db.query(Notification).filter(Notification.type == "mentor_reassigned").one()
    assert n.recipient_id == mentee.id
    assert n.category == "personal"
    assert n.link == "/profile"
    assert n.actor_id == admin.id
    assert new_mentor.full_name in n.body


def test_mentor_unchanged_does_not_notify(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    mentor = _user(db, org.id, role="Staff")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    db.commit()

    # Re-set the same mentor + change an unrelated field — no reassignment.
    update_user(
        mentee.id,
        UserUpdate(mentor_id=mentor.id, full_name="Renamed"),
        db,
        admin,
        BackgroundTasks(),
    )

    assert db.query(Notification).count() == 0


def test_mentor_unassigned_does_not_notify(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    mentor = _user(db, org.id, role="Staff")
    mentee = _user(db, org.id, role="Staff", mentor_id=mentor.id)
    db.commit()

    # Clearing the mentor (→ None) is not a reassignment to a new mentor.
    update_user(
        mentee.id,
        UserUpdate(mentor_id=None),
        db,
        admin,
        BackgroundTasks(),
    )

    assert db.query(Notification).count() == 0


def test_update_user_requires_admin(db):
    org = _org(db)
    staff = _user(db, org.id, role="Staff")
    mentor = _user(db, org.id, role="Staff")
    mentee = _user(db, org.id, role="Staff")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        update_user(
            mentee.id,
            UserUpdate(mentor_id=mentor.id),
            db,
            staff,
            BackgroundTasks(),
        )
    assert exc.value.status_code == 403
    assert db.query(Notification).count() == 0


# ── Settings-toggle announcements (update_year_settings) ──────────────


def test_toggle_flip_announces_to_all_active_users(db):
    org = _org(db)  # all four flags start False
    admin = _user(db, org.id, role="Admin")
    _user(db, org.id, role="Staff")
    _user(db, org.id, role="Staff")
    db.commit()
    active_count = db.query(User).filter(User.is_deleted == False).count()  # noqa: E712

    update_year_settings(
        "FY26-27",
        YearSettingsUpdate(
            annual_reviews_enabled=True,
            annual_review_final_rating_visible=False,
            annual_goals_edit_enabled=False,
            project_ratings_visible=False,
        ),
        db,
        admin,
    )

    rows = db.query(Notification).filter(Notification.type == "settings_toggle").all()
    assert len(rows) == active_count  # one announcement per active user
    n = rows[0]
    assert n.category == "announcement"
    assert n.title == "Annual reviews opened"
    assert "FY26-27" in n.body
    assert n.link == "/annual-reviews"
    assert n.actor_id == admin.id
    # in-app only — recipients span every active user
    assert {r.recipient_id for r in rows} == {
        u.id for u in db.query(User).filter(User.is_deleted == False)  # noqa: E712
    }


def test_two_toggles_flip_two_distinct_announcements(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    db.commit()

    update_year_settings(
        "FY26-27",
        YearSettingsUpdate(
            annual_reviews_enabled=True,
            annual_review_final_rating_visible=False,
            annual_goals_edit_enabled=True,
            project_ratings_visible=False,
        ),
        db,
        admin,
    )

    rows = db.query(Notification).filter(Notification.type == "settings_toggle").all()
    titles = {r.title for r in rows}
    assert titles == {"Annual reviews opened", "Goal submissions opened"}


def test_no_toggle_flip_emits_no_announcement(db):
    org = _org(db)  # baseline all False
    admin = _user(db, org.id, role="Admin")
    db.commit()

    update_year_settings(
        "FY26-27",
        YearSettingsUpdate(
            annual_reviews_enabled=False,
            annual_review_final_rating_visible=False,
            annual_goals_edit_enabled=False,
            project_ratings_visible=False,
        ),
        db,
        admin,
    )

    assert db.query(Notification).count() == 0


# ── Admin broadcast (admin_notify) ────────────────────────────────────


def test_admin_notify_all_audience(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    _user(db, org.id, role="Staff")
    _user(db, org.id, role="Staff")
    db.commit()
    active_count = db.query(User).filter(User.is_deleted == False).count()  # noqa: E712

    result = admin_notify(
        AdminNotifyRequest(
            subject="Heads up", body="Please read.", audience="all", send_email=False
        ),
        db,
        admin,
        BackgroundTasks(),
    )

    assert result.recipients == active_count
    assert result.emailed is False
    rows = db.query(Notification).filter(Notification.type == "admin_broadcast").all()
    assert len(rows) == active_count
    assert rows[0].category == "announcement"
    assert rows[0].title == "Heads up"
    assert rows[0].body == "Please read."
    assert rows[0].actor_id == admin.id


def test_admin_notify_mentors_audience(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    mentor = _user(db, org.id, role="Staff")
    _user(db, org.id, role="Staff", mentor_id=mentor.id)  # mentee → makes mentor a mentor
    _user(db, org.id, role="Staff")  # loner — mentors nobody
    db.commit()

    result = admin_notify(
        AdminNotifyRequest(
            subject="For mentors", body="Review goals.", audience="mentors", send_email=False
        ),
        db,
        admin,
        BackgroundTasks(),
    )

    assert result.recipients == 1
    rows = db.query(Notification).filter(Notification.type == "admin_broadcast").all()
    assert len(rows) == 1
    assert rows[0].recipient_id == mentor.id


def test_admin_notify_email_gated_by_smtp_config(db):
    org = _org(db)
    admin = _user(db, org.id, role="Admin")
    _user(db, org.id, role="Staff")
    db.commit()
    active_count = db.query(User).filter(User.is_deleted == False).count()  # noqa: E712

    # When send_email is requested, `emailed` reflects whether SMTP is
    # configured — the email dispatch is the only thing gated. The in-app
    # rows always land regardless of SMTP state (env-independent invariant).
    result = admin_notify(
        AdminNotifyRequest(
            subject="Emailed?", body="Body.", audience="all", send_email=True
        ),
        db,
        admin,
        BackgroundTasks(),
    )

    assert result.emailed is is_smtp_configured()
    assert result.recipients == active_count
    assert (
        db.query(Notification).filter(Notification.type == "admin_broadcast").count()
        == active_count
    )


def test_admin_notify_requires_admin(db):
    org = _org(db)
    staff = _user(db, org.id, role="Staff")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        admin_notify(
            AdminNotifyRequest(subject="x", body="y", audience="all", send_email=False),
            db,
            staff,
            BackgroundTasks(),
        )
    assert exc.value.status_code == 403
    assert db.query(Notification).count() == 0
