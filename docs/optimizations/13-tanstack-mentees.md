# Phase D step 4 — Mentees domain migration

> Fourth TanStack migration. Read-only domain with two endpoints, but
> the cross-domain invalidation wiring is the interesting part: every
> goals / annual-reviews / project-reviews mutation now refreshes the
> mentor's MenteeDetail view automatically.

## What was migrated

Both server-state reads in the mentees domain. Plus the cross-domain
invalidation chains that make the monolithic MenteeDetail aggregate
stay fresh after writes in *other* domains.

### Reads (2 hooks)
- `GET /mentees/summary` → `['mentees', 'list']`
- `GET /mentees/{id}/detail` → `['mentees', id, 'detail']`

**Forward-compatible key shape.** The id sits *before* the resource
discriminator in the detail key, so when Phase E1 splits the
monolithic `GET /mentees/{id}/detail` into sub-resources, the new
queries slot in naturally:
- `['mentees', id, 'goals']`
- `['mentees', id, 'reviews']`
- `['mentees', id, 'projects']`

Top-level `['mentees']` invalidation broadcast still catches all of
them — consumers won't need to change when E1 lands.

### Mutations
**None.** The mentees domain is read-only — every status change is
owned by goals / annual-reviews / project-reviews.

### Cross-domain invalidation (the real win)

Every mutation that affects data displayed inline in MenteeDetail
now invalidates `['mentees']` as part of its success broadcast. That
replaces the manual `onReload()` callback chain that previously
propagated writes back up to MenteeDetail.

| Domain | Status-changing helper | Draft helper |
|---|---|---|
| goals | `invalidateGoalsAndDashboard` (now also `['mentees']`) | `invalidateGoalDrafts` (new — `['goals']` + `['mentees']`) |
| annual-reviews | `invalidateAnnualReviewsAndDashboard` (now also `['mentees']`) | `invalidateAnnualReviewDrafts` (new — `['annual-reviews']` + `['mentees']`) |
| project-reviews | `invalidateProjectReviewsAndDashboard` (now also `['mentees']`) | `invalidateProjectReviewDrafts` (new — `['project-reviews']` + `['mentees']`) |

The broadcast only refetches **active** queries — if the mentor isn't
currently on a MenteeDetail page, invalidating `['mentees']` is a
no-op at the network layer. So this is cheap correctness.

## Files changed

### New
- [frontend/src/queries/mentees.ts](../../frontend/src/queries/mentees.ts) — 2 read hooks + key constants + `invalidateMentees(qc)` helper.
- [docs/optimizations/13-tanstack-mentees.md](./13-tanstack-mentees.md) — this note.

