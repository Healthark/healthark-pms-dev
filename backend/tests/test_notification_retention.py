"""
Tests for the 100-day notification retention (PR A).

Two enforcement paths, no scheduler:
  * lazy purge on the Topbar-summary read (get_topbar_summary) — scoped to the
    caller's org;
  * the reusable CLI helper purge_older_than — across all orgs.

Route-level harness (in-memory SQLite, direct function calls), per
test_admin_notifications.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.notification_routes import get_topbar_summary
from app.core.database import Base
from app.models.notification_models import (
    NOTIFICATION_RETENTION_DAYS,
    Notification,
    NotificationCategory,
)
from app.models.organization_models import Organization
from app.models.user_models import User
from purge_notifications import purge_older_than


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


def _user(db, org_id):
    _n["i"] += 1
    i = _n["i"]
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{i:04d}",
        full_name=f"User {i}",
        email=f"user{i}@example.com",
        role="Staff",
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _org(db):
    _n["i"] += 1
    org = Organization(name=f"Org {_n['i']}", enabled_features=[])
    db.add(org)
    db.flush()
    return org


def _notif(db, org_id, recipient_id, *, age_days: int, title="N"):
    created = datetime.now(timezone.utc) - timedelta(days=age_days)
    n = Notification(
        org_id=org_id,
        recipient_id=recipient_id,
        category=NotificationCategory.PERSONAL.value,
        type="t",
        title=title,
        body="b",
        created_at=created,
    )
    db.add(n)
    db.flush()
    return n


def test_summary_purges_only_expired_rows(db):
    org = _org(db)
    user = _user(db, org.id)
    fresh = _notif(db, org.id, user.id, age_days=99, title="fresh")
    _notif(db, org.id, user.id, age_days=101, title="expired")
    db.commit()

    summary = get_topbar_summary(db, user)

    remaining = db.query(Notification).all()
    assert len(remaining) == 1
    assert remaining[0].id == fresh.id
    # The fresh row still surfaces in the personal tab; the expired one is gone.
    assert [p.title for p in summary.personal] == ["fresh"]


def test_summary_purge_is_org_scoped(db):
    org_a = _org(db)
    org_b = _org(db)
    user_a = _user(db, org_a.id)
    user_b = _user(db, org_b.id)
    # Both orgs have an expired row; only the caller's org is purged on read.
    _notif(db, org_a.id, user_a.id, age_days=200, title="a-old")
    _notif(db, org_b.id, user_b.id, age_days=200, title="b-old")
    db.commit()

    get_topbar_summary(db, user_a)

    titles = {n.title for n in db.query(Notification).all()}
    assert titles == {"b-old"}  # org B untouched by org A's read


def test_cli_purge_spans_all_orgs(db):
    org_a = _org(db)
    org_b = _org(db)
    user_a = _user(db, org_a.id)
    user_b = _user(db, org_b.id)
    _notif(db, org_a.id, user_a.id, age_days=101, title="a-old")
    _notif(db, org_b.id, user_b.id, age_days=101, title="b-old")
    _notif(db, org_a.id, user_a.id, age_days=10, title="a-new")
    db.commit()

    cutoff = datetime.now(timezone.utc) - timedelta(days=NOTIFICATION_RETENTION_DAYS)
    deleted = purge_older_than(db, cutoff)

    assert deleted == 2  # both expired rows, regardless of org
    assert {n.title for n in db.query(Notification).all()} == {"a-new"}
