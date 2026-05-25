# Phase D step 1 — Goals domain migration

> One of two TanStack migrations shipped together in this PR. See also [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md).

## What was migrated

Every server-state read and write in the goals domain. The most write-heavy domain in the app — criteria checkbox toggles fire constantly during goal-review windows.

### Reads
- `GET /goals/?goal_type=annual` → `['goals', 'mine', 'annual']`
- `GET /goals/team?goal_type=annual` → `['goals', 'team', 'annual']`

### Mutations (each invalidates `['goals']` ± dashboard summary)
- `useCreateGoal`, `useUpdateGoal`, `useSubmitGoal`
- `useSubmitSelfReview`, `useSaveSelfReviewDraft`
- `useSubmitMentorReview`, `useSaveMentorReviewDraft`
- `useAddCriterion`, `useUpdateCriterion`
- `useUpdateApproval`, `useBulkApprove`

State-changing mutations (anything that affects goal counts on the dashboard widget — submit, approve, bulk-approve, criterion toggle for progress %) **also invalidate `['dashboard', 'summary']`** so the dashboard counters stay fresh. Draft saves don't touch the dashboard.

## Files changed

### New
- [frontend/src/queries/goals.ts](../../frontend/src/queries/goals.ts) — query keys, hooks, mutations.

### Refactored (5 files)
- [pages/AnnualGoals.tsx](../../frontend/src/pages/AnnualGoals.tsx) — dropped local `goals` state, `loadGoals` callback, `isSaving`/`isSelfReviewSaving`/`isSelfReviewDraftSaving` state, `handleCriterionUpdate` callback. Reads from `useMyGoals("annual")`; mutations drive saves/submits.
- [components/goals/TeamGoalsTab.tsx](../../frontend/src/components/goals/TeamGoalsTab.tsx) — dropped local `goals` state + `loadGoals` + bulk-approve manual setState chain. All four mutation paths (`updateApproval`, `bulkApprove`, `saveMentorReviewDraft`, `submitMentorReview`) now go through hooks; cache invalidation drives UI refresh.
- [components/goals/CriteriaChecklist.tsx](../../frontend/src/components/goals/CriteriaChecklist.tsx) — converted from "callback to parent" pattern to direct `useUpdateCriterion()` hook. Replaces the `onCriterionUpdate?` callback prop with a clean `interactive?: boolean` flag.
- [components/goals/AnnualGoalCard.tsx](../../frontend/src/components/goals/AnnualGoalCard.tsx) — dropped the now-redundant `onCriterionUpdate` prop; passes `interactive` to `CriteriaChecklist`.
- [components/mentees/MenteeGoalsTab.tsx](../../frontend/src/components/mentees/MenteeGoalsTab.tsx) — both `updateApproval` callsites (approve + request changes) go through `useUpdateApproval`. `setIsActing` boolean replaced with `mutation.isPending`.

### Intentionally NOT migrated (scope guard)
Goal form modals (`GoalFormModal`, `GoalSelfReviewModal`, `GoalMentorReviewModal`, `BulkApproveModal`) receive their mutation handlers as **callbacks from the parent** — no service calls of their own. Refactoring the parents (above) was sufficient; modals work unchanged.

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/annual-goals` (My Goals tab) | 2× `GET /goals/?goal_type=annual` (StrictMode dev) | **1×** |
| Switch to Team Goals tab (mentor) | 2× `GET /goals/team` | **1×** |
| Switch away and back within 60s `staleTime` | refetched on every mount | **0** (cache hit) |
| Toggle a criteria checkbox | 1× PATCH + manual parent state sync | 1× PATCH + 1× `['goals']` refetch + 1× `['dashboard', 'summary']` refetch |
| Bulk-approve 5 goals | 1× POST + manual `setGoals` filter | 1× POST + 1× `['goals']` refetch + dashboard refetch |
| Submit goal for approval | 1× PATCH + manual setGoals | 1× PATCH + 1× refetch on each invalidated key |

### Cross-domain invalidation chain
For the first time, goal mutations also keep the **dashboard summary fresh**:
- Approve a goal → dashboard `Annual Goals` widget reflects the new "approved" count without a manual refresh.
- Toggle a criterion checkbox → dashboard `Completion %` updates.
- Bulk approve → dashboard counters update for every approved goal.

This was the #1 fix on the cross-cutting wins list ([01-phase-b-results.md](./01-phase-b-results.md) section 8).

### Behavioural change worth flagging

**Mutation feedback latency.** Same trade-off as Phase B/C: with strict invalidate-only, the UI updates after the invalidation refetch returns instead of via instant `setState`. For criteria toggles especially (highest-frequency write in the app), this means a ~150-300 ms delay before the checkbox visually flips. Optimistic updates for `useUpdateCriterion` are flagged as the **#1 candidate in the next Tier F1 PR** since they're the most user-visible.

### Bundle delta
| Asset | Pre | Post |
|---|---|---|
| Shared `index-*.js` | 217.46 kB / 68.09 kB gzip | **217.47 kB / 68.11 kB gzip** |
| `AnnualGoals-*.js` | 58.34 kB / 12.51 kB gzip | **57.19 kB / 12.18 kB gzip** *(smaller — removed manual setState chains)* |
| `TeamGoalCard` chunk | 22.08 kB / 6.79 kB gzip | **24.71 kB / 7.29 kB gzip** *(includes mutation hooks)* |

**Net: ~+150 bytes gzip** for the entire goals domain migration.

## Verification

1. **Cold-load `/annual-goals`** → Network filter `/goals/` → **1× request** (was 2× in dev).
2. **Switch to Team Goals tab (mentor) and back to My Goals within 60s** → 0 additional `/goals/` requests.
3. **Create a new goal** → submit modal → Network: 1× POST `/goals/` + 1× GET `/goals/?goal_type=annual` (invalidation refetch) + 1× GET `/dashboard/summary`. Goal appears in list, dashboard `Annual Goals` count increments.
4. **Toggle a criterion checkbox** on an approved goal → 1× PATCH `/goals/criteria/{id}` + 1× GET `/goals/` + 1× GET `/dashboard/summary`. Checkbox flips after the refetch returns (~150ms delay).
5. **Submit a goal for approval** → confirm → 1× PATCH `/goals/{id}/submit` + invalidation chain. Dashboard `Annual Goals` "submitted" count updates.
6. **Mentor: Team Goals tab → Approve a mentee goal** → 1× PATCH + invalidation. Mentee sees "approved" on their next visit to My Goals.
7. **Mentor: Bulk-approve 3 goals** → 1× POST `/goals/bulk-approve` + invalidation refetch. Dashboard counters update.
8. **Mentee Detail page → Goals tab → Approve goal from there** → cache invalidation cascades to both `/my-mentees/:id` view and the mentor's `/annual-goals` Team Goals tab.

## Pattern reinforced

Same shape as `src/queries/users.ts`:
- One module per domain, strict tuple query keys.
- Top-level invalidation broadcast (`['goals']`) catches every sub-key.
- Cross-domain helper (`invalidateGoalsAndDashboard`) reused inside the module for status-changing mutations.
- Drafts get a narrower invalidation (`['goals']` only) since they don't touch dashboard counters.

## Related artifacts

- Phase B foundation: [01-phase-b-results.md](./01-phase-b-results.md)
- Sibling D2 migration: [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
