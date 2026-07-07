"""drop legacy exp_* / comment_* columns

The competency framework is now the sole source of truth:

  * ``project_reviews.comments`` (JSON, {competency_id: text}) drives every
    per-competency comment read/write; the fixed ``comment_*`` columns are no
    longer written or read.
  * Expectation text lives on ``competencies.expectation`` (per department /
    level); the ``role_expectations.exp_*`` columns are no longer read.

This migration drops those 15 legacy columns. Both JSON columns
(``project_reviews.comments`` and ``role_expectations.expectations``) and the
``role_expectations`` table itself are retained. Irreversible for data — the
downgrade re-creates the columns as nullable but cannot restore their contents.

Revision ID: f2b9c7d4e6a1
Revises: a7f4e2c9b8d1
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "f2b9c7d4e6a1"
down_revision: Union[str, None] = "a7f4e2c9b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The 7 reviewable comment columns on project_reviews.
_COMMENT_COLUMNS = [
    "comment_task_execution",
    "comment_ownership",
    "comment_project_management",
    "comment_client_deliverables",
    "comment_communication",
    "comment_mentoring",
    "comment_competency_skills",
]

# The 8 expectation columns on role_expectations.
_EXP_COLUMNS = [
    "exp_task_execution",
    "exp_ownership",
    "exp_project_management",
    "exp_client_deliverables",
    "exp_communication",
    "exp_mentoring",
    "exp_firm_growth",
    "exp_competency_skills",
]


def upgrade() -> None:
    for col in _COMMENT_COLUMNS:
        op.drop_column("project_reviews", col)
    for col in _EXP_COLUMNS:
        op.drop_column("role_expectations", col)


def downgrade() -> None:
    # Schema-only restore — data in these columns was already migrated into the
    # JSON columns / competency framework and is not recoverable here.
    for col in _EXP_COLUMNS:
        op.add_column("role_expectations", sa.Column(col, sa.Text(), nullable=True))
    for col in _COMMENT_COLUMNS:
        op.add_column("project_reviews", sa.Column(col, sa.Text(), nullable=True))
