# Pagination PR 1 — Server-side calibration grid (pattern-setter)

> First backend pagination PR. Converts `/annual-reviews/calibration`
> from "fetch the whole org's calibration set + filter/sort/paginate
> client-side" to true offset/limit server-side pagination with
> server-side search, filter, and sort. Establishes the reusable
> `Page[T]` envelope + `PaginationParams` dependency that every
> subsequent pagination PR will build on.

## Context

The optimization arc (Phase D + F1 + F3 + payload PRs A/B/C) is done.
The next axis — chosen preemptively against org growth — is
**offset/limit page-based pagination** on the heavy list endpoints.

A prior risk-assessment pass (see plan file) ranked the seven
candidate list endpoints by `performance-gain × minimal-risk`.
`/annual-reviews/calibration` was picked as **PR 1 / pattern-setter**:

- **Admin + management-only** → smallest blast radius.
- **Single FE consumer** (`ManagementReviewTab` via `useCalibrationGrid`) → no shared-cache compatibility risk (unlike `/admin/users`, whose `useUsers()` is also consumed by `UserCombobox`).
- **Backend query is a single main table** (AnnualReview) + display joins → clean to paginate.

A `TablePagination` component already existed (client-side, but with a
deliberately server-compatible API). This PR feeds it from server
metadata instead of a client-side slice — its props didn't change.

## What changed

### Backend

**New reusable primitives** (`backend/app/schemas/pagination.py`):
- `Page[T]` — generic response envelope `{ items, total, page, per_page }`. Reusable for every future paginated endpoint.
- `PaginationParams` — FastAPI dependency parsing `?page=&per_page=` with bounds (`page ≥ 1`, `per_page ∈ [1, 100]`, defaults 1 / 25). Exposes `.offset` / `.limit`.

**Calibration route** (`backend/app/api/routes/annual_review_routes.py`):
- `GET /annual-reviews/calibration` now returns `Page[CalibrationRow]` and accepts `page`, `per_page`, `search`, `department`, `mentor`, `status` (all/pending/rated), `sort_by`, `sort_dir`.
- Filtering / search / sort happen in **SQL via aliased joins** — `AnnualReview` is joined to aliased `Employee`, `Mentor`, employee `Department` + `Designation`, so we can search/filter/sort on the resolved display names server-side (the prior code resolved those names in Python *after* fetching, which can't paginate correctly).
- `total` is a `COUNT(*)` of the filtered set (before offset/limit) so the UI can render "Page X of N".
- Sort always appends `AnnualReview.id` as a tiebreaker → deterministic offset paging across requests (no row repeats/skips on ties).
- Unknown `sort_by` silently falls back to the default `created_at` order — a bad value never 500s.
- New `GET /annual-reviews/calibration/filter-options` → `{ departments, mentors }` distinct across the cycle's calibration set. Drives the filter dropdowns (which can't be derived client-side once the FE only holds one page).

### Frontend

**Shared types** (`frontend/src/services/pagination.ts`):
- `Page<T>` mirrors the backend envelope. `PageQuery` is the base param shape (`page`, `per_page`, `search`, `sort_by`, `sort_dir`).

**Service** (`annual-review.service.ts`):
- `CalibrationQuery extends PageQuery` adds `department`, `mentor`, `status`.
- `getCalibrationGrid(params)` → `Page<CalibrationRow>`. Sends filters/sort only when set (clean URLs, absent = no filter).
- `getCalibrationFilterOptions()` → `CalibrationFilterOptions`.

**Query hooks** (`queries/annualReviews.ts`):
- `calibrationGridQueryKey(params)` is now a **function** keyed on the full query object. The top-level `['annual-reviews']` mutation broadcast still prefix-matches every variant, so setting a management rating refetches the visible page automatically — no change to the mutation side.
- `useCalibrationGrid(params)` uses `placeholderData: keepPreviousData` so paging/filtering keeps the previous rows on screen instead of blanking the table.
- `useCalibrationFilterOptions()` has a 5-min `staleTime` (options change rarely).

**Consumer** (`ManagementReviewTab.tsx`):
- All client-side `filtered` / `sorted` / `paged` derivations removed. The component now builds a `CalibrationQuery` from its state and renders `data.items` directly.
- Search box is **debounced 300 ms** (`useDebounce`) → one request per pause, not per keystroke. New search resets to page 1.
- Filter dropdown options come from `useCalibrationFilterOptions()` instead of being derived from the (now partial) row set.
- `TablePagination` gets `totalItems={data.total}` from server metadata.
- Any filter/sort/pageSize change resets to page 1; clicking Next/Prev does not (page isn't in the reset effect's deps).
- Subtle `opacity-60` + `aria-busy` on the table during `isFetching` so page transitions read as "loading" without a blank flash.

## Cross-cutting decisions recorded (apply to future pagination PRs)

- **Default `per_page` = 25**, capped at 100.
- **Total count returned** in every page response (cheap COUNT at our table sizes).
- **Filter options via a dedicated endpoint** (not bundled into the page envelope) so they cache independently with a long staleTime. Future endpoints with dynamic dropdowns follow this.
- **Stable sort tiebreaker** (`, id`) on every paginated query.
- **`keepPreviousData`** for smooth page transitions.
- **Offset (not cursor)** — acceptable for low-write admin surfaces; documented trade-off (a row inserted/deleted mid-paging can shift the window). Calibration writes are rare (management ratings), so this is a non-issue here.

