# Pagination PR 3 — Server-side /goals/team (the complex one)

> Third pagination PR, following PR 1 (calibration) and PR 2 (users).
> The most complex consumer so far: dual-view (grid + table), dynamic
> filter dropdowns, expandable rows, and a Bulk Approve flow that has
> to keep working across pages. The risk-assessment plan flagged this
> as MEDIUM both sides; the bulk-approve semantics were the open
> product decision.

## Context

`GET /goals/team` returned every non-draft goal for all of a mentor's
mentees; `TeamGoalsTab` filtered / sorted / sliced it client-side. PR 3
moves the table fully server-side using the `Page[T]` envelope from
PR 1, while preserving two things that don't fit naive pagination:

1. **Bulk Approve** — must approve *all* pending goals across every
   page (product decision: "all pending across all pages"), so it can't
   be limited to the current page's 25 rows.
2. **Filter dropdowns** (Year, Mentee) — were derived from the
   in-memory full set, which no longer exists once paginated.

## What changed

### Backend (`goal_routes.py`, `goal_schemas.py`)

Three endpoints now back the Team Goals tab:

1. **`GET /goals/team` → `Page[TeamGoalListResponse]`** — paginated table data. Params: `page`, `per_page`, `goal_type`, `search`, `year`, `mentee`, `status`, `sort_by`, `sort_dir`. An aliased `Owner` self-join powers server-side search (title OR owner name), the mentee filter (exact owner name), and owner-name sort. Year filters on `cycle_name ILIKE %year%`; status on `approval_status`. `COUNT(*)` via `with_entities`; stable `Goal.id` tiebreaker; unknown `sort_by` → default `created_at desc`. The `owner_name`/`owner_department_name`/`owner_designation_name` injection (read by `TeamGoalResponse.from_attributes`) runs on the page slice.
2. **`GET /goals/team/filter-options` → `TeamGoalsFilterOptions`** — distinct fiscal years (parsed from `cycle_name`) + mentee names across the mentor's non-draft goals. Populates the Year + Mentee dropdowns.
3. **`GET /goals/team/pending` → `List[TeamGoalListResponse]`** — all goals awaiting mentor action (`pending_approval` + `changes_requested`), **non-paginated**. Feeds the Bulk Approve modal + the toolbar badge. The actionable set is naturally small (most goals are already approved), so returning it un-paginated is safe.

Shared helpers: `_mentee_ids_for`, `_team_goals_base_query` (mentee-scoped + non-draft + owner join), `_inject_owner_fields`. The fy_year sort maps to `cycle_name` (approximate — exact year sort would need SQL substring extraction; not worth it for a rarely-used sort, documented in the route).

### Frontend

