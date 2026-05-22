# Phase B Results & Phase C Roadmap

> Status doc. What shipped in Phase B, what's verified, what's next.
> Audience: anyone scanning before picking up the next migration chunk.

## What shipped (Phase B)

Branch: `phase-b-frontend-optimizations` → PR open against `master`.

| Task | What | Files |
|---|---|---|
| 1 | Route-based code splitting — 15 routes converted to `React.lazy()`; inner Suspense around `<Outlet/>` keeps Sidebar + Topbar mounted across chunk loads | [App.tsx](../../frontend/src/App.tsx) |
| 2 | Shared `['users']` cache via TanStack Query v5; create/update/deactivate/reactivate mutations invalidate the same key; UsersTab + UserCombobox + ProjectsTab all consume one cache | [src/queries/queryClient.ts](../../frontend/src/queries/queryClient.ts), [src/queries/users.ts](../../frontend/src/queries/users.ts), [main.tsx](../../frontend/src/main.tsx), [UsersTab](../../frontend/src/components/admin/UsersTab.tsx), [UserCombobox](../../frontend/src/components/common/UserCombobox.tsx), [AdminPanel](../../frontend/src/pages/AdminPanel.tsx), [UserModal](../../frontend/src/components/admin/UserModal.tsx), [ProjectModal](../../frontend/src/components/admin/ProjectModal.tsx), [ProjectsTab](../../frontend/src/components/admin/ProjectsTab.tsx) |
| 3 | PeerList virtualization with `@tanstack/react-virtual` v3; pairs filtered items into virtual rows; dynamic `measureElement` for responsive height | [PeerList.tsx](../../frontend/src/components/feedback360/PeerList.tsx) |
| 4 | Debounced autosave (1500 ms); removed fire-on-unmount; new generic `useDebounce`; mentor annual eval + PM project eval both flow through `useMutation` wrappers around the parent's `onSaveDraft` | [src/hooks/useDebounce.ts](../../frontend/src/hooks/useDebounce.ts), [EvalForm](../../frontend/src/components/reviews/EvalForm.tsx), [project-reviews/EvalModal](../../frontend/src/components/project-reviews/EvalModal.tsx), [EvalDrawer header comment](../../frontend/src/components/reviews/EvalDrawer.tsx) |

**Dependencies added**

- `@tanstack/react-query ^5.100.10`
- `@tanstack/react-virtual ^3.13.25`

## Bundle metrics

Production `npm run build` output, gzipped numbers in parentheses.

| Metric | Pre Phase B | Post Phase B |
|---|---|---|
| Total emitted JS | one chunk: `index-*.js` **677.78 kB (168.48 kB)** | shared `index-*.js` **214.50 kB (67.24 kB)** + per-route chunks |
| Vite >500 kB chunk warning | yes | none |
| Largest route chunk | n/a — everything in `index` | `AdminPanel-*.js` **71.92 kB (17.60 kB)** post-Phase-B, **63.20 kB (14.57 kB)** after Phase C step 1 |
| Initial JS for `/dashboard` visitor | ~678 kB | ~215 kB shared + ~15.5 kB Dashboard chunk |
| Total CSS | 55.29 kB (10.23 kB) | 55.43 kB (10.29 kB) — unchanged |

**Read:** a `/dashboard` visitor downloads ~68% less JS at first paint. AdminPanel ships its ~14 kB chunk only when an admin visits `/admin`.

## Network behavior — what's verified, what isn't

| Domain | Status | What we see |
|---|---|---|
| `['users']` | ✅ Migrated and verified | `GET /admin/users` fires **exactly once** when AdminPanel opens. Previously fired 3–4× (UsersTab + ProjectsTab + StrictMode 2×). |
| `['system-settings']` | ✅ Phase C step 1 — verified | 4× → **1×** `/settings/` per dashboard cold-load. Confirmed against the dev Network tab. |
| `['admin-settings']` | 🔄 Phase C step 2 (this commit) | `GET /admin/settings` now goes through TanStack; the update mutation invalidates *both* `['admin-settings']` and `['system-settings']`, so cross-page consumers stay in sync without an explicit `refreshSettings()` call. Expected to drop from **2×** to **1×** on AdminPanel mount. |
| `session`, `notifications/summary`, `dashboard/summary`, `admin/{departments,designations,projects/*}` | ❌ Still raw `useEffect + setState` | Still doubled in dev due to React StrictMode + uncoordinated effects. Production strips StrictMode so each fires once — these doubles are dev-only noise, not a prod regression. |

## Established patterns (read before you migrate the next domain)

Every domain migration follows the same shape — copy [src/queries/users.ts](../../frontend/src/queries/users.ts) and adapt:

