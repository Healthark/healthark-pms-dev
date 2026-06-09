# 32 — Admin Notify: replace "Mentors only" with a specific-user search

## Context

The Admin → Notify recipient targeting (see [31](31-notify-recipient-targeting.md))
exposed a **Mentors only** quick toggle alongside the Department / Designation
chips. In practice admins more often want to send an announcement (especially a
one-off email) to **named individuals** — "just send this to Alice and Bob" —
which the mentors filter could not express. This PR drops the Mentors-only
option and adds a type-to-search **specific users** picker in its place.

## What changed

### Backend
- **`AdminNotifyRequest`** (`admin_schemas.py`): drops `mentors_only`; adds
  `user_ids: list[int]` (optional, AND-combined with department / designation;
  none set → everyone).
- **`notify_audience()`** (`services/notifications.py`): the `mentors_only`
  branch (which queried users who mentor someone) is replaced by a
  `user_ids` filter — `User.id.in_(user_ids)`. Empty list → no filter on that
  dimension, as with the other filters.
- **`admin_notify`** route passes `payload.user_ids` through to the resolver.

### Frontend
- **`NotifyTab.tsx`**: the Recipients panel's Mentors-only checkbox is replaced
  by a **Specific users** section using the existing `UserCombobox` (name/email
  search). Picking a user appends to a `userIds` list rendered as removable
  chips; the combobox excludes already-selected ids. The live recipient count
  and confirm-dialog filter summary now reflect `userIds` (`"N users"`).
- **`admin.service.ts`**: `AdminNotifyPayload` swaps `mentors_only` for
  `user_ids: number[]`.

## Tests
- **`backend/tests/test_admin_notifications.py`**: `test_admin_notify_mentors_only`
  replaced by `test_admin_notify_specific_users` (picks one of three users →
  exactly that recipient). 16 in file.
- **`frontend/.../NotifyTab.test.tsx`**: the mentors-only case replaced by
  "narrows recipients to a specific user picked from the search" — types into the
  combobox, selects an option, asserts the live count drops to 1, the chip
  renders, and the payload carries `user_ids: [2]`. The default-dispatch case now
  asserts `user_ids: []`. 10 cases.

## Verification
- Backend `pytest tests/test_admin_notifications.py -q` → 16 passed.
- Frontend `tsc --noEmit` clean; `vitest` NotifyTab → 10 passed.
