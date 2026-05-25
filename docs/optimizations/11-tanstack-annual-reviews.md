# Phase D step 2 — Annual Reviews domain migration

> Second of two TanStack migrations in this PR. See sibling [10-tanstack-goals.md](./10-tanstack-goals.md).

## What was migrated

Every server-state read and write for the annual review lifecycle — self-review, mentor evaluation, management calibration.

### Reads
- `GET /annual-reviews/mine/history` → `['annual-reviews', 'mine', 'history']`
- `GET /annual-reviews/mentees` → `['annual-reviews', 'mentees']`
- `GET /annual-reviews/calibration` → `['annual-reviews', 'calibration']`
- `GET /annual-reviews/{id}` → `['annual-reviews', 'detail', reviewId]`

### Mutations (each invalidates `['annual-reviews']` ± dashboard summary)
- `useSubmitSelfReview`, `useCreateSelfDraft`, `useSaveSelfDraft`
- `useSubmitMentorEval`, `useSaveMentorDraft`
- `useSetManagementRating`

Submit and management-rating mutations also invalidate **`['dashboard', 'summary']`** so the dashboard's "My Annual Review" widget reflects status transitions instantly.

## Files changed

### New
- [frontend/src/queries/annualReviews.ts](../../frontend/src/queries/annualReviews.ts)

### Refactored (4 files)
- [pages/AnnualReviews.tsx](../../frontend/src/pages/AnnualReviews.tsx) — dropped `reviews` state + `load` callback. Self-review submit + draft save flow through mutations.
- [pages/MenteeDetail.tsx](../../frontend/src/pages/MenteeDetail.tsx) — mentor-eval submit + save-draft callbacks (used by the right-anchored `EvalDrawer`) route through `useSubmitMentorEval` / `useSaveMentorDraft`.
- [components/admin/ManagementReviewTab.tsx](../../frontend/src/components/admin/ManagementReviewTab.tsx) — calibration grid read switched to `useCalibrationGrid`. Set-management-rating uses `useSetManagementRating`. **Bonus:** the inner `ReviewDetailLoader` switched from its own `useEffect + setState` fetch to `useAnnualReviewDetail(reviewId)` — fixes a stale-data window when a calibration grid update happens while a detail modal is open.
- [components/reviews/TeamReviewTab.tsx](../../frontend/src/components/reviews/TeamReviewTab.tsx) — mentor's mentee-reviews list switched to `useMenteeAnnualReviews()`.