1. **One file per domain** in `src/queries/`. Exports: a `*QueryKey` constant, a read `useXQuery()` hook, and one `useXMutation()` per write op.
2. **Strict query keys.** Use `as const` tuples: `['users']`, `['system-settings']`, `['notifications', 'summary']`. Same key everywhere — write-then-read consistency is what makes this work.
3. **Invalidate, never `setQueryData`.** On mutation `onSuccess`, call `queryClient.invalidateQueries({ queryKey })`. Optimistic cache writes are easy to get wrong; the round-trip cost is acceptable for internal HR-tool traffic and gets us correctness for free.
4. **Default query options live in [src/queries/queryClient.ts](../../frontend/src/queries/queryClient.ts)** (`staleTime: 60_000`, `gcTime: 5min`, `refetchOnWindowFocus: false`, `retry: 1`). Override per-query only when justified.
5. **For provider-wrapped contexts** (system-settings, notifications), preserve the existing context shape so downstream consumers don't change. Internally the provider becomes a thin TanStack wrapper. See the Phase C step 1 commit for a worked example in [SystemSettingsProvider.tsx](../../frontend/src/contexts/SystemSettingsProvider.tsx).

## Phase C candidates (priority order)

| # | Domain | Endpoint(s) | Why | Notes |
|---|---|---|---|---|
| 1 | **`['system-settings']`** | `GET /settings/` | 4× per dashboard cold-load — the worst offender. Used by 18 consumers via context. | ✅ **Verified.** Provider-shape preserved; no consumer changes. |
| 2 | **`['admin-settings']`** | `GET /admin/settings`, `PATCH /admin/settings` | Separate endpoint, admin-only. AdminPanel's `handleSaveSettings` previously did a manual chain (PATCH → GET → setState×7 → `refreshSettings()` from context). | ✅ **Shipped in this commit.** New module `src/queries/adminSettings.ts`. Mutation invalidates both `['admin-settings']` and `['system-settings']` so cross-page consumers stay fresh. AdminPanel dropped its local `settings` state and `useSystemSettings` consumption. |
| 3 | `['admin', 'departments']` + `['admin', 'designations']` | `GET /admin/departments`, `GET /admin/designations` | Reference data, almost never changes. Long `staleTime` override (e.g. 15 min) and we'd cache across the whole session. | Natural next step — same AdminPanel surface as #2. Currently still in `loadReferenceData`. |
| 4 | `['session']` | `GET /auth/session` | Bootstrap query consumed by every protected route. | AuthProvider refactor; non-trivial because login/logout are mutations. Plan separately. |
| 5 | `['notifications', 'summary']` | `GET /notifications/summary` | Replace the manual `setInterval` polling in [NotificationDropdown.tsx:53](../../frontend/src/components/layout/NotificationDropdown.tsx#L53) with TanStack's `refetchInterval`. Plus `markAllRead` mutation. | Quick win, ~30 LOC. |
| 6 | `['dashboard', 'summary']` | `GET /dashboard/summary` | One-liner page. Trivial migration. | Worth bundling with #5 in one PR. |
| 7 | `['admin', 'projects']` | `GET /admin/projects?include_completed=true`, `POST/PATCH/DELETE/...` | ProjectsTab has its own duplicate fetch; converting it gets us the same cross-page invalidation we got for users. | Slightly larger PR — multiple mutations. |

After all of the above ship: every server-state read in the app should be deduped, and the duplicate-request waterfall we saw on the dashboard collapses to single requests per domain.

## Out of scope (explicitly NOT migrating)

- **`useReviewDetails.ts`** — reducer-based pattern that's load-bearing on `ProjectReviews.tsx` and `PMEvaluationTab.tsx`. Worth its own design pass; don't shoehorn into the simple `useQuery` shape.
- **Goals / annual-review / project-review domain reads.** These are large, intertwined, and we already shipped the most impactful mutation refactor for them (debounced autosave). The cache wins here are smaller than the mechanical risk of touching 15+ files; defer to Phase D if at all.
- **Export blob downloads** — `useQuery` doesn't fit; keep direct service calls.

## Verification recipe (paste into the PR description)

```
1. npm run dev → open /dashboard with Network filter "settings/"
   Expected: ONE GET /settings/ (was 4×).
2. Click 5 routes within 60 s.
   Expected: zero additional /settings/ requests (within staleTime).
3. /admin → System Settings tab → toggle a flag → Save.
   Expected: PATCH /admin/settings, then ONE GET /settings/ from refetch.
   Topbar / banners reflect the new value.
4. Log out, log back in.
   Expected: query disabled on logout, re-fires once on login.
```
