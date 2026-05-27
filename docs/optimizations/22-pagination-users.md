# Pagination PR 2 — Server-side /admin/users (the scaling win)

> Second backend pagination PR, following the pattern set by PR 1
> (calibration). The user directory is the list that grows linearly
> with org headcount, so it's the highest-value pagination target.
> The wrinkle this PR solves: `useUsers()` was shared between the
> table (wants pagination) and the pickers (want the full list).

## Context

`/admin/users` returned the entire org directory in one shot;
`UsersTab` then filtered / sorted / sliced it client-side. That's
fine at 50 users, linear pain at 5,000. PR 2 moves the table fully
server-side using the reusable `Page[T]` envelope + `PaginationParams`
dependency from PR 1.

**The shared-consumer problem:** `useUsers()` had three callers —
`UsersTab` (table), `UserCombobox` (type-to-filter picker), and
`ProjectsTab` (PM / secondary-evaluator picker via the modal). The
pickers need the *full* list in memory to filter-as-you-type without a
request per keystroke. So this PR splits the data source in two:

- `GET /admin/users` → **paginated** `Page[UserResponse]` (table only).
- `GET /admin/users/all` → **non-paginated** full list (pickers only).

`useUsers()` keeps its identity and `["users"]` key but now hits
`/all`; the table gets a new `useUsersPage(params)`. Both share the
`["users"]` cache prefix, so the existing mutation invalidations
(`useCreateUser` / `useUpdateUser` / `useDeactivateUser` /
`useReactivateUser`, all invalidate-only) refresh pickers AND table in
one shot — no mutation-side changes.

## What changed

### Backend (`admin_routes.py`, `admin_schemas.py`)

- `UserResponse` gains **`mentor_name: Optional[str]`**. The table previously resolved the mentor's name client-side by `users.find(u => u.id === mentor_id)` over the full list — which breaks under pagination (the mentor often isn't on the current page). The paginated route now resolves it via a self-join and injects it onto each row.
- `GET /admin/users` → `Page[UserResponse]`. Accepts `page`, `per_page`, `search`, `role`, `status` (active/inactive/all), `department_id`, `designation_id`, `sort_by`, `sort_dir`. Aliased joins (Mentor self-join, Department, Designation) power server-side filter/search/sort. `COUNT(*)` via `with_entities(func.count(User.id))` so the multi-entity select doesn't confuse the count. Stable `User.id` sort tiebreaker; unknown `sort_by` → default `created_at desc` (never 500s).
- `GET /admin/users/all` → `List[UserResponse]` — the prior full-list behaviour, for pickers. Resolves `mentor_name` via the same self-join as the paginated route, so both endpoints return an identical, fully-populated `UserResponse` (no field-completeness drift).

