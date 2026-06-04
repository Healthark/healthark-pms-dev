# Pagination — Server-side /projects (closes the pagination arc)

> Final pagination PR, following calibration (21), users (22), and
> team-goals (23). Originally drafted as the branch `perf-paginate-projects`
> (slated for doc slot `24`), but that slot was taken by the notifications
> work while this sat unmerged. **This is the same change, re-applied on top
> of current master after the project member soft-delete (35) landed** — the
> two touched the same `list_projects` region, so this port reconciles the
> pagination rewrite with soft-delete's `is_deleted == False` filters (see
> "Soft-delete reconciliation" below).
>
> The risk-assessment plan flagged this one as "refactor first": the PM lookup
> + member-count subqueries ran for the whole org regardless of slice. This PR
> scopes them to the page and moves filter/search/sort server-side.

## Context

`GET /projects/?include_completed=true` returned every non-deleted
project, and `ProjectsTab` filtered / sorted / sliced client-side. Two
backend subqueries (member count + PM resolution) ran across **all** org
assignments — so naively adding offset/limit would still scan the whole
org. This PR fixes that and finishes the arc.

## What changed

### Backend (`project_routes.py`, `project_schemas.py`)

- **`GET /projects/` → `Page[ProjectResponse]`** — paginated. Params: `page`, `per_page`, `search`, `status` (active/completed/all), `year` (start year), `pm` (Primary evaluator name), `sort_by`, `sort_dir`. Replaces the old `include_completed` boolean with a `status` filter.
- **Subqueries scoped correctly:**
  - Server-side sort by `pm_name` / `reports_to_name` / `member_count` uses **correlated scalar subqueries** that evaluate per outer Project row — so the main query stays 1:1 with Project (no row multiplication, correct `COUNT(*)` + offset/limit).
  - The PM filter (`WHERE pm_name == X`) reuses the correlated PM subquery.
  - Year filter uses a **date range** (`start_date >= Jan 1 year AND < Jan 1 year+1`) — portable across SQLite (dev) + Postgres (prod), avoiding engine-specific year extraction.
  - The display-value maps (`count_map`, `pm_map`) now query **only the page's project IDs** (`project_id.in_(page_ids)`) instead of the whole org.
- **`GET /projects/filter-options` → `ProjectsFilterOptions`** — distinct start years + PM names across non-deleted projects, for the Year + PM dropdowns. Declared before `/{project_id}` so it doesn't get shadowed by the detail route.

### Soft-delete reconciliation (new vs the original branch)

The original branch predated PR #35 (project member soft-delete), so its
queries counted/showed removed members. This port carries
`ProjectAssignment.is_deleted == False` into **every** assignment query:
`_project_pm_name_subquery`, `_project_member_count_subquery`, the
page-scoped `count_map` + `pm_rows` lookups, and the `filter-options` PM
query. Result: removed members never inflate `member_count`, and a removed
Primary never appears in the PM sort / filter / dropdown.

### Frontend

- `project.service.ts`: `ProjectQuery extends PageQuery` (+ status/year/pm); `ProjectsFilterOptions`; `listProjects(params) → Page<ProjectResponse>` (was `listProjects(includeCompleted)`); `getProjectsFilterOptions()`.
- `queries/adminProjects.ts`: `adminProjectsQueryKey` kept as the **static prefix** used by mutation invalidations; new `adminProjectsPageQueryKey(params)` for the page; new `projectsFilterOptionsQueryKey`. `useAdminProjects(params)` with `keepPreviousData`; `useProjectsFilterOptions()` (60-s staleTime). **The three lifecycle mutations (delete/markComplete/reopen) stay invalidate-only** — they invalidate the `["admin","projects"]` prefix, which matches both the param-keyed page entries and the filter-options entry, so the visible page + dropdowns refetch. `handleModalSave` uses the same prefix, so create/edit also refresh.
- `ProjectsTab.tsx`: dropped all client-side filter/sort/slice + `PROJECTS_SORT_CONFIG`. Builds a `ProjectQuery` from state, renders `data.items`. Search debounced 300 ms; Year/PM dropdowns from filter-options; `TablePagination` fed `data.total`; page resets to 1 on filter/sort/pageSize change; subtle `opacity-60` + `aria-busy` on the table during `isFetching`. The export button, `ClearFiltersButton`, and `useSystemSettings` wiring (added after the branch forked) are preserved.

## Outcomes

| Scenario | Before | After |
|---|---|---|
| Cold load Projects tab (500-project org) | 1 request, all 500 rows + 2 all-org subquery scans | 1 request, 25 rows (subqueries scoped to those 25) + 1 filter-options |
| Search / status / year / PM filter | Client-side over the full set | Debounced/immediate server request; SQL filter |
| Sort any column (incl. PM / Reports-To / Members) | Client-side array sort | Server `ORDER BY` (correlated subqueries for the join-dependent ones); id tiebreaker |
| Delete / complete / reopen | Mutation + full-list refetch | Mutation + refetch of the visible page + filter options |
| Member count with removed members | Counted removed rows | Excludes soft-deleted assignments |

Scales flat: a 5,000-project org transfers 25 rows/page, and the
member-count/PM resolution touches only those 25 — not 5,000.

## Tests

- Backend `tests/test_project_pagination.py`: envelope shape, page slicing/no-overlap, each filter + combined, join-dependent sorts, bad `sort_by` → no 500, filter-options distinctness, non-admin → 403, and the soft-delete interactions (removed member excluded from count; removed Primary excluded from PM filter/sort/filter-options).
- Frontend `ProjectsTab.test.tsx`: renders `data.items`, debounced search issues one query + resets page, dropdowns fed from filter-options, pagination uses server `total`.

## Risks

- **Correlated subquery sort cost** — sorting by pm_name / member_count / reports_to_name evaluates a subquery per matching row during the sort. Fine at hundreds-to-low-thousands of projects; if an org ever has 10k+ projects and sorts by these columns often, revisit with denormalized columns or a materialized join.
- **Offset window shift** — same low-write caveat as the prior PRs; project create/delete/complete is infrequent. Non-issue.
- **`include_completed` param removed** — replaced by `status`. The only caller (ProjectsTab via useAdminProjects) was updated; no other consumer (confirmed by grep).

## Pagination arc complete

| PR | Endpoint | Notable |
|---|---|---|
| calibration (21) | `/annual-reviews/calibration` | pattern-setter: `Page[T]` + `PaginationParams` + filter-options |
| users (22) | `/admin/users` | split paginated table vs `/all` for pickers; `mentor_name` self-join |
| team-goals (23) | `/goals/team` | dual-view; Bulk Approve across pages; filter-options |
| projects (36) | `/projects` | correlated-subquery sort; page-scoped member/PM resolution; soft-delete-aware |

The reusable primitives (`Page[T]` + `PaginationParams` backend; `Page<T>` +
`PageQuery` + `TablePagination` + `useDebounce` frontend) are now
battle-tested across four endpoints — any future list endpoint can adopt
them in a few LOC.

## Related artifacts

- Prior pagination PRs: `docs/optimizations/21`–`23`.
- Reusable primitives: `backend/app/schemas/pagination.py`, `frontend/src/services/pagination.ts`.
- Soft-delete this reconciles with: `docs/optimizations/35-project-member-soft-delete.md`.
