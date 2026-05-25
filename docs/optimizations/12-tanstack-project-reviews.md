# Phase D step 3 — Project Reviews domain migration

> Third TanStack migration. Most complex of the remaining domains —
> includes a custom reducer-based hook (`useReviewDetails`) that gets
> deleted entirely.

## What was migrated

Every server-state read and write in the project-reviews domain. This
covers the PM evaluation flow, secondary evaluator flow, mentor-driven
mentee evaluations from MenteeDetail, the admin management view, and
the per-review detail panel/expanded-row.

### Reads (7 hooks)
- `GET /project-reviews/mine` → `['project-reviews', 'mine']`
- `GET /project-reviews/pm-queue` → `['project-reviews', 'pm-queue']`
- `GET /project-reviews/secondary-queue` → `['project-reviews', 'secondary-queue']`
- `GET /project-reviews/role-expectations` → `['project-reviews', 'role-expectations']` (**15-min staleTime** — reference data)
- `GET /project-reviews/{id}` → `['project-reviews', 'detail', id]` (replaces `useReviewDetails`)
- `GET /project-reviews/all` → `['project-reviews', 'all']` (admin)
- `GET /project-reviews/management?cycle=…` → `['project-reviews', 'management', cycle]` (admin)

### Mutations (6 hooks)
- `useSubmitPMEvaluation`, `useSavePMDraft`, `useUpdateReview`
- `useSubmitSecondaryEval`, `useSaveSecondaryDraft`, `useUpdateSecondaryEval`

Every status-changing mutation (submit, update) invalidates both
`['project-reviews']` AND `['dashboard', 'summary']` — the dashboard
counters for `project_reviews_pending_primary` /
`project_reviews_pending_secondary` stay fresh automatically. Draft
saves narrowly invalidate `['project-reviews']` only.

## Files changed

### New
- [frontend/src/queries/projectReviews.ts](../../frontend/src/queries/projectReviews.ts) — 7 read + 6 mutation hooks, plus a `useProjectReviewDetail(reviewId)` hook that **replaces the custom `useReviewDetails` reducer hook**.

### Deleted
- [frontend/src/hooks/useReviewDetails.ts](../../frontend/src/hooks/useReviewDetails.ts) — the custom `useReducer + useEffect` data hook is gone. Its consumers (`ReviewDetailPanel`, `TableExpandedRow`) now consume `useProjectReviewDetail(reviewId)` directly with the standard `useQuery` state shape.

### Refactored (7 files)
- [pages/ProjectReviews.tsx](../../frontend/src/pages/ProjectReviews.tsx) — dropped local `cards` / `expectations` / `showEvaluateTab` / `isLoading` state + `loadData` callback. Reads via 4 hook calls; PMQueue/SecondaryQueue used only to gate the Evaluate tab visibility (errors swallowed for non-PM users — `useQuery` returns `[]` default).
- [components/project-reviews/PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) — dropped local state for `pmCards` / `secReviews` / `expectations` / `isLoading` / `isSaving` / `isDraftSaving`. Six mutation hooks drive every save/submit; cache invalidation propagates to ProjectReviews + MenteeProjectsTab automatically.
- [components/project-reviews/SecondaryEvalTab.tsx](../../frontend/src/components/project-reviews/SecondaryEvalTab.tsx) — dropped local `reviews` / `isLoading` / `isSaving` state + `loadReviews` callback.
- [components/project-reviews/ManagementTab.tsx](../../frontend/src/components/project-reviews/ManagementTab.tsx) — dropped local `data` / `isLoading` / `error` state + `loadData` callback. Cycle-keyed query (`['project-reviews', 'management', cycle]`) means switching cycles is a cache hit if the cycle was viewed before.
- [components/project-reviews/ReviewDetailPanel.tsx](../../frontend/src/components/project-reviews/ReviewDetailPanel.tsx) — `useReviewDetails` → `useProjectReviewDetail`. Same loading lifecycle, exposed via `data` / `isPending` / `error`.
- [components/project-reviews/TableExpandedRow.tsx](../../frontend/src/components/project-reviews/TableExpandedRow.tsx) — same swap.
- [components/mentees/MenteeProjectsTab.tsx](../../frontend/src/components/mentees/MenteeProjectsTab.tsx) — dropped `expectations` local state + its fetch effect; six mutations route through hooks; the on-click `getReview` call inside `handleWriteImpact` stays direct (one-shot click action, result goes into local modal state, not the cache).

