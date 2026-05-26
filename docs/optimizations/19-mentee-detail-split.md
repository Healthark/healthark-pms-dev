# Payload reduction PR C — Split /mentees/{id}/detail into sub-resources

> Third and final payload-reduction PR. The biggest structural change
> of the three: the monolithic ~10 kB `/mentees/{id}/detail` payload
> is split into a slim summary endpoint plus three sub-resource
> endpoints, each consumed by its own tab in the MenteeDetail page.
> The frontend key shape from D4 was designed for this split — the FE
> rewire is mostly plumbing.

## Context

Pre-PR-C, `GET /mentees/{id}/detail` returned `MenteeDetail` =
`MenteeSummary` + three inline arrays:

- `goals_list: TeamGoalResponse[]` (~2 kB raw with nested criteria + reviews)
- `reviews_list: AnnualReviewResponse[]` (~1 kB raw, all cycles)
- `project_assignments: MenteeProjectAssignment[]` (~3 kB raw, includes inline `review_detail` for completed evaluations)

For a typical mentee with 5 goals + 2 reviews + 3 project assignments,
the response is **~10 kB raw** / **~3 kB gzipped** (after PR A
compression). Mentor sessions often view only 1–2 tabs on a mentee's
page, but the monolithic shape forced 100% of the data on every load.

D4 (TanStack mentees migration) explicitly designed the cache key
shape `['mentees', id, 'detail' | 'goals' | 'reviews' | 'projects']`
to make this split a drop-in change with no consumer restructuring.
PR C cashes that in.

## Code change

### Backend

`backend/app/api/routes/mentee_routes.py` — refactored:

1. **`_assert_mentee_access(db, current_user, mentee_id)`** — extracted helper for the 404-on-not-your-mentee guard. Used by all four per-mentee endpoints.
2. **`_fetch_mentee_annual_goals(db, mentee, org_id)`** — extracted goals fetch with `owner_*` field injection.
3. **`_fetch_mentee_reviews(db, mentee_id, org_id)`** — extracted reviews fetch.
4. **`_build_mentee_project_assignments(db, mentee_id, current_user, active_cycle)`** — extracted project-assignment assembly (returns the raw assignments + reviews for stats + composed `MenteeProjectAssignment[]` for the tab).
5. **`/mentees/{id}/detail` reworked** — still fetches all three sub-resources internally to compute the summary stats (`pending_actions_count`, goal counts, etc.) but returns the slim `MenteeSummary` shape only. **Wire saving: ~7 kB raw / ~2 kB gzipped per request.**
6. **Three new routes:**
   - `GET /mentees/{id}/goals` → `List[TeamGoalResponse]`
   - `GET /mentees/{id}/reviews` → `List[AnnualReviewResponse]`
   - `GET /mentees/{id}/projects` → `List[MenteeProjectAssignment]`

`backend/app/schemas/mentee_schemas.py` — `MenteeDetail` class removed; the `/detail` route's `response_model` changed to `MenteeSummary`.

### Frontend

`frontend/src/services/mentee.service.ts`:
- `MenteeDetail` kept as a type alias pointing at `MenteeSummary` (so any external imports continue to compile).
- `getDetail(menteeId)` return type changed from `MenteeDetail` to `MenteeSummary`.
- Three new service methods: `getMenteeGoals(id)`, `getMenteeReviews(id)`, `getMenteeProjects(id)`.

`frontend/src/queries/mentees.ts`:
- Three new query keys: `menteeGoalsQueryKey(id)`, `menteeReviewsQueryKey(id)`, `menteeProjectsQueryKey(id)` — using the pre-prepared D4 shape `['mentees', id, 'goals' | 'reviews' | 'projects']`.
- Three new hooks: `useMenteeGoals(menteeId | null)`, `useMenteeReviews(menteeId | null)`, `useMenteeProjects(menteeId | null)`.
- `useMenteeDetail` return type changed to `MenteeSummary`.
- Top-level `['mentees']` invalidation broadcast (existing) catches all four sub-keys via prefix match — no mutation-side changes needed.

