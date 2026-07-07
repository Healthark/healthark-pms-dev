# 53 — Support tickets: status lifecycle, Responses filters, extra notify inbox

Follow-up to [52](52-support-issue-reporting-form.md). Adds an admin-managed
**status** to support tickets, surfaces it as an editable column + filter on
the Responses queue, and widens the new-ticket notification.

## What changed for admins

The **Responses** queue now has a **Status** column and a **Status filter**:

- Each ticket carries a status — **Pending**, **In Progress**, or
  **Completed** — rendered as a colored pill that's an **editable dropdown**.
  An admin can set any status at any time; it's a free-form triage board, not a
  one-way ladder (Pending→In Progress→Completed is not enforced).
- The Responses view gains a **Status filter** alongside the existing PMS-page
  filter + search. It **defaults to "Pending"**, so the queue opens on what
  needs attention; "All statuses" shows everything.
- New tickets start **Pending**. Changing a row's status re-queries, so it
  moves in/out of the active filter (e.g. marking a Pending ticket Completed
  drops it from the default view).
- The detail modal shows the current status as a badge.

## What changed for notifications

`aakash.p@healthark.ai` is added to the default `SUPPORT_NOTIFY_EMAILS`, so
new-ticket emails now go to **amol@ / devanshi@ / trapti@ / aakash.p@**
healthark.ai (still overridable per-deployment via the env var).

## Backend

- **Model** — `support_tickets.status` (`String NOT NULL DEFAULT 'pending'`)
  with a CHECK constraint fencing the three values. `SUPPORT_STATUSES` /
  `DEFAULT_SUPPORT_STATUS` constants added.
- **Migration** `f1b6d3a8c250` (← `e4a7c2f19b83`) — additive; backfills
  existing rows to `pending` via the server default + adds the CHECK.
- **Schemas** — `status` on `SupportTicketRow`/`Detail`; new
  `SupportTicketStatusUpdate` (Literal-validated) + `SupportTicketStatusResponse`.
- **Routes** — `GET /tickets` gains a `status` filter; new
  `PATCH /tickets/{id}/status` (Admin-only, tenant-fenced) sets any status.
- **Config** — `SUPPORT_NOTIFY_EMAILS` default extended with the 4th inbox.

## Frontend

- `utils/supportOptions.ts` — `SupportStatus` type + `SUPPORT_STATUS_OPTIONS`
  (label + badge classes) + `DEFAULT_STATUS_FILTER` + `statusMeta()`.
- `support.service.ts` / `queries/support.ts` — `status` on the row/detail
  types + filters, `updateStatus()` + `useUpdateSupportTicketStatus()` (invalidates
  the queue), status folded into the list query key.
- `ResponsesTable.tsx` — Status filter (default Pending) + an editable
  `StatusSelect` per row (optimistic local value, re-synced from the server via
  the render-time adjustment pattern). `SupportTicketModal` shows the status badge.

## Tests

- **Backend** `test_support_status.py` — status-update schema accepts only the
  three values; row defaults to `pending`. `test_support_notify.py` updated to
  the 4-recipient default.
- **Frontend** `ResponsesTable.test.tsx` — status filter defaults to Pending
  and is threaded into the query; rows render an editable status control;
  changing it fires the update mutation with `{id, status}`; empty state.

## Verification

- Backend `pytest -q` green (459); Frontend `vitest run` green (234); `tsc` +
  `eslint` clean.
- Migration applied to the dev Postgres (`alembic upgrade head`) — `status`
  column present.
- **End-to-end** (TestClient, real DB, SMTP stubbed, row cleaned up): submit →
  status `pending` + email to all **four** inboxes; `PATCH` moves the ticket
  pending→completed→in_progress (free order); status filter includes/excludes
  accordingly; bad status → **422**; non-admin / missing-CSRF PATCH → **403**.
