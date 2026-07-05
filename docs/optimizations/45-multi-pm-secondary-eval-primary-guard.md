# 45 — Multi-PM: assigning a Secondary Evaluator no longer trips the single-Primary guard

Follow-up fix to the multi-PM work (see [44](44-multi-pm-hierarchy-routing.md)).

## Symptom

On a **multi-PM** project (Admin → Projects → Edit, "Enable Multiple PM
support" on), editing a **top-level PM** member to assign a per-member Secondary
Evaluator failed with:

> This project already has a Primary evaluator.

Adding a **second top-level PM** to an existing multi-PM project failed the same
way with the `(Project Manager)` variant.

## Root cause

In multi-PM mode every top-level PM (a member with no `manager_id`) is
legitimately flagged `evaluator_type = "Primary"` — a project can have many.
The create route already allowed this, but the **add** and **update** assignment
routes still enforced the classic single-PM rule "one Primary per project"
unconditionally.

The frontend re-sends `evaluator_type: "Primary"` on *every* edit of a top PM
(that's how [`ProjectModal.draftToPayload`](../../frontend/src/components/admin/ProjectModal.tsx)
serialises a manager-less member). So editing a top PM merely to set their
Secondary Evaluator re-asserted `"Primary"`, the update route saw the *other*
top PM as an "existing Primary", and rejected the save.

## Fix

`backend/app/api/routes/project_routes.py` — gate the single-Primary check on
`multi_pm_enabled` in both handlers:

- `add_assignment`: skip the "already has a Primary evaluator (Project Manager)"
  lookup when `project.multi_pm_enabled`.
- `update_assignment`: look the parent project up **before** the check and skip
  the "already has a Primary evaluator" lookup when `parent.multi_pm_enabled`.
  The PM-vs-reports-to / PM-vs-secondary cross-checks that follow are preserved
  (harmless in multi-PM, where the project-level secondary is unused).

Single-PM projects are unchanged — the guard still fires there.

No frontend change: the modal was already sending the correct payload; the
backend was wrongly rejecting it. No schema/DB migration.

## Tests

`backend/tests/test_project_multi_pm.py` (4 new cases):

- `test_update_top_pm_secondary_in_multi_pm_allowed` — the reported repro:
  two top PMs, add a Secondary Evaluator to one, save succeeds.
- `test_add_second_top_pm_in_multi_pm_allowed` — a multi-PM project gains a
  second top PM after creation.
- `test_add_second_primary_blocked_in_single_pm` /
  `test_promote_second_primary_blocked_in_single_pm` — single-PM regression:
  the single-Primary guard still holds on both routes.
