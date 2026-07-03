"""add_multi_pm_hierarchy

Adds the columns that let a project split its team into a PM hierarchy:

    projects.multi_pm_enabled            — per-project mode flag (default False)
    project_assignments.manager_id       — the PM who evaluates THIS member
    project_assignments.secondary_evaluator_id — per-member Secondary evaluator

Data migration (backfill, inert until the evaluation flow is rewired):
    For every active, non-Primary assignment, set manager_id to that project's
    Primary (PM) user_id — so existing single-PM projects express the same
    "one PM evaluates everyone" relationship through the new per-member link.
    The Primary's own manager_id stays NULL (they're reviewed via reports_to).

Revision ID: a3f5c8e21b90
Revises: f8b3c1d05a92
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3f5c8e21b90"
down_revision: Union[str, None] = "f8b3c1d05a92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Per-project mode flag. NOT NULL with a server_default so existing
    #    rows backfill to the classic single-PM behaviour.
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "multi_pm_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    # 2. Per-member PM + Secondary evaluator links (nullable FKs to users).
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.add_column(sa.Column("manager_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("secondary_evaluator_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_project_assignments_manager_id_users",
            "users",
            ["manager_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_project_assignments_secondary_evaluator_id_users",
            "users",
            ["secondary_evaluator_id"],
            ["id"],
        )

    # 3. Backfill manager_id = the project's Primary for every active,
    #    non-Primary member. NULL evaluator_type members are included via the
    #    explicit IS NULL clause (NULL != 'Primary' is NULL, not true).
    op.get_bind().execute(
        sa.text(
            """
            UPDATE project_assignments
            SET manager_id = (
                SELECT pm.user_id
                FROM project_assignments pm
                WHERE pm.project_id = project_assignments.project_id
                  AND pm.evaluator_type = 'Primary'
                  AND pm.is_deleted = false
                ORDER BY pm.id ASC
                LIMIT 1
            )
            WHERE (evaluator_type IS NULL OR evaluator_type <> 'Primary')
              AND is_deleted = false
              AND EXISTS (
                SELECT 1
                FROM project_assignments pm
                WHERE pm.project_id = project_assignments.project_id
                  AND pm.evaluator_type = 'Primary'
                  AND pm.is_deleted = false
              )
            """
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.drop_constraint(
            "fk_project_assignments_secondary_evaluator_id_users",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_project_assignments_manager_id_users", type_="foreignkey"
        )
        batch_op.drop_column("secondary_evaluator_id")
        batch_op.drop_column("manager_id")

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("multi_pm_enabled")
