# 29 — Notification panel redesign + 100-day retention (PR A)

## Context

The notification platform (PRs 24–28) worked but the bell surface was thin: a
cramped `w-80 / max-h-80` `createPortal` **dropdown** where each stored row was
title-only and had to be **clicked to expand** before its body / `Open →` link
appeared, with **no timestamps**, and rows **accumulated forever** (no
retention). This PR reworks the surface and adds automatic cleanup. Email
redesign is a separate follow-up (PR B / note 30).

## What changed

### Frontend — half-height drawer
- **`components/layout/NotificationPanel.tsx`** (replaces `NotificationDropdown.tsx`):
  a vertical drawer anchored under the bell, `height: 50svh` (capped to the
  viewport), `w-96`, with a scrollable list. Keeps the two-tab bar
  (Notifications / Announcements), click-outside + Escape, and `createPortal`.
- Each stored row now shows **heading + short description (`line-clamp-2`) + a
  relative timestamp** ("2 days ago") with **no expand step**. The **`Open →`
  button and the expand/chevron state are gone** — the whole row is a single
  button that deep-links on click (disabled when the row has no link). The ✓
  mark-read affordance and unread highlight are unchanged. Computed
  standing-count rows are unchanged (message-as-heading, no timestamp, click
  navigates).
- **`utils/timeAgo.ts`** (NEW): pure `timeAgo(iso, now?)` →
  "just now" / "N mins ago" / "N hours ago" / "N days ago" / "N weeks ago",
  falling back to an absolute short date past ~30 days. `now` is injectable for
  deterministic tests. Hand-rolled — the repo carries no date library.
- **`layouts/Topbar.tsx`**: points at `NotificationPanel`; open/close, per-tab
  mark-all, and the bell dot are unchanged.

### Backend — 100-day retention (no scheduler exists)
- **`NOTIFICATION_RETENTION_DAYS = 100`** on `models/notification_models.py` —
  one source of truth for both enforcement paths.
- **Lazy purge on read**: `get_topbar_summary` opens with a single indexed bulk
  `DELETE` of the **caller's org** rows older than the cutoff
  (`ix_notifications_org` covers the filter) before reading. Cleanup happens
  whenever the app is used; the GET stays cheap.
- **`purge_notifications.py`** (NEW, backend-root CLI like `seed-production.py`):
  `python purge_notifications.py [--days N]` deletes expired rows across **all**
  orgs — covers orgs that never load the app, wire to cron later. Core deletion
  is factored into `purge_older_than(db, cutoff)` so it's unit-testable.

## Tests
- **`frontend/src/utils/__tests__/timeAgo.test.ts`** (8): boundary cases incl.
  1-vs-2-day, weeks, >30-day date fallback, future-skew, invalid date.
- **`frontend/src/components/layout/__tests__/NotificationPanel.test.tsx`** (7):
  heading+description+timestamp render with no click; whole-row click navigates;
  no "Open" button exists; tab switch; mark-read by id; per-tab mark-all; empty
  state.
- **`backend/tests/test_notification_retention.py`** (3): summary purges only
  >100d and is org-scoped; CLI `purge_older_than` spans all orgs.

## Verification
- Backend: `pytest -q` → 64 passed; new test + CLI ruff-clean; CLI runs
  (`--days 100000` → 0 purged, wiring confirmed).
- Frontend: `tsc --noEmit` clean; eslint 0 problems on changed files;
  `vitest run` → 15 passed.