## Outcomes

| Scenario | Before | After |
|---|---|---|
| Cold load calibration grid (200-review org) | 1 request returning ALL ~200 rows (~15 kB raw) | 1 request returning 25 rows (~2 kB raw) + 1 small filter-options request (cached 5 min) |
| Type in search | Instant client-side filter over the full in-memory set | 1 debounced request after 300 ms pause; server filters in SQL |
| Sort a column | Client-side array sort | 1 request with `sort_by`/`sort_dir`; SQL ORDER BY + id tiebreaker |
| Change page | Client-side slice (data already in memory) | 1 request for the new offset; previous page stays visible via keepPreviousData |
| Set a management rating | Mutation + full-grid refetch | Mutation + refetch of the **visible page only** (param-keyed cache) |

At 200 reviews the wire saving is modest; the point is it **stays
flat as the org grows** — a 2000-review org still transfers 25 rows
per page instead of 2000.

## Test Cases (manual, pre-merge)

Run as an Admin + Management user (the tab + endpoints 403 anyone else).

### Backend contract
1. Restart backend. `GET /api/v1/annual-reviews/calibration?page=1&per_page=10` → response is `{ items: [...≤10], total: N, page: 1, per_page: 10 }`.
2. `?page=2&per_page=10` → returns the next 10 rows; no overlap with page 1.
3. `?search=<partial employee name>` → only matching rows; `total` reflects the filtered count.
4. `?department=<dept>` and `?mentor=<name>` → exact-match filtering; combinable with search.
5. `?status=pending` → only rows with no management rating; `?status=rated` → only rows with one.
6. `?sort_by=employee_name&sort_dir=desc` → reverse-alphabetical; `?sort_by=management_performance_rating&sort_dir=asc` → numeric sort with nulls grouped consistently.
7. `?sort_by=garbage` → does NOT 500; falls back to created_at order.
8. `GET /api/v1/annual-reviews/calibration/filter-options` → `{ departments: [...], mentors: [...] }` with distinct values across the cycle.
9. `?per_page=500` → clamped/rejected (422 from the `le=100` bound). Confirm the bound holds.
10. Hit any calibration endpoint as a non-management user → 403.

### Frontend — Management Review tab
11. Open AdminPanel → Management Review tab. Network: 1× `/calibration?page=1&per_page=25` + 1× `/calibration/filter-options`. Grid renders the first page; pagination bar shows "N Records / Page 1 of …".
12. Type in the search box → confirm exactly **1 request fires ~300 ms after you stop typing** (not per keystroke). Grid updates; page resets to 1.
13. Pick a Department from the dropdown → 1 request; grid filters; page resets to 1. Dropdown still lists every department (from filter-options, not the current page).
14. Pick a Mentor → combinable with department + search.
15. Status = Pending / Rated → grid narrows accordingly.
16. Click a sortable column header → 1 request; rows reorder; the previous rows stay visible (slightly dimmed) during the fetch, no blank flash.
17. Click Next → page 2 loads; click Prev → back to page 1. Changing "Rows per page" resets to page 1.
18. Open a row's Edit (pencil) → set a management rating → Save. Confirm: the modal closes and the **current page refetches** showing the new rating (mutation broadcast → param-keyed cache invalidation). Other filters/sort/page position are preserved.
19. View (eye) modal still opens the full review detail unchanged.
20. Empty states: search for a nonsense term → "No reviews match your filters". On an org/cycle with zero calibration reviews → "No reviews yet".

### Regression
21. `npm run build` passes; backend `python -c "import main"` passes.
22. The management-rating mutation, the detail modal, and the rating-edit modal all behave exactly as before — only the data source for the grid changed.

## Risks

- **Offset paging window shift** — if a review enters/leaves calibration between page loads, the offset window can shift by one. Calibration writes (management ratings, mentor submissions clearing into calibration) are low-frequency and don't change row *membership* on a rating edit, so this is effectively a non-issue here. Documented for the higher-write endpoints later.
- **Filter-options staleness** — cached 5 min. If a new review clears into calibration during that window, its department/mentor might not appear in the dropdown until the cache expires. Acceptable; the grid itself (page data) is always fresh.
- **`COUNT(*)` per request** — negligible at our table sizes (low thousands). Revisit only at 7-figure row counts.

## What this is NOT

- Does **not** paginate the other four client-side `TablePagination` tables (UsersTab, ProjectsTab, TeamGoalsTab, TeamReviewTab) — those remain client-side until their own PRs. This PR establishes the pattern they'll follow.
- Does **not** change the `TablePagination` component's API — it was already server-compatible.
- Cursor pagination + infinite scroll remain out of scope (offset/limit only, per the chosen approach).

## Next candidates (from the risk-assessment plan)

1. **PR 2 — `/admin/users`** (biggest scaling win; FE migration heavier because `UserCombobox` shares `useUsers()` — needs a non-paginated `list-all` variant for the picker).
2. **PR 3 — `/goals/team`** (only if mentor team sizes grow; Bulk Approve selection semantics under pagination need a decision).
3. Deferred: `/feedback-360/peers` (virtualized already), `/mentees/summary` (too small), `/project-reviews/pm-queue` (needs SQL-first refactor).

## Related artifacts

- Risk-assessment + prioritization: plan file `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
- Reusable primitives: `backend/app/schemas/pagination.py`, `frontend/src/services/pagination.ts`
- PR A–C + F1/F3: `docs/optimizations/16`–`20`.