### Intentionally NOT migrated (scope guard)
- [EvalForm.tsx](../../frontend/src/components/reviews/EvalForm.tsx) — already runs its own debounced `useMutation` around the parent's `onSaveDraft` callback (Phase B Task 4). The callback is now backed by the new `useSaveMentorDraft` hook upstream in MenteeDetail; EvalForm itself stays unchanged.
- [SelfReviewTab.tsx](../../frontend/src/components/reviews/SelfReviewTab.tsx) and [MenteeReviewTab.tsx](../../frontend/src/components/mentees/MenteeReviewTab.tsx) — receive reviews via props/context from their parents (AnnualReviews / MenteeDetail). No direct service calls.
- [AnnualReviewDetailModal.tsx](../../frontend/src/components/reviews/AnnualReviewDetailModal.tsx) — receives review as a prop; never calls a service.

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/annual-reviews` (My Reviews tab) | 2× `GET /annual-reviews/mine/history` (StrictMode dev) | **1×** |
| Cold load `/annual-reviews` (Team tab — mentor) | 2× `GET /annual-reviews/mentees` | **1×** |
| Admin opens Management Review tab | 2× `GET /annual-reviews/calibration` | **1×** |
| Open the eye-detail modal on a calibration row | 1× `GET /annual-reviews/{id}` per open | 1× then cached |
| Submit mentor evaluation (MenteeDetail) | 1× PATCH + parent reload | 1× PATCH + invalidation chain — dashboard counter for "annual_reviews_pending_mentor" updates automatically |
| Set management rating (inline) | 1× PATCH + manual `load()` | 1× PATCH + invalidation; calibration grid AND dashboard refresh |
| Mentee saves self-review draft | 1× PATCH + parent reload | 1× PATCH + `['annual-reviews']` invalidation only (dashboard counters unaffected by drafts) |

### Cross-domain invalidation chain
Same pattern as the goals domain — every status-changing mutation (submit, mentor eval, management rating) invalidates **`['dashboard', 'summary']`** in addition to its own domain. Combined with the goals invalidation chain shipped in step 1, the dashboard counters now reflect every write across the most-used pages without manual `refresh` calls.

### Bonus correctness fix (`ReviewDetailLoader`)
The pre-migration code had a known race: if management rating was edited on a calibration row while the detail modal was open for that same review, the modal's content was stale. Now that the detail loader uses `useAnnualReviewDetail(reviewId)` with the same invalidation key, mutations cascade into the open modal automatically.

### Bundle delta
| Asset | Pre | Post |
|---|---|---|
| Shared `index-*.js` | 217.47 kB / 68.11 kB gzip | **217.47 kB / 68.11 kB gzip** (flat) |
| `AnnualReviews-*.js` | 27.58 kB / 5.63 kB gzip | **27.26 kB / 5.49 kB gzip** *(smaller — manual setState dropped)* |
| `MenteeDetail-*.js` | 56.48 kB / 12.78 kB gzip | **56.41 kB / 12.78 kB gzip** |

**Net: ~−150 bytes gzip** — annual-reviews migration actually shrunk the bundle slightly because of the dropped local state machinery.

## Verification

1. **Cold-load `/annual-reviews`** with Network filter `/annual-reviews/` → **1× request** (was 2× in dev).
2. **Submit your self-review** → 1× POST `/annual-reviews/self` + 1× GET `/mine/history` (invalidation refetch) + 1× GET `/dashboard/summary`. Dashboard widget flips from "Draft" to "With mentor".
3. **Save a self-review draft** → 1× PATCH + 1× GET `/mine/history`. Dashboard NOT refetched (drafts don't change counters).
4. **Mentor: open MenteeDetail → Annual Review tab → click Evaluate** → drawer opens. Type a comment; close mid-typing within 1500ms → no PATCH (debounce cancellation). Click Submit → 1× PATCH `/mentor-eval` + invalidation chain: dashboard updates, MenteeDetail data refreshes.
5. **Admin: Management Review tab → click 👁 on a reviewed row** → detail modal opens. **Without closing it,** open another tab, set the management rating → modal content updates automatically (the bonus fix above).
6. **Admin: Set management rating on a row** → confirm dialog → 1× PATCH + 1× GET `/calibration` + 1× GET `/dashboard/summary`. Row's rating column updates after refetch.
7. **Cross-page check** — submit a self-review → dashboard "My Annual Review" widget reflects new status. Mentor's Team Review tab shows the review in `pending_mentor` status.

## Risks / known limitations

- **Mutation feedback latency** — same trade-off as the goals migration. Set-management-rating and submit-mentor-eval have ~150-300 ms before the row visibly updates. Optimistic updates for `useSetManagementRating` are also a strong F1 candidate.
- **Debounced autosave** (EvalForm) — Phase B Task 4's debounce machinery is still in place. The autosave-on-unmount semantics didn't change. The only difference: the underlying mutation is now backed by `useSaveMentorDraft` instead of a direct service call, so the invalidation chain still fires.

## Pattern reinforced

This migration leaned on the same template as `src/queries/users.ts` and `src/queries/goals.ts`:
- One module, strict tuple keys, top-level broadcast key for invalidation.
- Cross-domain helper (`invalidateAnnualReviewsAndDashboard`) reused internally for status-changing mutations.
- Drafts use the narrow `['annual-reviews']` invalidation only.

The next migrations (D3 project-reviews, D4 mentees, D5 feedback360, D6 profile) will reuse the same shape.

## Related artifacts

- Sibling D1 migration: [10-tanstack-goals.md](./10-tanstack-goals.md)
- Phase B Task 4 (EvalForm debounced autosave): [01-phase-b-results.md](./01-phase-b-results.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
