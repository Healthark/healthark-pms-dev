"""scope_designations_to_department

Makes designations (roles) department-scoped. Previously a designation was a
flat, org-wide row shared by every department (one "Consultant"); now each role
belongs to one department, so a title may repeat across departments but not
within one.

Steps:
  1. Add `designations.department_id` (FK, nullable) + drop the old
     (org_id, name) unique so same-named roles can coexist across departments.
  2. Data migration: scope each org's designations to the departments that
     actually use them (derived from users + role_expectations), repointing
     both — see app.services.designation_scoping.scope_designations_for_org.
  3. Add the new (org_id, department_id, name) unique.

The data step is additive/derived (it never invents pairings that weren't
already present on a user or role-expectation), so it is safe on prod data.

Revision ID: b8e3f1a07c52
Revises: a1f4c7e2d9b3
Create Date: 2026-06-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8e3f1a07c52"
down_revision: Union[str, None] = "a1f4c7e2d9b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Column + drop old (org, name) uniqueness (so scoping can create the
    #    same title under multiple departments).
    with op.batch_alter_table("designations", schema=None) as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_designations_department_id", "departments", ["department_id"], ["id"]
        )
        batch.create_index("ix_designations_department_id", ["department_id"])
        batch.drop_constraint("uix_org_designation_name", type_="unique")

    # 2. Scope each org's designations to the departments that use them.
    from app.services.designation_scoping import scope_designations_for_org

    conn = op.get_bind()
    org_ids = [
        row[0] for row in conn.execute(sa.text("SELECT id FROM organizations")).fetchall()
    ]
    for org_id in org_ids:
        scope_designations_for_org(conn, org_id)

    # 3. New uniqueness: one role per (org, department, name).
    with op.batch_alter_table("designations", schema=None) as batch:
        batch.create_unique_constraint(
            "uix_org_dept_designation_name", ["org_id", "department_id", "name"]
        )


def downgrade() -> None:
    # Collapse per-department roles back to one global row per (org, name) so the
    # old (org, name) uniqueness can be restored without violations, then drop
    # the column. This loses the department split (best-effort reverse).
    from app.services.designation_scoping import unscope_designations_for_org

    conn = op.get_bind()
    org_ids = [
        row[0] for row in conn.execute(sa.text("SELECT id FROM organizations")).fetchall()
    ]
    for org_id in org_ids:
        unscope_designations_for_org(conn, org_id)

    with op.batch_alter_table("designations", schema=None) as batch:
        batch.drop_constraint("uix_org_dept_designation_name", type_="unique")
        batch.drop_index("ix_designations_department_id")
        batch.drop_constraint("fk_designations_department_id", type_="foreignkey")
        batch.drop_column("department_id")
        batch.create_unique_constraint("uix_org_designation_name", ["org_id", "name"])
