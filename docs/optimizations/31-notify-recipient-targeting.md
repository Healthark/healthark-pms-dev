# 31 — Admin Notify recipient targeting + full-width UI

## Context

The Admin → Notify tab could only target "all users" or "mentors only", and the
form was capped at `max-w-2xl` (half the page). Admins need to send a custom
in-app / email announcement to **specific departments**, **specific designations
(job titles)**, or a combination — e.g. all Consultants in IDT, or every HR
Executive across departments. This PR adds AND-combined recipient filters with a
live count and rebuilds the tab as a professional full-width layout.

Decisions: target by **Designation + Department** (the "roles" in the request
were job-title designations, which already exist as reference data); keep
**Mentors only** as a quick toggle applied on top.

## What changed

### Backend
- **`AdminNotifyRequest`** (`admin_schemas.py`): drops `audience`; adds
  `mentors_only: bool`, `department_ids: list[int]`, `designation_ids: list[int]`
  (all optional, AND-combined; none set → everyone).
- **`notify_audience()`** (`services/notifications.py`): new resolver — active
  org users narrowed by mentors-only / department / designation. Empty list on a
  dimension means "no filter there".
- **`admin_notify`** route uses the resolver instead of the old all/mentors
  branch.

### Frontend
- **`NotifyTab.tsx`**: full-width two-column layout (message composer 2/3 +
  Recipients panel 1/3) — removes the `max-w-2xl` cap. The Recipients panel has a
  Mentors-only toggle, Department chips and Designation chips (from
  `useDepartments` / `useDesignations`), an "Also send email" checkbox, and a
  **live recipient count** computed client-side from `useUsers()` that mirrors
  the backend filter. Send is disabled when there are no recipients; the confirm
  dialog names the count + filter summary.
- **`admin.service.ts`**: `AdminNotifyPayload` now carries `mentors_only` /
  `department_ids` / `designation_ids`.

### Message length guidance (soft)
The composer shows a **channel-dependent live counter** under the message: with
"Also send email" on, the cap relaxes to **~100 words** (email has room); in-app
only keeps it to **~50 characters** (rows stay glanceable). It's a **soft**
warning — the counter turns red and reads "over recommended length" past the
limit, but typing and sending are never blocked (no backend rejection). Applies
to the Notify tab only. Constants `IN_APP_CHAR_LIMIT` / `EMAIL_WORD_LIMIT` live
in `NotifyTab.tsx`.

## Tests
- **`backend/tests/test_admin_notifications.py`**: notify tests updated to the
  new schema + added department filter, designation-across-departments,
  department-AND-designation, and mentors-only cases (14 in file).
- **`frontend/.../NotifyTab.test.tsx`** (9 cases): live count defaults to
  everyone; dispatch with empty filters; department narrowing reflected in
  payload + count; mentors-only toggle; cancelled confirm; word counter when
  email is on; character counter when email is off; over-limit warns but still
  sends (soft).

## Verification
- Backend `pytest -q` → 74 passed; ruff-clean.
- Frontend `tsc` clean; eslint 0 problems; `vitest` NotifyTab 9 passed.
