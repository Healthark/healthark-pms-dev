# 28 — Admin & Announcements notifications (PR 5)

## Context

Final PR of the notification rollout (PR 1 platform → PR 2 Goals → PR 3 Annual
Reviews → PR 4 Projects). This PR wires the **Admin / Mentoring** events and
introduces the **Announcements** channel's two producers: automatic
settings-toggle notices and a manual Admin broadcast. Additive; no
schema/migration change.

This also closes the "no scheduler" gap from the plan: calendar-transition
reminders ("the second half has started", "the new financial year has begun")
have no cron to fire them, so they're sent **manually** from the new Admin
**Notify** tab instead of being built on a scheduler that doesn't exist.

## What changed

### Backend — hooks in `app/api/routes/admin_routes.py`
Notifications are added on the endpoint's session (atomic with the business
write); email via `BackgroundTasks`, gated by `is_smtp_configured()`.

| Event | Endpoint | → Recipient(s) | Tab | Channel |
|---|---|---|---|---|
| Mentor reassigned | `PATCH /users/{id}` | the mentee | Notifications | in-app + email |
| Access toggle flipped | `PATCH /settings/year/{fy}` | all active org users | Announcements | in-app only |
| Manual broadcast | `POST /notify` (NEW) | all users **or** mentors | Announcements | in-app + optional email |

- **`update_user`** snapshots `mentor_id` before applying the patch and notifies
  the mentee **only on a change to a non-null new mentor** — re-saving the same
  mentor, or clearing it to `None`, is not a reassignment and stays silent.
  Deep-links to `/profile`.
- **`update_year_settings`** snapshots the four `YEAR_OVERRIDE_FLAGS` before/after
  and announces **only the toggles that actually flipped** (no-op saves emit
  nothing). Each flag has an opened/closed (or visible/hidden) title + body in
  the `_TOGGLE_ANNOUNCEMENTS` table, deep-linking to the relevant feature page.
  In-app only — no email for routine config changes.
- **`admin_notify`** (NEW `POST /admin/notify`) fans out a manual announcement
  via `broadcast_notification`. Audience is `all` (`active_org_users`) or
  `mentors` (`mentor_users`); subject/body are backend-authoritative; email is
  an explicit opt-in. Returns `{ recipients, emailed }` where `emailed` is true
  only when `send_email` **and** SMTP is configured.

### Schemas — `app/schemas/admin_schemas.py`
- `AdminNotifyRequest` (`subject`, `body`, `audience: all|mentors`, `send_email`)
  and `AdminNotifyResult` (`recipients`, `emailed`).

### Frontend
- **`admin.service.ts`**: `AdminNotifyPayload` / `AdminNotifyResult` types +
  `sendNotify()` → `POST /admin/notify`.
- **`queries/adminSettings.ts`**: `useSendNotify()` mutation; on success
  invalidates the Topbar summary so an admin in the audience sees their own
  announcement land in the bell.
- **`components/admin/NotifyTab.tsx`** (NEW): preset picker (Second half /
  New financial year) that pre-fills an editable subject + body, audience
  select, "Also send email" checkbox, and a Send button guarded by `confirm()`
  + success toast / error snackbar.
- **`pages/AdminPanel.tsx`**: new **Notify** tab inserted **before Export**.
  The whole panel is already `["Admin"]`-gated at the route, matching the
  endpoint's `_require_admin`, so the tab needs no extra role guard.

## Channel note
Announcements never email by default: settings-toggle notices are in-app only,
and the manual broadcast emails only when the admin opts in. The in-app row is
always the source of truth; email is the secondary channel, gated by
`is_smtp_configured()` so unconfigured envs just log a skip.

## Tests
- **`backend/tests/test_admin_notifications.py`** (11 cases): mentor-reassign
  fires / stays silent on unchanged / unassigned / non-admin; toggle flip
  announces to every active user, two flips → two distinct notices, no-flip →
  nothing; `/admin/notify` all vs mentors audience, email gated by SMTP config,
  non-admin → 403.
- **`frontend/src/components/admin/__tests__/NotifyTab.test.tsx`** (4 cases):
  Send disabled until subject+body present; preset fills + dispatches with the
  expected payload; cancelled confirm → no dispatch; custom message to mentors
  with email disabled.
