# Phase C step 6 — Dashboard summary migration

> Sequential progression note for the sixth Phase C migration.
> Smallest one yet — trivial single-fetch page with no mutations.

## What was migrated

The dashboard summary aggregate read consumed by the `/dashboard` page's six widgets.

- `GET /dashboard/summary` → `['dashboard', 'summary']`

## What changed

### New
- [frontend/src/queries/dashboard.ts](../../frontend/src/queries/dashboard.ts) — `dashboardSummaryQueryKey = ['dashboard', 'summary']`, `useDashboardSummary()`. No mutations — the endpoint is a read-only aggregate computed server-side from goals/reviews/projects.

### Refactored
- [frontend/src/pages/Dashboard.tsx](../../frontend/src/pages/Dashboard.tsx)
  - Dropped three local state hooks (`summary`, `isLoading`, `error`) and the `useEffect` that called `dashboardService.getSummary()`.
  - Now reads from the hook: `const { data: summary, isPending, isError } = useDashboardSummary();`
  - Switched the loading branch from `isLoading || !summary` to `isPending || !summary` (TanStack v5 — `isPending` is the canonical "no data yet" flag; `isLoading` adds a redundant `isFetching` check).
  - Switched the error branch from `error` (boolean) to `isError` (boolean from the hook).

### Untouched
- The six widget components (`ActionItemsWidget`, `GoalsWidget`, `MyAnnualReviewWidget`, `ActiveCycleWidget`, `PendingMentorWorkWidget`, `MenteesWidget`) — all still receive `summary` as a prop, contract unchanged.
- `dashboard.service.ts` — service shape unchanged.
- The two layered sections (Personal + Mentor) and the role-additive gating logic — unchanged.

## Outcomes

### Network behavior

| Surface | `GET /dashboard/summary` |
|---|---|
| Cold load (dev StrictMode 2×) | was **2×**, now **1×** (TanStack dedup) |
| Navigate away and back within 60 s | 0 requests (cache hit) |
| Hard refresh after 60 s | 1× (cache stale, refetch) |

### Bundle delta

| Asset | Pre this PR | Post |
|---|---|---|
| Shared `index-*.js` | 214.37 kB / 67.28 kB gzip | **214.54 kB / 67.32 kB gzip** |
| `Dashboard-*.js` | 15.52 kB / 3.62 kB gzip | **15.49 kB / 3.60 kB gzip** |
| New chunk `useQuery-*.js` | — | 16.31 kB / 5.46 kB gzip |

The new `useQuery-*.js` is Vite auto-splitting TanStack's `useQuery` core into a shared chunk now that it's referenced from many places (dashboard, notifications, dashboard, settings, …). This is a *net win*: code that was previously inlined into route chunks now lives in a single chunk that ships once and is cached across navigations. Dashboard chunk got 30 bytes smaller as a result.

## Verification (manual)

1. Hard reload `/dashboard` → 1× `GET /dashboard/summary` in Network tab (was 2× in dev).
2. Navigate to `/admin`, then back to `/dashboard` within 60 s → 0 additional requests.
3. After 60 s, click around → next `/dashboard` visit triggers a fresh fetch (staleTime expired).
4. Confirm all six widgets render with the cached summary identical to before.
5. Confirm the loading skeleton state renders briefly on first cold load.
6. Confirm the error fallback message renders if the backend is killed (test with `kill -9 backend` mid-load).

## Intentionally NOT done

- **Cross-domain invalidation** — the dashboard summary is computed from goals/reviews/projects. Mutations elsewhere (goal-approve, review-submit, project-complete, etc.) don't currently invalidate `['dashboard', 'summary']`. So a user who approves a goal in `/annual-goals` then returns to `/dashboard` within 60 s might see a stale counter.
  - For now we rely on the 60s `staleTime` and the user eventually navigating elsewhere.
  - Follow-up PR could add `qc.invalidateQueries({ queryKey: dashboardSummaryQueryKey })` to the relevant mutations.
- **No mutations** in this migration. There aren't any to add — dashboard is read-only.

## Pattern reinforced

Same template as the rest:
- One file per domain in `src/queries/`.
- Strict tuple query key.
- Read hook only (no mutation hooks here — domain is read-only).
- No `setQueryData`.

## Related artifacts

- Phase B foundation: [01-phase-b-results.md](./01-phase-b-results.md)
- Phase C step 3 (reference data): [02-admin-reference-data.md](./02-admin-reference-data.md)
- Phase C step 4 (session): [03-session-auth.md](./03-session-auth.md)
- Phase C step 5 (notifications): [04-notifications.md](./04-notifications.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
