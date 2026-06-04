"""
Project-review queues: correctness + bounded query count after the N+1
rewrite. The PM queue and the employee "my projects" list used to issue
per-member / per-assignment queries inside nested loops; they now batch all
lookups. We assert the SQL statement count stays flat as team size grows.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.api.routes.project_review_routes import (
    get_my_projects,
    get_pm_evaluation_queue,
)
from app.core.database import Base
from app.models.organization_models import Organization
from app.models.project_models import PROJECT_STATUS_ACTIVE, Project, ProjectAssignment
from app.models.project_review_models import ProjectReview
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User

ACTIVE_CYCLE = "H1 FY26-27"


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
    u = User(
        org_id=org_id,
        employee_code=f"EMP-{_n['i']:04d}",
        full_name=f"User {_n['i']}",
        email=f"user{_n['i']}@example.com",
        role="Staff",
        password_hash="x",
        is_deleted=False,
    )
    db.add(u)
    db.flush()
    return u


def _scenario(db, *, members: int, reviews_per_member: int):
    org = Organization(name="Org", enabled_features=[])
    db.add(org)
    db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name=ACTIVE_CYCLE))

    pm = _user(db, org.id)
    project = Project(
        org_id=org.id,
        project_code="P-1",
        name="Proj",
        status=PROJECT_STATUS_ACTIVE,
    )
    db.add(project)
    db.flush()
    db.add(ProjectAssignment(
        org_id=org.id, project_id=project.id, user_id=pm.id,
        evaluator_type="Primary", is_deleted=False,
    ))

    member_objs = []
    for _ in range(members):
        m = _user(db, org.id)
        member_objs.append(m)
        db.add(ProjectAssignment(
            org_id=org.id, project_id=project.id, user_id=m.id, is_deleted=False,
        ))
        for k in range(reviews_per_member):
            db.add(ProjectReview(
                org_id=org.id, project_id=project.id, user_id=m.id,
                reviewer_id=pm.id, cycle=f"C{k} FY26-27",
                status="reviewed", is_deleted=False,
            ))
    db.commit()
    return org, pm, project, member_objs


def _count_queries(db, fn):
    counter = {"n": 0}
    engine = db.get_bind()

    def _on_exec(conn, cursor, statement, params, context, executemany):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", _on_exec)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", _on_exec)
    return result, counter["n"]


def test_pm_queue_correctness(db):
    _org, pm, _project, _members = _scenario(db, members=5, reviews_per_member=2)
    cards = get_pm_evaluation_queue(db, pm)
    real = [c for c in cards if c.review_id is not None]
    assert len(real) == 10  # 5 members × 2 reviews


def test_pm_queue_query_count_is_flat(db):
    """The whole queue resolves in a bounded number of statements regardless
    of team size — the property the N+1 rewrite guarantees."""
    _org, pm, _project, _members = _scenario(db, members=8, reviews_per_member=2)
    _cards, n_queries = _count_queries(db, lambda: get_pm_evaluation_queue(db, pm))
    # Batched: active-cycle + pm-assignments + projects + team + users
    # + depts + desigs + reviews ≈ 8. N+1 (8 members × ~4) would be 30+.
    assert n_queries <= 12, f"expected flat query count, got {n_queries}"


def test_my_projects_correctness_and_pm_name(db):
    _org, pm, _project, members = _scenario(db, members=3, reviews_per_member=2)
    cards = get_my_projects(db, members[0])
    real = [c for c in cards if c.review_id is not None]
    assert len(real) == 2
    assert all(c.pm_name == pm.full_name for c in cards)


def test_my_projects_query_count_is_flat(db):
    _org, _pm, _project, members = _scenario(db, members=3, reviews_per_member=2)
    # Note: _visible_performance_group runs once per review (a pre-existing,
    # separate concern), so we bound generously — the rewrite removed the
    # per-assignment project/dept/PM/review fan-out, not that helper.
    _cards, n_queries = _count_queries(db, lambda: get_my_projects(db, members[0]))
    assert n_queries <= 12, f"expected bounded query count, got {n_queries}"