### Refactored (5 files)
- [pages/MyMentees.tsx](../../frontend/src/pages/MyMentees.tsx) — dropped local `mentees` / `isLoading` / `error` state + the `useEffect` fetch. One hook call replaces all of it.
- [pages/MenteeDetail.tsx](../../frontend/src/pages/MenteeDetail.tsx) — dropped the entire `loadDetail` / `reloadDetail` callback machinery (~30 LOC). Mutation onSuccess invalidation now drives refetches. EvalDrawer submit/save-draft handlers no longer call `reloadDetail()` after the mutation.
- [components/mentees/MenteeGoalsTab.tsx](../../frontend/src/components/mentees/MenteeGoalsTab.tsx) — dropped `onReload` prop and the calls into it inside `handleApprove` / `handleSendFeedback`.
- [components/mentees/MenteeProjectsTab.tsx](../../frontend/src/components/mentees/MenteeProjectsTab.tsx) — dropped `onReload` prop and all four `onReload()` call sites inside the PM/Secondary submit + draft handlers.
- [queries/goals.ts](../../frontend/src/queries/goals.ts), [queries/annualReviews.ts](../../frontend/src/queries/annualReviews.ts), [queries/projectReviews.ts](../../frontend/src/queries/projectReviews.ts) — each now imports `invalidateMentees` and threads it through both helpers (status-changing + draft).

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/my-mentees` | 1× `GET /mentees/summary` (×2 in dev StrictMode) | **1×** |
| Cold load `/my-mentees/:id` | 1× `GET /mentees/{id}/detail` (×2 in dev StrictMode) | **1×** |
| Approve a mentee's goal from MenteeDetail | 1× PATCH + manual `reloadDetail()` = 1× full mentee-detail refetch | 1× PATCH + automatic refetch via `['mentees']` invalidation |
| Save PM eval draft on a mentee's project | 1× PATCH + 1× explicit `getDetail` reload | 1× PATCH + automatic refetch |
| Submit annual review for mentee | 1× POST + 1× explicit `getDetail` reload | 1× POST + automatic refetch (now driven by `['mentees']` invalidation in annualReviews.ts) |
| Open MenteeDetail → switch tabs (Summary → Goals → Projects) | No re-fetches (data already loaded) | **Same — 0 requests**. All tabs read from the same cached aggregate. |
| Navigate from MyMentees → MenteeDetail → back to MyMentees | `GET /mentees/summary` re-fetched on return | **0 requests on return** (cache hit within staleTime) |

### Behaviour preserved
- **Silent reload UX** — the old code used `loadDetail({ silent: true })` after mutations so the skeleton wouldn't flash. TanStack's default `placeholderData` behaviour gives the same effect: `data` stays populated while `isFetching` is true, so tab content keeps rendering during the refetch.
- **Page title override** still tracks `data.full_name` via `usePageTitleOverride`.
- **404 handling** still surfaces "This mentee is not assigned to you or doesn't exist." — extracted from `(queryError as { response?: { status?: number } }).response.status === 404`.

### LOC removed
- `MenteeDetail.tsx`: ~30 LOC (the entire `loadDetail` / `reloadDetail` callback + the local `data`/`isLoading`/`error` state machine).
- `MyMentees.tsx`: ~18 LOC (the `useEffect` + cancellation guard pattern).
- `MenteeGoalsTab.tsx`, `MenteeProjectsTab.tsx`: a handful of `onReload()` call sites + one prop each.

### Bundle delta

| Asset | Pre (D3) | Post (D4) |
|---|---|---|
| Shared `index-*.js` | 217.36 kB / 68.06 kB gzip | **217.42 kB / 68.09 kB gzip** *(+30 bytes gzip — cross-domain invalidation helpers)* |
| `MenteeDetail-*.js` | 56.49 kB / 12.83 kB gzip | **56.12 kB / 12.68 kB gzip** *(−150 bytes gzip — loadDetail removed)* |
| `MyMentees-*.js` | 13.17 kB / 3.46 kB gzip | **13.03 kB / 3.40 kB gzip** *(−60 bytes gzip)* |
| New `mentees-*.js` chunk | — | **0.41 kB / 0.27 kB gzip** *(queries module, lazy-loaded with pages)* |

**Net: ~−10 bytes gzip.** Effectively flat, with cleaner data flow.

## Verification

### Functional
1. **Cold-load `/my-mentees`** → exactly 1× `GET /mentees/summary` (was 2× in dev StrictMode).
2. **Click a mentee card → MenteeDetail loads** → 1× `GET /mentees/{id}/detail`.
3. **Switch tabs (Summary → Goals → Projects → Review)** → 0 requests. All tabs read from cache.
4. **Goals tab → approve a goal** → 1× PATCH + automatic `GET /mentees/{id}/detail` refetch + `GET /dashboard/summary` refetch. Goal row updates after refetch lands.
5. **Goals tab → request changes** → same shape: 1× PATCH + automatic refetches.
6. **Projects tab → save PM eval draft** → 1× PATCH + auto refetch.
7. **Projects tab → submit PM eval** → 1× POST + auto refetches (mentee detail + dashboard + project-reviews).
8. **Annual Summary tab → Fill Annual Review → save draft** → 1× PATCH + auto refetch; "Draft saved" pill appears after refetch.
9. **Annual Summary tab → submit annual review** → 1× POST + auto refetches; status pill flips to "Reviewed".
10. **Navigate to `/my-mentees` → back to `/my-mentees/:id`** → both cache hits, 0 requests.

### Behaviour change worth flagging
**Mutation feedback latency** — same trade-off as the prior D1–D3 migrations. With strict invalidate-only, UI updates after the refetch returns (~150–300 ms) instead of via an immediate setState. Most visible on the goal-approval flow where the row used to update synchronously.

## Risks / known limitations

- **`GET /mentees/{id}/detail` is still monolithic.** This migration deliberately keeps the existing response shape. Phase E1 will split it into sub-resources; the forward-compatible key shape (`['mentees', id, 'detail']`) means the split can land without changing any consumer.
- **`['mentees']` is invalidated broadly.** Every goals / annual-reviews / project-reviews write triggers it, even when no MenteeDetail is mounted. That's intentional — invalidating an inactive query is essentially free, and the alternative (per-mentee-id targeting) requires passing the mentee id through every mutation's `onSuccess`, which is a much larger surface change for no real benefit.
- **The on-demand `projectReviewService.getReview(reviewId)` call inside `MenteeProjectsTab.handleWriteImpact`** stays as a direct service call. Same one-shot pattern flagged in D3 — it feeds a local modal state, not the cache.

## Pattern reinforced

Same shape as `src/queries/users.ts`, `goals.ts`, `annualReviews.ts`, `projectReviews.ts`:
- One module per domain, strict tuple keys, top-level invalidation broadcast.
- Cross-domain helper exported from the consumer side (`invalidateMentees`) and imported by the writing domains.
- Drafts narrowly invalidate the domain + mentees only; submits invalidate dashboard too.
- Forward-compatible key shape when a backend split is planned.

## Related artifacts

- Phase D step 1 (goals): [10-tanstack-goals.md](./10-tanstack-goals.md)
- Phase D step 2 (annual reviews): [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md)
- Phase D step 3 (project reviews): [12-tanstack-project-reviews.md](./12-tanstack-project-reviews.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
- Forward link: Phase E1 (mentee detail split) — will add per-sub-resource hooks to `mentees.ts` without changing any current consumer.
