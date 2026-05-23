# Phase C step 5 — Notifications summary migration

> Sequential progression note for the fifth Phase C migration.

## What was migrated

The Topbar's notification summary (system-computed + per-user) — both the read and the "mark all read" write.

- `GET /notifications/summary` → `['notifications', 'summary']`
- `POST /notifications/mark-all-read` → `useMarkAllRead` mutation that invalidates the summary key

## What changed

### New
- [frontend/src/queries/notifications.ts](../../frontend/src/queries/notifications.ts) — `notificationsSummaryQueryKey = ['notifications', 'summary']`, plus `useNotificationsSummary()` (read) and `useMarkAllRead()` (mutation with strict invalidation on success).

### Refactored
- [frontend/src/layouts/Topbar.tsx](../../frontend/src/layouts/Topbar.tsx)
  - Dropped the local `summary` state + `useEffect(() => fetch)` pattern.
  - `summary` now comes from `useNotificationsSummary()`.
  - `handleMarkAllRead` now calls `markAllReadMutation.mutateAsync()` instead of:
    1. firing the service call
    2. doing a manual `setSummary(prev => …)` optimistic update flipping every `is_read` to true
  - Behaviour change: the unread badge clears **after the server round-trip** instead of instantly. In practice that's ~50-200ms of delay — acceptable trade-off for matching the strict invalidate-only pattern from Phase B Task 2.

### Untouched
- `NotificationDropdown.tsx` — purely presentational, receives data via props from Topbar. Unchanged.
- `notification.service.ts` — endpoints unchanged.

## Outcomes

### Network behavior

| Surface | `GET /notifications/summary` |
|---|---|
| Cold load (dev StrictMode 2×) | was **2×**, now **1×** (TanStack dedup) |
| Route navigations within 60 s | 0 (cache hit) |
| Mark all read clicked | 1× POST + 1× GET (invalidation refetch) |
| Topbar remounts (e.g. logout/login same tab) | 1× on first mount after the prior `queryClient.clear()` from step 4 |

### Bundle delta

| Asset | Pre this PR | Post |
|---|---|---|
| Shared `index-*.js` | 214.36 kB / 67.25 kB gzip | **214.37 kB / 67.28 kB gzip** |
| `AdminPanel-*.js` | 63.06 kB / 14.60 kB gzip | **63.01 kB / 14.58 kB gzip** |

+30 bytes gzip in the shared chunk. Negligible.

### Behaviour deltas

| Before | After |
|---|---|
| `handleMarkAllRead` fired the network call then did a manual `setState` flipping every `is_read=true` in the local summary — badge cleared instantly. | `handleMarkAllRead` fires the mutation; on success, TanStack invalidates the summary key and the badge clears on the refetch (~100-200 ms later). |
| Topbar held its own state copy of the summary. | Topbar reads from the shared cache. If multiple components ever need the same summary (e.g. a future dashboard widget), they share the same fetch. |

## Verification (manual)

1. Hard reload → 1× `GET /notifications/summary` in Network tab (was 2× in dev StrictMode). ✅
2. Navigate across 5 routes within 60 s → 0 additional `GET /notifications/summary`. ✅
3. Click bell → dropdown opens. Confirm summary content matches what was fetched on load.
4. Click "Mark all read" inside the dropdown:
   - Network: 1× `POST /notifications/mark-all-read` (200), followed by 1× `GET /notifications/summary` (invalidation refetch).
   - Badge clears after the refetch completes. The delay is visible if your network is slow but acceptable.
5. Hard reload after marking all read → the new unread state should persist (server-confirmed).

## Intentionally NOT done (out of scope)

- **`refetchInterval` polling.** The legacy code didn't poll. Adding it would be a UX change, not a migration. If the team wants live notification updates (e.g. every 60 s), it's a one-line add to `useNotificationsSummary` later:
  ```ts
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  ```
- **Optimistic update** (`onMutate` + `setQueryData` snapshot/rollback). Possible follow-up if the ~150 ms badge-clear delay becomes a UX complaint. The strict invalidate-only rule from earlier Phase B/C work made this the conservative choice.

## Pattern reinforced

Same shape as every other domain so far:
- `<domain>QueryKey` constant.
- One `useFooQuery()` for the read.
- One `useFooMutation()` per write, each with `onSuccess: invalidate(<key>)`.
- No `setQueryData` in mutation callbacks.

## Related artifacts

- Phase B foundation + pattern: [01-phase-b-results.md](./01-phase-b-results.md)
- Phase C step 3 (admin reference data): [02-admin-reference-data.md](./02-admin-reference-data.md)
- Phase C step 4 (session): [03-session-auth.md](./03-session-auth.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
