# 33 — Notify channel selector + count badge / tab dots

## Context

Two notification UX fixes:
1. The Notify tab's single "Also send email" checkbox couldn't express
   email-only delivery — every send wrote an in-app row. Admins need to choose
   **Email**, **In-app**, or **Both**.
2. The Topbar bell showed only a dot regardless of how many notifications were
   waiting, while the bell *dropdown* tabs showed numeric counts — backwards.
   Swap them: a **count badge** on the bell, **dots** on the tabs.

## What changed

### Delivery channel (Email / In-app / Both)
- **Backend**
  - `AdminNotifyRequest.send_email: bool` → `channel: Literal["email","in_app","both"] = "both"`.
  - `broadcast_notification()` gains `write_inapp: bool = True` and returns
    `len(recipients)` so an **email-only** broadcast (no in-app rows) is possible:
    `write_inapp=False, send_email=True`.
  - `admin_notify` maps channel → `write_inapp = channel in ("in_app","both")`,
    `send_email = channel in ("email","both")`.
- **Frontend** (`NotifyTab.tsx`)
  - The checkbox is replaced by a 3-way segmented **Channel** control
    (In-app / Email / Both), default **Both**.
  - Length guidance follows the channel: any in-app write (in_app/both) caps at
    **~100 characters**; email-only allows **~100 words**. Still soft (red
    counter, never blocks). The "Both" case keeps the 100-char cap as requested.
  - `AdminNotifyPayload.send_email` → `channel` (new `NotifyChannel` type).

### Bell count badge + tab dots
- **`Topbar.tsx`**: the single dot becomes a numeric **unread-count badge**
  (computed alerts + personal-unread + announcement-unread), capped at "9+";
  hidden when zero.
- **`NotificationPanel.tsx`**: the per-tab numeric `countBadge` becomes a small
  **unread dot** (the bell-style `bg-accent` dot) on Notifications / Announcements
  when that tab has unread items.

## Tests
- **`backend/tests/test_admin_notifications.py`** (16): notify tests moved to
  `channel=`; added email-channel-writes-no-rows and in-app-never-emails.
- **`frontend/.../NotifyTab.test.tsx`**: default Both + char counter; Email →
  word counter; selected channel in payload; soft over-limit still sends.
- **`frontend/src/layouts/__tests__/Topbar.test.tsx`** (NEW, 3): badge shows
  total unread, caps at 9+, hidden when nothing unread.

## Verification
- Backend `pytest -q` → 76 passed; ruff-clean.
- Frontend `tsc` clean; eslint 0; vitest NotifyTab + NotificationPanel + Topbar green.
