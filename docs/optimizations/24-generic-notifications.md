# 24 — Generic notification platform (two-tab bell)

## Context

Notifications barely existed: the only persistent type was `GoalNotification`,
which had **no create-path in application code** (only the seed referenced it),
and the bell otherwise showed a few *computed* standing counts. Email existed
only for welcome + password-reset. To add notifications across modules (goals,
reviews, projects, mentoring, settings) we needed a reusable primitive rather
than another bespoke table per domain.

This PR is the **platform** — infrastructure only, no module events fire yet.
Both bell tabs render empty until later PRs wire the per-module hooks.

## What changed

### Backend
- **New generic `Notification` model** (`app/models/notification_models.py`) +
  `NotificationCategory` (`personal` | `announcement`). Per-recipient rows;
  nullable `actor_id` (null for system/announcements and anonymity-sensitive
  sources); nullable `link` deep-link; FK-less polymorphic `entity_type` /
  `entity_id` (notifications outlive the rows they point at).
- **Migration `f4d2a9c7b318`** creates `notifications` (+3 indexes) and **drops
  the superseded `goal_notifications`** table. `downgrade()` recreates it
  verbatim — round-trips clean on SQLite.
- **`app/services/notifications.py`** — the single write-path:
  `create_notification(...)` (adds a row, NOT committed → atomic with the
  endpoint's existing commit; optional email via `BackgroundTasks`),
  `broadcast_notification(...)` (batch fan-out + one batched email task), and
  recipient resolvers (`active_org_users`, `mentor_users`). Imports models +
  `send_email` only — never route modules — so there's no import cycle.
- **`send_notification_email(...)`** added to `send_email.py`, reusing
  `_send` / `_resolve_theme` / `_esc` / `is_smtp_configured`. CTA button renders
  only when a link is supplied.
- **Summary endpoint restructured**: `TopbarSummary` now returns
  `notifications` (computed counts) + `personal[]` + `announcements[]`
  (`StoredNotificationItem`, split by category). `mark-all-read` gains an
  optional `?category=` filter so each tab clears independently; per-row
  `mark-read` works for both categories by id.

### Frontend
- `notification.service.ts` / `queries/notifications.ts`: `TopbarSummary` gains
  `personal` + `announcements`; `markAllRead(category?)` is category-aware.
- **`NotificationDropdown` is now two-tabbed** — *Notifications* (computed
  standing alerts + stored personal events) and *Announcements* (stored
  broadcasts). Stored rows render `title` + `body`, deep-link via their `link`
  when present, and carry the per-row ✓ tick + a per-tab "Mark all as read".
- **Computed standing alerts are NOT dismissable** — they represent live work
  (e.g. "1 goal from your team awaits approval") and clear themselves when the
  underlying state resolves (approve the goal → the count drops to 0). So they
  have no ✓ tick and are excluded from "mark all as read". (An earlier
  localStorage-dismissal experiment let a still-pending alert stay permanently
  hidden once ticked at the same count — removed for this reason.) The ✓ /
  mark-all act only on stored rows, via the per-id and category endpoints.
- `Topbar` threads `personal`/`announcements` and lights the bell dot if any of
  the three sources has something.

## Notes
- **Contract change** (`user_notifications` → `personal`/`announcements`) is why
  BE+FE land together in this one PR; subsequent module PRs are purely additive.
- Dead deep-links (deleted entity) yield a 404 the FE already tolerates — no FK
  on `entity_id` by design.
- Emails are always gated by `is_smtp_configured()` and run via `BackgroundTasks`.
