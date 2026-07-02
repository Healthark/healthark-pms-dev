"""
Mentor visibility of a mentee's *annual self-review* while it is a draft.

The mentee's self-review is stored directly in
`self_overall_review` / `self_performance_rating` with the review still in
`draft` status (there are no separate self-draft columns — unlike the mentor
side). While the mentee is still drafting, that rating/text must stay private:
the mentor's `/mentees/{id}/reviews` feed (which drives both the Reviews tab
and the Annual Summary tab) still returns the row — so the mentor can see the
"is drafting" state and the FY exists in the picker — but the self-review
content is stripped until the mentee submits (status → pending_mentor).

`get_mentee_reviews` is a plain function, so we call it directly against an
in-memory SQLite session with fabricated rows.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.mentee_routes import get_mentee_reviews
from app.core.database import Base
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.organization_models import Organization
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User

ACTIVE_CYCLE = "FY26-27"
SELF_RATING = 2
SELF_TEXT = "My own take on the year."


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


def _user(db, org_id, *, mentor_id=None):
    _n["i"] += 1
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role="Staff",
        password_hash="x",
        is_deleted=False,
        mentor_id=mentor_id,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db):
    """Org + active cycle + a mentor and a mentee who reports to them."""
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))
    mentor = _user(db, org.id)
    mentee = _user(db, org.id, mentor_id=mentor.id)
    db.commit()
    return org, mentor, mentee


def _add_review(db, org, mentee, mentor, status):
    r = AnnualReview(
        org_id=org.id,
        user_id=mentee.id,
        mentor_id=mentor.id,
        cycle_name=ACTIVE_CYCLE,
        status=status,
        self_overall_review=SELF_TEXT,
        self_performance_rating=SELF_RATING,
    )
    db.add(r)
    db.commit()
    return r


def _only(rows):
    assert len(rows) == 1, f"expected exactly one review row, got {len(rows)}"
    return rows[0]


def test_mentor_cannot_see_draft_self_rating(db):
    """A mentee's unsubmitted draft self-review stays hidden from the mentor."""
    org, mentor, mentee = _scenario(db)
    _add_review(db, org, mentee, mentor, ReviewStatus.DRAFT.value)

    row = _only(get_mentee_reviews(mentee.id, db, mentor))

    # Row is still present (so the mentor sees "is drafting" + the FY exists)…
    assert row.status == ReviewStatus.DRAFT.value
    assert row.cycle_name == ACTIVE_CYCLE
    # …but the draft self-review content is stripped.
    assert row.self_performance_rating is None
    assert row.self_overall_review is None


def test_mentor_sees_self_review_once_submitted(db):
    """Once the mentee submits (status → pending_mentor), self content shows."""
    org, mentor, mentee = _scenario(db)
    _add_review(db, org, mentee, mentor, ReviewStatus.PENDING_MENTOR.value)

    row = _only(get_mentee_reviews(mentee.id, db, mentor))

    assert row.status == ReviewStatus.PENDING_MENTOR.value
    assert row.self_performance_rating == SELF_RATING
    assert row.self_overall_review == SELF_TEXT


def test_draft_self_review_appears_only_after_submit(db):
    """End-to-end of the reported bug: hidden while draft, visible after submit."""
    org, mentor, mentee = _scenario(db)
    review = _add_review(db, org, mentee, mentor, ReviewStatus.DRAFT.value)

    # Draft → mentor sees no self rating/text.
    row = _only(get_mentee_reviews(mentee.id, db, mentor))
    assert row.self_performance_rating is None
    assert row.self_overall_review is None

    # Mentee submits.
    review.status = ReviewStatus.PENDING_MENTOR.value
    db.commit()

    # Submitted → the same self-review is now visible to the mentor.
    row = _only(get_mentee_reviews(mentee.id, db, mentor))
    assert row.self_performance_rating == SELF_RATING
    assert row.self_overall_review == SELF_TEXT


def test_stripping_does_not_persist_to_db(db):
    """Nulling is response-only — the mentee's draft is untouched in storage."""
    org, mentor, mentee = _scenario(db)
    review = _add_review(db, org, mentee, mentor, ReviewStatus.DRAFT.value)

    get_mentee_reviews(mentee.id, db, mentor)

    db.refresh(review)
    assert review.self_performance_rating == SELF_RATING
    assert review.self_overall_review == SELF_TEXT