- `goal.service.ts`: `TeamGoalQuery extends PageQuery` (+ goal_type/year/mentee/status); `TeamGoalsFilterOptions`; `getTeamGoals(params) → Page<TeamGoal>`; `getTeamGoalsFilterOptions()`; `getPendingTeamGoals()`.
- `queries/goals.ts`: `teamGoalsQueryKey(params)` is now param-keyed; `useTeamGoals(params)` with `keepPreviousData`; `useTeamGoalsFilterOptions()` + `usePendingTeamGoals(goalType, enabled)` (60-s staleTime). The top-level `['goals']` mutation broadcast still prefix-matches every variant — approving/requesting-changes refetches the visible page, the pending set, and the filter options automatically. **Mutations remain invalidate-only** (no optimistic `setQueryData` to break on the new param key).
- `TeamGoalsTab.tsx`: dropped all client-side filter/sort/slice + `TEAM_GOALS_SORT_CONFIG`. Builds a `TeamGoalQuery` from state, renders `data.items` (same dual-view grid/table). Search debounced 300 ms. Year/Mentee dropdowns from filter-options (per-option count badges dropped — can't count without the full set). `pendingApprovalCount` badge + Bulk Approve modal now sourced from `usePendingTeamGoals` (all pending across pages). `TablePagination` fed `data.total`. Page resets to 1 on filter/sort/pageSize change; expanded row collapses on filter/view change. Subtle `opacity-60` + `aria-busy` on the content during `isFetching`.

## Bulk Approve under pagination (the product decision)

**Decision: approve all pending across all pages.** The `BulkApproveModal`
receives `pendingGoals` from `usePendingTeamGoals` — the dedicated
non-paginated actionable set — not the current table page. So a mentor
with pending goals spread across 5 pages still sees and approves all of
them in one modal, exactly as before pagination. After `bulkApprove`,
the `['goals']` broadcast refetches the page, the pending set, and the
filter options.

## Outcomes

| Scenario | Before | After |
|---|---|---|
| Cold load Team Goals (mentor, 200 goals) | 1 request, all 200 rows | 1 request, 25 rows + 1 filter-options + 1 pending (small) |
| Search / filter / sort | Client-side over full set | Debounced/immediate server request; SQL filter+sort |
| Change page (grid or table) | Client-side slice | 1 request; previous page stays visible (dimmed) |
| Bulk Approve | Operated on full in-memory set | Operates on the dedicated pending set (all pages) |
| Approve / request changes | Mutation + full-list refetch | Mutation + refetch of visible page + pending + options |

Scales flat: a 1,000-goal mentor transfers 25 rows/page instead of 1,000.

## Test Cases (manual, pre-merge)

Run as a mentor with several mentees and enough goals to span >1 page.

### Backend contract
1. `GET /api/v1/goals/team?goal_type=annual&page=1&per_page=10` → `{ items:[≤10], total:N, page:1, per_page:10 }`; each item has owner_name + slim review arrays.
2. `?page=2` → next slice, no overlap.
3. `?search=<title or mentee fragment>`, `?year=2026`, `?mentee=<exact name>`, `?status=pending_approval` → each filters; combinable; `total` reflects it.
4. `?sort_by=owner_name&sort_dir=desc`, `?sort_by=title`, `?sort_by=approval_status` → ordered; `?sort_by=fy_year` orders by cycle_name (approx); bad sort_by → created_at, no 500.
5. `GET /goals/team/filter-options?goal_type=annual` → `{ years:[…], mentees:[…] }` distinct across non-draft goals.
6. `GET /goals/team/pending?goal_type=annual` → only pending_approval + changes_requested goals, non-paginated.
7. Mentor with no mentees → `/team` returns empty page, `/filter-options` returns empty arrays, `/pending` returns `[]`.

### Frontend — Team Goals tab (AnnualGoals → Team tab)
8. Cold load → Network: `/goals/team?...page=1`, `/goals/team/filter-options`, `/goals/team/pending`. Table renders page 1; pagination shows total.
9. Search → 1 request ~300 ms after you stop typing; page resets to 1.
10. Year / Mentee / Status dropdowns → 1 request each; dropdowns list every option (from filter-options).
11. Sort each column header (Goal, Mentee, Year, Status) → 1 request; rows reorder; previous rows dimmed during fetch.
12. Toggle Grid ↔ Table → same paginated data renders in both; expanded row collapses on switch.
13. Table: expand a row → description / attachment / feedback / criteria render. Expand persists within the page; collapses when filters/sort/view change.
14. Next / Prev / Rows-per-page → correct paging; pageSize change resets to page 1.
15. **Bulk Approve:** badge shows the true pending count (from `/pending`, not the current page). Open modal → it lists pending goals from **all pages** grouped by mentee. Select some / all → Approve → goals approved; modal closes; table page + pending badge + filter options all refresh.
16. **Approve a single goal** (row action) → goal updates after refetch; pending badge decrements.
17. **Request Changes** on a pending goal → status flips to changes_requested after refetch.
18. **Mentor review** (SelfReviewCycleMenu → modal) on an approved goal → still opens; submit/draft works; the modal fetches full goal detail (PR B's useGoalDetail) so review text is present.
19. Empty states: nonsense search → "No goals match this filter"; mentor with mentees but zero submitted goals → "No annual goals to review".

### Regression
20. `npm run build` passes; backend `python -c "import main"` passes.
21. AnnualGoals "My Goals" tab (useMyGoals) is unaffected — only the Team tab changed.

## Risks

- **fy_year sort is approximate** (sorts on cycle_name). Acceptable — year sort is rarely used and cycle_name orders by year well in practice. Documented in the route.
- **Dropdown count badges dropped** — the Mentee/Status dropdowns no longer show per-option counts (can't compute without the full set). Minor UX change; the filter still works.
- **Three requests on tab load** (page + filter-options + pending) instead of one. filter-options + pending are cached (60-s staleTime) and small; with gzip + HTTP/2 the overhead is negligible, and the page request is now tiny.
- **Bulk Approve sees a slightly different snapshot than the table** — it pulls from `/pending` (all actionable) while the table shows a filtered/paged view. This is intentional (the whole point is to act across pages) and the post-mutation refetch reconciles both.

## Next candidates

- **PR 4 — `/projects`** (needs the PM/member-count subquery refactor first).
- Deferred: `/feedback-360/peers` (virtualized), `/mentees/summary` (small), `/project-reviews/pm-queue` (SQL-first refactor needed).

## Related artifacts

- PR 1 (calibration): `docs/optimizations/21-pagination-calibration.md`
- PR 2 (users): `docs/optimizations/22-pagination-users.md`
- PR B (team-goals slim, the TeamGoalListResponse shape): `docs/optimizations/18-team-goals-slim.md`
- Reusable primitives: `backend/app/schemas/pagination.py`, `frontend/src/services/pagination.ts`