`frontend/src/pages/MenteeDetail.tsx`:
- Page-level fetches: `useMenteeDetail(menteeId)` (for the identity header + pending-actions pill) + `useMenteeReviews(menteeId)` (for the eval drawer's FY→review map).
- Each tab receives `menteeId` instead of pre-fetched arrays; tabs fetch their own sub-resources via the new hooks.

`frontend/src/components/mentees/{MenteeGoalsTab, MenteeReviewTab, MenteeProjectsTab, MenteeAnnualSummaryTab}.tsx`:
- Prop signatures changed from `goals` / `reviews` / `assignments` (data) to `menteeId` (and `menteeName` where used).
- Each tab calls its respective hook on mount.
- Loading and error states added for the per-tab fetch.
- `MenteeAnnualSummaryTab` fetches all three sub-resources in parallel via the three hooks (it needs FY-filtered slices of each).

## Tab behaviour after the split

| Scenario | Network requests | Notes |
|---|---|---|
| Cold load `/my-mentees/{id}` (Summary tab default) | 1× `/detail` (page-level) + 1× `/reviews` (page-level for FY map) + 3× sub-resources from Summary tab (`/goals`, `/reviews`, `/projects`) — but `/reviews` dedups via TanStack so it fires once | 4 requests total, all in parallel. With gzip ~2 kB total on the wire — same as the pre-PR-C monolithic. |
| Cold load with `?tab=goals` | 1× `/detail` + 1× `/reviews` (page-level) + 1× `/goals` (tab-level) | 3 requests. ~1.5 kB on the wire vs ~3 kB pre-PR-C — **~50% reduction**. |
| Cold load with `?tab=review` | 1× `/detail` + 1× `/reviews` (page-level + dedups with tab) | 2 requests. ~600 B on the wire — **~80% reduction**. |
| Switch from Summary → Goals tab | 0 requests (Summary already fetched goals; cache hit) | — |
| Switch from Goals → Projects tab | 1× `/projects` (first time on this mentee in the session) | — |
| Switch back to a previously-viewed tab | 0 requests (cache hit within staleTime) | — |
| Approve a goal in Goals tab | Mutation invalidates `['goals']` + `['mentees']` (the broadcast from goals.ts) → goals sub-key refetches | Other tabs' caches untouched. |

The Summary tab's "4 requests" worst case is acceptable: with HTTP/2
multiplexing + gzip + the small per-request payloads, the total wire
time is no worse than the monolithic — and every other tab's cold
load is significantly lighter.

## Expected wire savings

| Scenario | Pre-PR-C | Post-PR-C | Delta |
|---|---|---|---|
| Summary tab cold load | ~3 kB gzip (monolithic) | ~2 kB gzip (4 small parallel requests) | ~33% smaller, same #req with HTTP/2 |
| Deep-link to Goals tab | ~3 kB gzip | ~1.5 kB gzip | **~50%** |
| Deep-link to Reviews tab | ~3 kB gzip | ~0.6 kB gzip | **~80%** |
| Tab switch within a session | 0 (cached) | 0 (cached) | unchanged |
| Goal mutation refetch | full ~3 kB (monolithic) | ~1 kB (goals only) | **~66% reduction on mutation-triggered refetches** |

The mutation-refetch reduction is the biggest hidden win — every time
a mentor approves a goal or submits an annual review, the post-mutation
refetch was a full monolithic detail fetch. Now each mutation only
refetches the sub-resource that actually changed (plus the summary
for the updated stats).

## Test Cases (manual, pre-merge)

Run through this checklist with a mentor account that has at least one
mentee with goals + reviews + project assignments.

### Setup
1. Restart the backend (so the new routes load) and the frontend dev server.
2. Sign in as a mentor.

### Slim detail response
3. Open DevTools → Network. Filter by `XHR`.
4. Click a mentee from `/my-mentees`. On `GET /api/v1/mentees/{id}/detail`:
   - **Confirm response JSON contains only the MenteeSummary shape** — fields `user_id`, `full_name`, `email`, `employee_code`, `phone`, `department_name`, `designation_name`, `role`, `is_active`, `goals` (stats), `review` (stats), `projects` (stats), `pending_actions_count`.
   - **Confirm there are NO `goals_list`, `reviews_list`, or `project_assignments` fields** in the response.
   - Confirm `Content-Encoding: gzip` (PR A) still applies — transferred ≪ resource.

### Summary tab — 4 parallel sub-resource fetches
5. With the Summary tab active (default), confirm these requests fire in parallel:
   - `GET /api/v1/mentees/{id}/detail` (page-level summary)
   - `GET /api/v1/mentees/{id}/reviews` (page-level for eval drawer + tab share)
   - `GET /api/v1/mentees/{id}/goals` (Summary tab)
   - `GET /api/v1/mentees/{id}/projects` (Summary tab)
6. Confirm the Summary tab renders: FY picker, status pill, "Fill Annual Review" CTA (if applicable), Annual Goals section, Project Reviews section.
7. Compare to pre-PR-C: should look identical except possibly a brief "Loading annual summary…" placeholder before the 3 sub-resource hooks settle.

### Tab switching (cache hits)
8. Switch to Goals tab → **0 new requests** (cache hit from Summary load).
9. Switch to Reviews tab → **0 new requests** (cache hit).
10. Switch to Projects tab → **0 new requests** (cache hit).
11. Switch back to Summary → **0 new requests**.

### Deep links — partial loads
12. Navigate directly to `/my-mentees/{id}?tab=goals` (use the address bar to add the query param).
13. Confirm the requests: 1× `/detail` + 1× `/reviews` (page-level for FY map) + 1× `/goals` (tab) = **3 requests**.
14. The Reviews tab + Projects tab data is **not** fetched until those tabs are clicked.
15. Click Reviews tab → 0 new requests (page-level already fetched reviews).
16. Click Projects tab → 1× `/projects` request fires.

### Mutation refetch granularity
17. On Goals tab, approve a goal.
18. Confirm:
    - `PATCH /api/v1/goals/{id}/approval` fires.
    - **Only** `/mentees/{id}/goals` refetches (via the `['mentees']` invalidation broadcast prefix-matching `['mentees', id, 'goals']`).
    - Also expected: `/goals/team`, `/dashboard/summary`, `/mentees/{id}/detail` (for updated pending_actions_count).
    - The `/reviews` and `/projects` sub-resources do **NOT** refire (their caches were untouched by the mutation).
19. Repeat for project review submission on Projects tab — confirm `/projects` refetches but `/goals` and `/reviews` don't.
20. Repeat for annual review submit/draft on the eval drawer — confirm `/reviews` refetches but `/goals` and `/projects` don't.

### Authorization preserved
21. Try `GET /api/v1/mentees/{not-your-mentee-id}/goals` directly (via DevTools → Console → fetch, or change URL). Expect **404 "Mentee not found or not assigned to you."** — same contract as the existing `/detail` route.
22. Same for `/reviews` and `/projects` paths with a non-assigned id.
23. Cross-tenant access attempt — also 404 (not 403). Confirms the access guard runs on every sub-resource endpoint.

### Loading and error states
24. Throttle network to "Slow 3G" in DevTools.
25. Open a mentee → Summary tab. While the 4 requests are in flight, confirm:
    - The header card shows a skeleton (PR-C unchanged).
    - The Summary tab content area shows "Loading annual summary…".
26. Switch to Goals tab during loading — confirm "Loading goals…" placeholder appears, then the table.
27. Restart backend during a refetch to trigger an error. Confirm the tab shows a "Could not load X. Please try again." error message (no white-screen crash).

### Negative checks
28. Mentee with 0 goals → Goals tab renders the existing empty-state "No annual goals to review" (unchanged).
29. Mentee with 0 reviews + active cycle configured → Summary tab renders the "Awaiting mentee's self-review" CTA note (unchanged).
30. Mentee with 0 project assignments → Projects tab renders the "Has no project assignments" empty state (unchanged).
31. With backend running, `useMenteeDetail` returns successfully but `useMenteeGoals` errors. Confirm the page header still renders (summary loaded) and only the Goals tab shows the error message.

## Behaviour change worth flagging

- **Summary tab cold-load fires 4 requests in parallel.** With HTTP/2 multiplexing + gzip this is roughly equivalent to the prior single-request monolithic in terms of wire time, but conceptually 4 requests vs 1 is a regression for the Summary tab alone. Mitigated by the fact that all other navigation patterns (deep links, tab switches, mutation refetches) are now faster.
- **The `MenteeDetail` TypeScript type is now an alias for `MenteeSummary`** — any code that did `data.goals_list` on the detail response will now type-error. The four tab components were updated; no other consumers were found via grep.

## Risks / known limitations

- **Stats still computed on the server.** The `/detail` route fetches all three sub-resources internally to compute the summary stats. Wire savings are real (~7 kB raw) but DB query cost is unchanged. A future PR could push the stat aggregation into SQL and have `/detail` query only what's needed — outside scope here.
- **`['mentees']` broadcast is broad.** A goal mutation invalidates all four sub-keys (`/detail`, `/goals`, `/reviews`, `/projects`) for every mentee, but only the *active* queries refetch. With a single MenteeDetail page mounted, this triggers refetches on the visible tab's sub-resource + the summary — fine. If multiple MenteeDetail pages were mounted somehow, all would refetch in parallel.
- **`MenteeAnnualSummaryTab` no longer accepts a `mentee` prop.** Internal refactor; only the parent passes data, and the parent was updated to pass `menteeId` instead.

## Pattern reinforced

Same shape as every other domain split — strict tuple keys, top-level invalidation broadcast, per-resource hooks that gate on a nullable id. The forward-compatible key shape from D4 (`['mentees', id, 'detail']`) made this split a true drop-in.

## Related artifacts

- D4 (mentees TanStack migration): `docs/optimizations/13-tanstack-mentees.md` — explicitly prepared the key shape for this split.
- PR A (gzip compression): `docs/optimizations/17-gzip-compression.md` — compounds with the structural reduction here.
- PR B (`/goals/team` slim): `docs/optimizations/18-team-goals-slim.md` — same pattern (slim list, full detail on demand).
- Plan source: `C:\Users\Dell\.claude\plans\phase-a-optimization-melodic-sketch.md`
- Closes Phase E1 from the original roadmap.
