"""seed competency framework (per-department/level competencies + expectations)

Activates the department/level-aware competency framework:

  1. Adds ``competencies.expectation`` (Text) — the role-expectation text for a
     competency at a (department, level), stored on the competency itself (so no
     designation->level mapping is needed to seed it).
  2. Seeds the IDT / Strategy / RWE frameworks (from the committed
     app/data/competency_framework.json) per (department, level), and fills the
     org DEFAULT set's expectation with "Not defined" so departments without
     their own framework surface that under each competency.

Idempotent (get-or-create), so it's safe to re-run and coexists with seed.py.
Designation levels are set separately by HR; until then reviewees resolve to
level 1 or the org default set.

Revision ID: a7f4e2c9b8d1
Revises: f1b6d3a8c250
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.orm import Session

from alembic import op
from app.services.competency_service import seed_competency_framework

revision: str = "a7f4e2c9b8d1"
down_revision: Union[str, None] = "f1b6d3a8c250"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("competencies", sa.Column("expectation", sa.Text(), nullable=True))
    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        org_ids = [
            r[0] for r in bind.execute(sa.text("SELECT id FROM organizations")).fetchall()
        ]
        for org_id in org_ids:
            seed_competency_framework(session, org_id)
        session.flush()
    finally:
        session.close()


def downgrade() -> None:
    # Leave the seeded competency rows (valid competencies); just drop the text
    # column. Re-upgrading re-fills expectations idempotently.
    op.drop_column("competencies", "expectation")