Department/designation **filter options need no new endpoint** — UsersTab already receives `departments` + `designations` as props (from AdminPanel's `useDepartments()` / `useDesignations()` reference-data queries). The filter dropdowns send `department_id` / `designation_id`, matched directly on `User.department_id` / `designation_id`.

### Frontend

- `admin.service.ts`: `UserResponse.mentor_name`; new `UserQuery extends PageQuery` (adds role/status/department_id/designation_id); `getUsers()` now hits `/admin/users/all`; new `getUsersPage(params)`.
- `queries/users.ts`: `useUsers()` unchanged (key `["users"]`, pickers). New `useUsersPage(params)` keyed `["users", "page", params]` with `keepPreviousData`. Both under the `["users"]` prefix so mutation invalidations cover both.
- `UsersTab.tsx`: dropped all client-side filter/sort/slice + the `USERS_SORT_CONFIG`. Builds a `UserQuery` from state, renders `data.items`. The search box is parent-controlled (`searchQuery` prop), so it's debounced **locally** (300 ms) into `debouncedSearch` before feeding the query. Mentor column reads `user.mentor_name`. `TablePagination` fed `data.total`. Page resets to 1 on filter/sort/pageSize/search change (not on Next/Prev). Subtle `opacity-60` + `aria-busy` during `isFetching`.

`UserCombobox` and `ProjectsTab` are **unchanged** — they still call `useUsers()`, which transparently now serves `/admin/users/all`.

## Outcomes

| Scenario | Before | After |
|---|---|---|
| Cold load Users tab (2,000-user org) | 1 request, ALL 2,000 rows (~250 kB raw) | 1 request, 25 rows (~4 kB raw) |
| Search / filter / sort | Instant client-side over the full set | 1 debounced/immediate request; SQL filter+sort |
| Change page | Client-side slice | 1 request for the offset; previous page stays visible |
| Open a picker (ProjectModal PM select) | `/admin/users` (all) | `/admin/users/all` (all) — unchanged behaviour |
| Create / edit / deactivate a user | Mutation + full-list refetch | Mutation + refetch of visible page AND picker list (shared `["users"]` prefix) |

The win scales: a 10,000-user org transfers 25 rows/page instead of
10,000. The pickers still fetch all (unchanged) — acceptable because
they're admin-only modals; if those ever hurt at scale, PR-future can
convert UserCombobox to server-search.

## Test Cases (manual, pre-merge)

Run as an Admin.

### Backend contract
1. Restart backend. `GET /api/v1/admin/users?page=1&per_page=10` → `{ items:[≤10], total:N, page:1, per_page:10 }`. Each item has `mentor_name` populated (or null if no mentor).
2. `?page=2&per_page=10` → next 10, no overlap.
3. `?search=<name/email/code fragment>` → filtered; `total` reflects it.
4. `?role=Admin`, `?status=inactive`, `?department_id=<id>`, `?designation_id=<id>` → each filters correctly; combinable.
5. `?sort_by=mentor_name&sort_dir=asc` → ordered by mentor name (self-join). `?sort_by=department_name`, `?sort_by=status` → likewise. `?sort_by=garbage` → no 500; created_at order.
6. `?per_page=500` → 422 (capped at 100).
7. `GET /api/v1/admin/users/all` → full list (every user, no envelope), `mentor_name` null. Non-admin → 403 on both endpoints.

### Frontend — Users tab
8. AdminPanel → Users tab. Network: 1× `/admin/users?page=1&per_page=25`. Table renders page 1; pagination shows "N Records / Page 1 of …".
9. Type in search → exactly 1 request ~300 ms after you stop; page resets to 1.
10. Role / Status / Department / Designation dropdowns → 1 request each; dropdowns still list every option (they come from reference-data props, not the page).
11. Sort each sortable column (Employee, Email, Mentor, Department, Designation, Status) → 1 request; rows reorder; previous rows stay visible (dimmed) during fetch.
12. Mentor column shows the correct mentor name for users whose mentor is NOT on the current page (this is the key fix — server-resolved `mentor_name`).
13. Next / Prev / change "Rows per page" → correct paging; pageSize change resets to page 1.
14. Edit a user (pencil) → save → current page refetches with the change; the picker list also refreshes (shared prefix).
15. Deactivate / reactivate → row updates after refetch; status filter still works.
16. Empty states: nonsense search → "No users match your filters."; (fresh org) → "No users yet."

### Pickers unaffected
17. Open ProjectModal (Create Project) → PM and Secondary Evaluator comboboxes list ALL active users, type-to-filter works instantly (no per-keystroke request). Network shows `/admin/users/all` fired once (cached).
18. Open UserModal (Add/Edit user) → mentor picker lists all users, filters instantly.
19. Create a user via the modal → both the picker list and the Users table page refresh.

### Regression
20. `npm run build` passes; backend `python -c "import main"` passes.

## Risks

- **Offset window shift** — same low-write caveat as PR 1; user create/deactivate is infrequent and doesn't reorder existing rows mid-paging. Non-issue here.
- **Pickers still fetch all users** — intentional. UserCombobox needs the full set for client-side filtering. At extreme org sizes this could be revisited (server-search), but it's admin-only and not on the hot path.
- **`mentor_name` resolved on both routes** — originally `/all` left it null (pickers don't display it), but that left the two endpoints returning the same schema with different completeness — a footgun for any future consumer. Both now resolve it via the self-join for an identical shape; the extra LEFT JOIN on `/all` is negligible.

## Next candidates (from the risk-assessment plan)

- **PR 3 — `/goals/team`** (only if mentor team sizes grow; Bulk Approve selection semantics under pagination need a decision).
- **PR 4 — `/projects`** (needs the PM/count subquery refactor first).
- Deferred: `/feedback-360/peers` (virtualized), `/mentees/summary` (small), `/project-reviews/pm-queue` (SQL-first refactor needed).

## Related artifacts

- PR 1 (calibration, pattern-setter): `docs/optimizations/21-pagination-calibration.md`
- Reusable primitives: `backend/app/schemas/pagination.py`, `frontend/src/services/pagination.ts`
- Risk-assessment + prioritization: plan file `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