### Intentionally NOT migrated (scope guard)
- [project-reviews/EvalModal.tsx](../../frontend/src/components/project-reviews/EvalModal.tsx) — already runs its own debounced `useMutation` wrapping the parent's `onSaveDraft` callback (Phase B Task 4). The callback is now backed by `useSavePMDraft` upstream; EvalModal unchanged.
- [project-reviews/ImpactModal.tsx](../../frontend/src/components/project-reviews/ImpactModal.tsx) — receives `onSubmit` / `onSaveDraft` as props from parents; no direct service calls.
- The on-click `getReview` in `MenteeProjectsTab.handleWriteImpact` — see note above; intentional one-shot direct call.

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/project-reviews` (My Reviews tab) | 4× requests for `/mine`, `/role-expectations`, `/pm-queue`, `/secondary-queue` (×2 in dev StrictMode = up to 8) | **1× each** |
| Switch to Evaluate tab | Same 3 endpoints re-fetched | **0** (cache hit; PMEvaluationTab dedups with the page) |
| Open Admin Management Review (project-reviews/management tab) | `/management?cycle=H1 FY26` re-fetched on every cycle dropdown change, including switching back to a previous selection | 1× per unique cycle within `staleTime`; switching back is **0 requests** |
| Submit PM evaluation (PMEvaluationTab) | 1× POST + `loadData()` refetched all 3 endpoints | 1× POST + cache invalidation → only the affected queries refetch, plus dashboard |
| Save PM draft | 1× PATCH + 3× refetch (loadData) | 1× PATCH + 1× refetch on `/pm-queue` (draft scope) |
| Open review detail panel (My Reviews → click card) | 1× GET on every panel open, no cache | 1× then cached across reopens for same `reviewId` |
| Open expanded row in table view of same review | 1× GET (separate from panel) | 0 — **shares cache with the panel** for the same `reviewId` |

The biggest hidden win: **detail panel + expanded row share the cache**. Previously each had its own fetch via the now-deleted reducer hook; opening the panel then collapsing to table view and expanding the same row triggered a second GET. Now they dedup.

### Cross-domain invalidation
Same pattern as D1/D2: every PM/Secondary submit + update mutation invalidates `['dashboard', 'summary']`. Combined with goal + annual-review mutations from prior PRs, the dashboard counters now stay fresh after every status-changing write across the four most-used pages.

### useReviewDetails removal
The custom `useReducer`-based hook (created originally to avoid cascading-render warnings from inline `useState` setters in an effect) is now redundant. TanStack Query's atomic state transitions handle the same constraint without the manual reducer. **Net code removed: 85 LOC.**

### Bundle delta
| Asset | Pre | Post |
|---|---|---|
| Shared `index-*.js` | 217.47 kB / 68.11 kB gzip | **217.36 kB / 68.06 kB gzip** *(slightly smaller — useReviewDetails removed)* |
| `ProjectReviews-*.js` | 43.83 kB / 8.76 kB gzip | **42.82 kB / 8.48 kB gzip** *(smaller — local state machinery dropped)* |
| `MenteeDetail-*.js` | 56.41 kB / 12.78 kB gzip | **56.49 kB / 12.83 kB gzip** *(+50 bytes for the 6 mutation hooks in MenteeProjectsTab)* |
| `AdminPanel-*.js` | 64.00 kB / 14.76 kB gzip | **63.95 kB / 14.75 kB gzip** *(flat — ManagementTab refactor offsets cleanly)* |

**Net: ~−50 bytes gzip.** This migration actually shrunk the bundle thanks to dropping the reducer hook + multiple `useState` chains.

## Verification

### Functional
1. **Cold-load `/project-reviews`** → exactly 1× each `/mine`, `/role-expectations`, `/pm-queue`, `/secondary-queue` in Network tab (was up to 8× in dev).
2. **My Reviews → click a reviewed card** → 1× `GET /project-reviews/{id}`. Panel renders.
3. **Toggle view to Table → expand same row** → **no new request** (cache hit).
4. **My Reviews → click a pending card** → renders "Evaluation Pending" without any GET (we pass `null` to the hook so it stays disabled).
5. **Evaluate Team tab** (PM) → opens without re-fetching `/pm-queue` (shared cache with the page).
6. **PM submits evaluation** → 1× POST + 1× GET `/pm-queue` + 1× GET `/dashboard/summary`. Row updates after refetch.
7. **PM saves draft** → 1× PATCH + 1× GET `/pm-queue` (no dashboard refetch — drafts).
8. **Secondary Eval submit** → 1× POST + queue refetch + dashboard refetch.
9. **MenteeDetail → Projects tab → evaluate** → 1× POST + queue refetch + dashboard refetch. PM queue back on `/project-reviews` reflects the change.
10. **Admin → Management Review tab → switch cycle** → 1× GET per new cycle; switching back to a previously-viewed cycle is **0 requests**.

### Behaviour change worth flagging
**Mutation feedback latency** — same trade-off as the prior D1/D2 migrations. With strict invalidate-only, UI updates after the refetch returns (~150-300 ms) instead of via immediate setState. Most visible on the PM-evaluation submit flow where the queue row used to vanish instantly.

## Risks / known limitations
- **On-click `getReview` in MenteeProjectsTab** stays as a direct service call. It's a one-shot fetch triggered by clicking "Write Impact" that feeds a local modal state. Converting it to `useProjectReviewDetail` would require state-based enabling and useEffect to merge into impactTarget — cleaner to leave as direct.
- **`useRoleExpectations` 15-min staleTime** — role expectations almost never change. If admin tooling ever lets HR edit them mid-session, that admin mutation should `invalidateQueries({ queryKey: roleExpectationsQueryKey })` to refresh consumers.

## Pattern reinforced
Same shape as `src/queries/users.ts`, `goals.ts`, `annualReviews.ts`:
- One module per domain, strict tuple keys, top-level invalidation broadcast.
- Cross-domain helper (`invalidateProjectReviewsAndDashboard`) inside the module.
- Drafts narrowly invalidate the domain only; submits invalidate dashboard too.
- Custom `useReducer`-based hooks → useQuery replacement when the loading lifecycle fits the standard shape.

## Related artifacts
- Phase B foundation: [01-phase-b-results.md](./01-phase-b-results.md)
- Phase D step 1 (goals): [10-tanstack-goals.md](./10-tanstack-goals.md)
- Phase D step 2 (annual reviews): [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
