"""
designation_scoping — make designations department-scoped (and the reverse).

Historically `designations` were a flat, org-wide list: one "Consultant" row
shared by every department. To support department-scoped roles (select a
department → see only its roles; a role implies its department) each role must
belong to exactly one department.

`scope_designations_for_org` rewrites an org's designations so each role belongs
to one department, deriving the real (department, role) pairs from how the data
is actually used — every user's (department, designation) and every
role_expectation's (department, designation) — then repoints those rows at the
new per-department designation and drops the now-orphaned global rows.

Written with Core `text()` (not the ORM models) so it can be called from both
the Alembic migration (prod data) and the seed (fresh data) without drifting as
the models evolve, and stays dialect-agnostic (Postgres + SQLite).
"""
from __future__ import annotations

from sqlalchemy import text


def scope_designations_for_org(conn, org_id: int) -> None:
    """Scope `org_id`'s designations to the departments that actually use them.

    Idempotent: re-running on already-scoped data is a no-op (rows resolve to
    the same scoped designation and there are no orphaned globals left to drop).
    """
    # Every (department, designation) pair referenced by a user or a
    # role-expectation, joined to the designation's name/level/is_active.
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT ref.dept_id AS dept_id,
                            d.id        AS old_id,
                            d.name      AS name,
                            d.level     AS level,
                            d.is_active AS is_active
            FROM (
                SELECT department_id AS dept_id, designation_id AS desig_id
                FROM users
                WHERE org_id = :org
                  AND department_id IS NOT NULL
                  AND designation_id IS NOT NULL
                UNION
                SELECT department_id AS dept_id, designation_id AS desig_id
                FROM role_expectations
                WHERE org_id = :org
                  AND department_id IS NOT NULL
                  AND designation_id IS NOT NULL
            ) ref
            JOIN designations d ON d.id = ref.desig_id
            """
        ),
        {"org": org_id},
    ).fetchall()

    if not rows:
        return

    # get-or-create one scoped designation per (department, name).
    scoped: dict[tuple[int, str], int] = {}
    for r in rows:
        key = (r.dept_id, r.name)
        if key in scoped:
            continue
        existing = conn.execute(
            text(
                "SELECT id FROM designations "
                "WHERE org_id = :org AND department_id = :dept AND name = :name"
            ),
            {"org": org_id, "dept": r.dept_id, "name": r.name},
        ).first()
        if existing:
            scoped[key] = existing.id
            continue
        conn.execute(
            text(
                "INSERT INTO designations (org_id, department_id, name, level, is_active) "
                "VALUES (:org, :dept, :name, :level, :is_active)"
            ),
            {
                "org": org_id,
                "dept": r.dept_id,
                "name": r.name,
                "level": r.level,
                "is_active": r.is_active,
            },
        )
        scoped[key] = conn.execute(
            text(
                "SELECT id FROM designations "
                "WHERE org_id = :org AND department_id = :dept AND name = :name"
            ),
            {"org": org_id, "dept": r.dept_id, "name": r.name},
        ).scalar()

    # Repoint users + role_expectations at the scoped row for their (dept, name).
    for r in rows:
        scoped_id = scoped[(r.dept_id, r.name)]
        if scoped_id == r.old_id:
            continue  # already pointing at its scoped row
        for table in ("users", "role_expectations"):
            conn.execute(
                text(
                    f"UPDATE {table} SET designation_id = :sid "
                    "WHERE org_id = :org AND department_id = :dept "
                    "AND designation_id = :old"
                ),
                {"sid": scoped_id, "org": org_id, "dept": r.dept_id, "old": r.old_id},
            )

    # Drop global (NULL-department) rows nothing references any more. Rows still
    # referenced — e.g. by a user who has no department — are left as legacy.
    conn.execute(
        text(
            """
            DELETE FROM designations
            WHERE org_id = :org
              AND department_id IS NULL
              AND id NOT IN (
                  SELECT designation_id FROM users
                  WHERE org_id = :org AND designation_id IS NOT NULL
              )
              AND id NOT IN (
                  SELECT designation_id FROM role_expectations
                  WHERE org_id = :org AND designation_id IS NOT NULL
              )
            """
        ),
        {"org": org_id},
    )


def unscope_designations_for_org(conn, org_id: int) -> None:
    """Inverse of `scope_designations_for_org` — collapse per-department roles
    back to one global row per (org, name). Used by the migration downgrade so
    the old (org, name) uniqueness can be restored without violations.

    For each repeated name keep the lowest-id row, repoint users +
    role_expectations onto it, delete the rest, then null out department_id.
    """
    names = [
        row[0]
        for row in conn.execute(
            text("SELECT DISTINCT name FROM designations WHERE org_id = :org"),
            {"org": org_id},
        ).fetchall()
    ]
    for name in names:
        ids = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT id FROM designations "
                    "WHERE org_id = :org AND name = :name ORDER BY id"
                ),
                {"org": org_id, "name": name},
            ).fetchall()
        ]
        if len(ids) <= 1:
            continue
        survivor, *dupes = ids
        for dup in dupes:
            for table in ("users", "role_expectations"):
                conn.execute(
                    text(
                        f"UPDATE {table} SET designation_id = :s "
                        "WHERE org_id = :org AND designation_id = :d"
                    ),
                    {"s": survivor, "org": org_id, "d": dup},
                )
            conn.execute(
                text("DELETE FROM designations WHERE id = :d"), {"d": dup}
            )
    conn.execute(
        text("UPDATE designations SET department_id = NULL WHERE org_id = :org"),
        {"org": org_id},
    )
