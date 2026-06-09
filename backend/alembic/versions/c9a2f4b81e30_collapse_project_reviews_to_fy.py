"""collapse_project_reviews_to_fy

Re-scopes project reviews from the half/quarter cycle to the fiscal year.

Project reviews used to be keyed on the org's full active cycle label
("H1 FY26-27"), so a project could collect a separate review in H1 and
again in H2 — two review cycles per FY. Product intent is ONE project
review per employee per project per fiscal year (annual goals keep the
two H1/H2 self+mentor rounds; project reviews do not).

This is a pure DATA migration — no DDL. The existing
`ix_project_reviews_org_user_proj_cycle` unique index on
(org_id, user_id, project_id, cycle) already enforces uniqueness; once
`cycle` holds the bare FY label it enforces one-per-FY for free.

Per row we:
  - rewrite `cycle` "H1 FY26-27" / "Q3 FY27-28" → "FY26-27" / "FY27-28",
  - and where collapsing two cadence rows lands on the same
    (org, user, project, FY) key, keep a single survivor (prefer a
    `reviewed` row, then the most recent) and drop the rest along with
    their secondary-evaluator children.

Irreversible: H1/H2 provenance is gone after the rewrite, so downgrade is
a no-op (the column shape never changed).

Revision ID: c9a2f4b81e30
Revises: b9f3c1a7d2e8
Create Date: 2026-06-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9a2f4b81e30"
down_revision: Union[str, None] = "b9f3c1a7d2e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _fy_label(cycle: str | None) -> str | None:
    """Bare FY token from any cycle string, or None.

    "H1 FY26-27" → "FY26-27", "Q3 FY27-28" → "FY27-28", "FY26-27" → "FY26-27".
    Mirrors app.core.cycle_utils.extract_fy_label but is inlined so the
    migration carries no import dependency on the app package.
    """
    if not cycle:
        return None
    for token in cycle.upper().split():
        if token.startswith("FY"):
            return token
    return None


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            "SELECT id, org_id, user_id, project_id, cycle, status, created_at "
            "FROM project_reviews"
        )
    ).fetchall()

    # Group rows by their post-collapse key. None-FY rows are skipped — we
    # can't safely re-bucket a cycle with no FY token, so we leave them as-is.
    groups: dict[tuple, list] = {}
    for r in rows:
        fy = _fy_label(r.cycle)
        if fy is None:
            continue
        groups.setdefault((r.org_id, r.user_id, r.project_id, fy), []).append(r)

    def survivor_sort_key(r):
        # Higher sorts first: reviewed beats draft/pending, then newer
        # created_at, then higher id as a stable final tiebreak.
        reviewed = 1 if r.status == "reviewed" else 0
        created = r.created_at or ""
        return (reviewed, str(created), r.id)

    for (_org, _user, _proj, fy), grp in groups.items():
        grp_sorted = sorted(grp, key=survivor_sort_key, reverse=True)
        survivor = grp_sorted[0]
        losers = grp_sorted[1:]

        # Drop loser rows (and their secondary-evaluator children — the FK
        # is ON DELETE CASCADE, but SQLite needs it spelled out since PRAGMA
        # foreign_keys is off inside Alembic batches).
        for loser in losers:
            conn.execute(
                sa.text(
                    "DELETE FROM project_review_evaluators "
                    "WHERE project_review_id = :rid"
                ),
                {"rid": loser.id},
            )
            conn.execute(
                sa.text("DELETE FROM project_reviews WHERE id = :rid"),
                {"rid": loser.id},
            )

        # Rewrite the survivor's cycle to the bare FY (no-op if already bare).
        if survivor.cycle != fy:
            conn.execute(
                sa.text("UPDATE project_reviews SET cycle = :fy WHERE id = :rid"),
                {"fy": fy, "rid": survivor.id},
            )


def downgrade() -> None:
    # Irreversible: the H1/H2/Q* provenance was discarded on upgrade and
    # collapsed duplicate rows are gone. No DDL changed, so there is nothing
    # structural to revert.
    pass
