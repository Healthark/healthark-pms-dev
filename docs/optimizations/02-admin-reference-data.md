# Phase C step 3 — Admin reference data (`departments` + `designations`)

> Sequential progression note for the third Phase C migration.

## What was migrated

Two read-only admin reference endpoints onto the shared TanStack Query cache:

- `GET /admin/departments` → `['admin', 'departments']`
- `GET /admin/designations` → `['admin', 'designations']`

These two are paired because they're admin org-structure dropdowns that change rarely (org reorgs happen quarterly at most) and are always fetched together in the same screens.

## What changed

### New
- [frontend/src/queries/adminReferenceData.ts](../../frontend/src/queries/adminReferenceData.ts) — `useDepartments()` + `useDesignations()`. **`staleTime: 15 min`** override (vs the default 60 s) since these lists are effectively static for a session. No mutation hooks — the backend doesn't expose CRUD for these from the frontend.

### Refactored
- [AdminPanel.tsx](../../frontend/src/pages/AdminPanel.tsx) — dropped the local `useState<DepartmentBrief[]>` / `useState<DesignationBrief[]>` plus the entire `loadReferenceData` callback + its bootstrap `useEffect`. Now reads both from `useDepartments()` / `useDesignations()`. Continues prop-drilling to `UsersTab` and `UserModal` (no consumer changes — minimal-touch refactor).
- [ProjectModal.tsx](../../frontend/src/components/admin/ProjectModal.tsx) — dropped its **independent** copy of the same fetch. Previously each open of the Project create/edit modal fired a fresh `GET /admin/departments` + `GET /admin/designations`. Now hits the shared cache — typically a zero-network open if AdminPanel already populated it.

### Untouched
- [admin.service.ts](../../frontend/src/services/admin.service.ts) — `getDepartments`/`getDesignations` still exist as the service-layer helpers used by the query hooks.
- `UsersTab`, `UserModal`, `ProjectsTab` — none changed. Reference data still flows in via existing prop signatures.

## Outcomes

### Network behavior

Before this PR (post Phase C step 2):

| Surface | `GET /admin/departments` | `GET /admin/designations` |
|---|---|---|
| AdminPanel mount | 1 (+ StrictMode 2× in dev) | 1 (+ StrictMode 2× in dev) |
| ProjectModal open | 1 each time | 1 each time |
| ProjectModal close + reopen | 1 again | 1 again |

After this PR:

| Surface | `GET /admin/departments` | `GET /admin/designations` |
|---|---|---|
| AdminPanel mount | **1** (StrictMode deduped by TanStack) | **1** |
| ProjectModal open within 15 min of AdminPanel | **0** | **0** |
| ProjectModal open after staleTime expires | 1 (background refetch — UI still has data) | 1 |

Expected dashboard cold-load reduction: **~4 requests removed** in dev (2× for each endpoint), **~2 removed** in prod. Bigger absolute win on the Projects tab — every modal open used to fire two requests.

### Bundle delta

| Asset | Pre this PR | Post |
|---|---|---|
| `AdminPanel-*.js` | 63.16 kB / 14.63 kB gzip | **63.06 kB / 14.60 kB gzip** |
| Shared `index-*.js` | 214.20 kB / 67.16 kB gzip | **214.20 kB / 67.16 kB gzip** (flat) |

Essentially flat — net code added (two hook definitions, a `useDepartments`/`useDesignations` import) is offset by removed code (local state, callback, useEffect).

### Verification (manual)

| Step | Expected | Status |
|---|---|---|
| `/admin` cold load → Network filter `departments\|designations` | 1× each (was 2× in dev StrictMode) | TBD by reviewer |
| Open Project create modal within same session | **zero** `departments`/`designations` requests | TBD |
| Reopen Project modal multiple times | still **zero** within 15 min | TBD |
| Wait 15 min + reopen Project modal | one background refetch each — UI keeps stale data until done | TBD |

## Established pattern reinforced

This migration confirms the "reference data with long staleTime" recipe:

- Per-domain file in `src/queries/`
- `as const` query key tuple, often a 2-segment array (`['admin', 'departments']`) for namespacing
- Override `staleTime` per-query when the data is effectively static — saves repeated network round-trips without giving up freshness on mutations
- No mutations needed → no mutation hooks → keep the module minimal

Next step (Phase C step 4): `['session']` migration in `AuthProvider`. Higher complexity because the login/logout mutations gate everything else.

## Related artifacts

- Phase B foundation: [00-audit.md](./00-audit.md)
- Phase B + step 1+2 summary: [01-phase-b-results.md](./01-phase-b-results.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
