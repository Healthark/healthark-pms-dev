# 35 — Soft-delete project team members (audit + restore)

## Context

Removing a member from a project hard-deleted the `project_assignments` row, so
the team-membership record was lost — no trail of who was on the project, their
role, or who removed them when. This adds a **soft delete**: the row is kept,
stamped with who/when, shown greyed at the bottom of the team list with "… was
removed by … on …", and **re-addable**. A removed member drops out of every
active-team path app-wide; past project-review rows (keyed on user/project/
cycle, not the assignment) are unaffected.

## Data model + migration
- `ProjectAssignment` gains `is_deleted` (`default=False`, `server_default
  "false"`), `removed_at`, `removed_by_id` (FK users) + `removed_by`
  relationship — `backend/app/models/project_models.py`.
- Migration `c3f1a8d29b4e` (chained from `f4d2a9c7b318`), `batch_alter_table`
  for Postgres/SQLite portability; verified upgrade→downgrade→upgrade on the dev
  DB. The unique `(org, project, user)` index means re-add **restores** the
  existing row rather than inserting a duplicate.

## Backend
- `AssignmentResponse` gains `is_deleted` / `removed_at` / `removed_by_name`.
- `project_routes.py`: `remove_assignment` now soft-deletes (stamps
  `is_deleted/removed_at/removed_by_id`; still 400s on the PM and on a
  double-remove); new `POST /projects/assignments/{id}/restore`; `add_assignment`
  restores a soft-deleted row on re-add; `get_project_detail` returns all rows
  ordered active-first/removed-last; every current-team query
  (`_resolve_project_pm`, list counts/PM, update + complete) filters
  `is_deleted == False`.
- App-wide active exclusion: `notifications.project_team_users`,
  `project_review_routes` eligibility/role gates, `mentee_routes` active-project
  queries, and `feedback_360_service` "worked-with" all filter active rows.
  `exporters` **keep** removed rows on the Project Assignments sheet (new
  Status / Removed By / Removed On columns) while the project member count
  reflects active only.

## Frontend
- `project.service.ts`: `AssignmentResponse` fields + `restoreAssignment()`.
- `ProjectModal.tsx`: active vs removed split — current-team derivations use
  active only (so a removed member frees their slot and is re-addable); removed
  members render greyed at the bottom with the audit line + a **Re-add** button;
  remove/restore refetch the detail.

## Tests
- `backend/tests/test_project_soft_delete.py` (7): soft-remove audit; removed
  excluded from team + PM; PM-protected; double-remove rejected; re-add restores
  the same row; restore endpoint; detail orders removed last with audit.
- `frontend/.../ProjectModal.test.tsx` (+2): removed members render greyed with
  audit + Re-add (refetches); a removed member is selectable again.

## Verification
- Backend `pytest -q` → 83 passed; new test ruff-clean; migration round-trips on
  the dev (Postgres) DB.
- Frontend `tsc` clean; eslint 0; `vitest` ProjectModal 4 passed.
