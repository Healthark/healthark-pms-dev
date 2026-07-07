"""add competencies framework (additive foundation)

Introduces the department/level-aware competency framework WITHOUT changing any
existing read/write flow:

  1. New ``competencies`` table. Rows with department_id + level NULL are the
     ORG DEFAULT set (the current 7–8 competencies), seeded here per org.
  2. Additive nullable JSON columns: ``role_expectations.expectations`` and
     ``project_reviews.comments`` (keyed by competency id).
  3. Backfill — the existing ``exp_*`` / ``comment_*`` values are copied into
     the JSON columns keyed by the seeded default competency ids, so no data is
     lost and the follow-up cutover can read the JSON directly.

The old ``exp_*`` / ``comment_*`` columns are left in place and still drive
every live surface; they are dropped only after the code cutover is verified.

Revision ID: d1f7a2c9e4b6
Revises: c4a1e7f209d8
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy import column, table

from alembic import op

revision: str = "d1f7a2c9e4b6"
down_revision: Union[str, None] = "c4a1e7f209d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── The current framework, seeded as the org DEFAULT set ─────────────────
# (key, label, is_reviewable). display_order = position (1-based). Order and
# labels mirror the fixed exp_* / comment_* framework exactly. firm_growth is
# expectation-only (no comment column today) → is_reviewable=False.
_DEFAULT_COMPETENCIES = [
    ("task_execution",      "Task Execution & Problem Solving",               True),
    ("ownership",           "Ownership & Accountability",                     True),
    ("project_management",  "Project Management and Risk Mitigation",         True),
    ("client_deliverables", "Building Client-Ready Deliverables",             True),
    ("communication",       "Communication & Client/Stakeholder Management",  True),
    ("mentoring",           "Mentoring and Team Development",                  True),
    ("firm_growth",         "Firm Growth",                                    False),
    ("competency_skills",   "Competency and Skills",                          True),
]

# key -> source column on role_expectations (all 8).
_EXP_COLS = [
    ("task_execution",      "exp_task_execution"),
    ("ownership",           "exp_ownership"),
    ("project_management",  "exp_project_management"),
    ("client_deliverables", "exp_client_deliverables"),
    ("communication",       "exp_communication"),
    ("mentoring",           "exp_mentoring"),
    ("firm_growth",         "exp_firm_growth"),
    ("competency_skills",   "exp_competency_skills"),
]

# key -> source column on project_reviews (7 reviewable; firm_growth excluded —
# it has no comment column).
_COMMENT_COLS = [
    ("task_execution",      "comment_task_execution"),
    ("ownership",           "comment_ownership"),
    ("project_management",  "comment_project_management"),
    ("client_deliverables", "comment_client_deliverables"),
    ("communication",       "comment_communication"),
    ("mentoring",           "comment_mentoring"),
    ("competency_skills",   "comment_competency_skills"),
]


def _seed_and_backfill(bind) -> None:
    """Seed the default competency set per org and backfill the JSON columns.

    Runs against the live DB (Postgres). Uses SQLAlchemy table constructs so
    dict -> JSON binding is handled by the dialect rather than hand-rolled.
    """
    competencies = table(
        "competencies",
        column("id", sa.Integer),
        column("org_id", sa.Integer),
        column("department_id", sa.Integer),
        column("level", sa.Integer),
        column("key", sa.String),
        column("label", sa.String),
        column("display_order", sa.Integer),
        column("is_reviewable", sa.Boolean),
        column("is_deleted", sa.Boolean),
    )

    role_expectations = table(
        "role_expectations",
        column("id", sa.Integer),
        column("org_id", sa.Integer),
        column("expectations", sa.JSON),
        *[column(col, sa.Text) for _key, col in _EXP_COLS],
    )

    project_reviews = table(
        "project_reviews",
        column("id", sa.Integer),
        column("org_id", sa.Integer),
        column("comments", sa.JSON),
        *[column(col, sa.Text) for _key, col in _COMMENT_COLS],
    )

    org_ids = [r[0] for r in bind.execute(sa.text("SELECT id FROM organizations")).fetchall()]

    for org_id in org_ids:
        # 1. Seed the 8 default competencies for this org, capturing new ids.
        comp_id_by_key: dict[str, int] = {}
        for order, (key, label, reviewable) in enumerate(_DEFAULT_COMPETENCIES, start=1):
            new_id = bind.execute(
                competencies.insert()
                .returning(competencies.c.id)
                .values(
                    org_id=org_id,
                    department_id=None,
                    level=None,
                    key=key,
                    label=label,
                    display_order=order,
                    is_reviewable=reviewable,
                    is_deleted=False,
                )
            ).scalar()
            comp_id_by_key[key] = new_id

        # 2. Backfill role_expectations.expectations for this org.
        exp_select_cols = [role_expectations.c.id] + [
            role_expectations.c[col] for _key, col in _EXP_COLS
        ]
        for row in bind.execute(
            sa.select(*exp_select_cols).where(role_expectations.c.org_id == org_id)
        ).fetchall():
            rid = row[0]
            payload = {
                str(comp_id_by_key[key]): row[i + 1]
                for i, (key, _col) in enumerate(_EXP_COLS)
            }
            bind.execute(
                role_expectations.update()
                .where(role_expectations.c.id == rid)
                .values(expectations=payload)
            )

        # 3. Backfill project_reviews.comments for this org (7 reviewable).
        cmt_select_cols = [project_reviews.c.id] + [
            project_reviews.c[col] for _key, col in _COMMENT_COLS
        ]
        for row in bind.execute(
            sa.select(*cmt_select_cols).where(project_reviews.c.org_id == org_id)
        ).fetchall():
            rid = row[0]
            payload = {
                str(comp_id_by_key[key]): row[i + 1]
                for i, (key, _col) in enumerate(_COMMENT_COLS)
            }
            bind.execute(
                project_reviews.update()
                .where(project_reviews.c.id == rid)
                .values(comments=payload)
            )


def upgrade() -> None:
    op.create_table(
        "competencies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_reviewable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_competencies_id", "competencies", ["id"])
    op.create_index("ix_competencies_department_id", "competencies", ["department_id"])
    op.create_index(
        "ix_competency_org_dept_level",
        "competencies",
        ["org_id", "department_id", "level"],
    )

    op.add_column("role_expectations", sa.Column("expectations", sa.JSON(), nullable=True))
    op.add_column("project_reviews", sa.Column("comments", sa.JSON(), nullable=True))

    _seed_and_backfill(op.get_bind())


def downgrade() -> None:
    op.drop_column("project_reviews", "comments")
    op.drop_column("role_expectations", "expectations")
    op.drop_index("ix_competency_org_dept_level", table_name="competencies")
    op.drop_index("ix_competencies_department_id", table_name="competencies")
    op.drop_index("ix_competencies_id", table_name="competencies")
    op.drop_table("competencies")
