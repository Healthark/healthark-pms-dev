# F1 — Optimistic updates on high-frequency mutations

> First non-Phase-D PR. Layers `onMutate` snapshot/rollback on the
> mutations where the post-Phase-D ~150–300 ms refetch latency was
> most visible. No API or consumer changes — just the queries modules.

## Context

After Phase D every server-state read sits on the TanStack cache and
every mutation invalidates the relevant keys on `onSuccess`. That's
correct, but for **high-frequency click-to-change** actions the UI
waits for the refetch before the change is visible:

- Ticking 5 criterion checkboxes in a row — each click pauses ~250 ms.
- Bulk approve — rows linger before disappearing.
- Management rating modal — cell briefly shows the old value after confirm.
- Project mark-complete / reopen / delete — row state lags the click.

F1 keeps the existing invalidation as a correctness backstop (moved
from `onSuccess` → `onSettled`) and adds an `onMutate`-driven
optimistic write + `onError` rollback in front of it. The result: the
UI flips on click, the refetch reconciles to truth without a visible
diff in the success case.

## What changed

Six mutations across three modules. Pattern is uniform; only the cache
key + the optimistic transform differs per mutation.

### `frontend/src/queries/goals.ts`

1. **`useUpdateCriterion`** — checkbox toggle on goal key results. Uses `setQueriesData({ queryKey: ["goals", "mine"] }, …)` so every `goalType` variant in the cache gets the optimistic patch (`useMyGoals` accepts an optional filter). The optimistic transform also **recomputes `progress_percent`** so the progress bar moves before the server's value lands.
2. **`useUpdateApproval`** — single approve / request-changes. Flips `approval_status` and (for request-changes) `manager_feedback` on the matched goal in every `["goals", "team", …]` cache entry.
3. **`useBulkApprove`** — multi-select approve. Sets `approval_status = "approved"` on every goal whose id is in the input array. If the server rejects some (the response `failures[]` array), the `onSettled` refetch reconciles each row back to the truth. The consumer already surfaces the failure list via a snackbar.

### `frontend/src/queries/annualReviews.ts`

4. **`useSetManagementRating`** — calibration grid cell update. Single-cache-entry update (`calibrationGridQueryKey`); matches by `review_id` (note: that's the row's id field, not `id`).

### `frontend/src/queries/adminProjects.ts`

5. **`useDeleteProject`** — soft-delete. Optimistic = filter the row out of `["admin", "projects"]`. On error, the row reappears.
6. **`useMarkProjectComplete`** — flip `status` to `"completed"`.
7. **`useReopenProject`** — flip `status` to `"active"`.

The three project mutations share a `snapshotAdminProjects(qc)` / `rollbackAdminProjects(qc, context)` helper pair to keep the boilerplate identical.

### Scope intentionally excluded

- **`useMarkAllRead`** in `queries/notifications.ts` — unread badge already feels instant (the value goes to 0; no diff to wait on). Skipped to keep F1 tight.
- **Project create/update from `ProjectModal`** — explicit comment in `adminProjects.ts` keeps these as black-box invalidations because the response payload reshapes the row.
- **`useSubmitFeedback` (D5)** — submit-once flow, the user navigates away on success, refetch latency isn't visible.
- **PM/Secondary project review submit** — already feels OK in practice; revisit if users complain.

## Pattern

Every migrated mutation follows the same shape:

```ts
useMutation({
  mutationFn: …,
  onMutate: async (variables) => {
    await qc.cancelQueries({ queryKey: TARGET_KEY });   // stop in-flight refetches
    const previous = qc.getQueryData(TARGET_KEY);       // (or getQueriesData for prefix-match)
    qc.setQueryData(TARGET_KEY, (old) => applyOptimistic(old, variables));
    return { previous };                                 // (or { snapshot } for prefix-match)
  },
  onError: (_err, _vars, context) => {
    if (context?.previous !== undefined) {
      qc.setQueryData(TARGET_KEY, context.previous);
    }
  },
  onSettled: () => invalidateXxxAndDashboard(qc),       // existing logic, moved off onSuccess
});
```

Two flavours of snapshot:

- **Single cache entry** (`useSetManagementRating`, project mutations) — `getQueryData` + `setQueryData`.
- **Prefix-matched cache entries** (`useUpdateCriterion`, `useUpdateApproval`, `useBulkApprove`) — `getQueriesData({ queryKey: prefix })` + `setQueriesData(...)`. Returns `Array<[key, data]>` so rollback iterates and restores each entry.

The `onSettled` runs after both success and error, so the invalidation reconciles to server truth in either case — the rollback only restores the optimistic state until the refetch settles.

## Outcomes

### Network behaviour

No new requests. Every mutation still fires exactly one server round-trip + one refetch on settle, same as before. The visible difference is *when* the UI reflects the change.

### UX latency
| Action | Before | After |
|---|---|---|
| Tick a criterion checkbox | ~250 ms pause, then flip | **Instant flip**, no pause |
| Tick 5 checkboxes in 1 second | Each waits for the previous refetch | **All 5 flip instantly**; one refetch on settle reconciles |
| Bulk approve 5 goals | Rows linger ~300 ms, then vanish | **Vanish instantly** from the modal's pending list |
| Approve / request-changes from team table | ~250 ms before badge updates | **Badge flips instantly** |
| Set management rating | Modal closes, cell flickers stale → new | Modal closes, **cell shows new value immediately** |
| Mark project complete | Status pill lags click | **Pill flips instantly** |
| Delete project | Row lingers, then vanishes | **Row vanishes instantly** |

### Rollback behaviour
Force an error (kill the backend, throttle network, etc.):
1. Optimistic value renders immediately.
2. Server responds with 4xx / 5xx after ~100–500 ms.
3. `onError` runs → snapshot restores the previous cache.
4. `onSettled` runs the invalidation → refetch confirms the pre-mutation state.

The user sees a brief flash of the optimistic value, then it reverts and a snackbar shows the error message. Net feel: "looks like that didn't work."

### Bundle delta

| Asset | Pre (D6) | Post (F1) |
|---|---|---|
| `TeamGoalCard-*.js` | 24.75 kB / 7.31 kB gzip | **26.06 kB / 7.61 kB gzip** *(+1.3 kB raw, +0.3 kB gzip — useUpdateCriterion + useUpdateApproval + useBulkApprove logic)* |
| `AdminPanel-*.js` | 64.00 kB / 14.75 kB gzip | **64.55 kB / 14.90 kB gzip** *(+0.55 kB raw, +0.15 kB gzip — three project mutations)* |
| `ManagementReviews-*.js` | 11.15 kB / 2.98 kB gzip | **11.16 kB / 2.99 kB gzip** *(+10 bytes raw — useSetManagementRating)* |
| Shared `index-*.js` | 217.52 kB / 68.11 kB gzip | **217.52 kB / 68.11 kB gzip** *(flat)* |

**Net: ~+0.5 kB gzip across consumers** for the `onMutate`/`onError`/`onSettled` boilerplate. Plan estimated "a few hundred bytes"; close enough for the UX win.

## Verification

### Functional happy-path
1. **`/annual-goals` My Goals tab → tick a criterion** → checkbox flips and `progress_percent` updates **before** the PATCH response lands. Confirm in DevTools: Network shows PATCH then refetch; UI doesn't visibly change on settle.
2. **Tick 5 criteria in 1 second** → all 5 flip instantly. Only 1× refetch fires (the others get cancelled by `cancelQueries` then folded into a final one on settle).
3. **`/annual-goals` Team Goals tab → "Approve" button** → row's status badge flips to "Approved" instantly.
4. **Same row → "Request Changes" → submit feedback** → row flips to "Changes Requested" with the feedback text visible inline before refetch lands.
5. **Bulk approve 3 goals** → all 3 vanish from the pending list instantly. Refetch confirms.
6. **Admin → Management Review → click pencil → confirm rating 4** → modal closes, cell shows 4 immediately.
7. **Admin → Projects → mark a project complete** → status pill flips to "Completed". If the Active filter is on, the row leaves the visible set.
8. **Admin → Projects → re-open a completed project** → status flips to "Active".
9. **Admin → Projects → delete** → row vanishes from the table instantly.

### Rollback / error-path
1. Block requests in DevTools (Network → Throttling → Offline OR a backend kill).
2. **Tick a criterion** → flips, then reverts ~200 ms later (after the request times out).
3. **Approve a goal** → badge flips, reverts. Snackbar shows the error.
4. **Delete a project** → row vanishes, reappears. Snackbar shows the error.

### Build
- `npm run build` passes clean. Bundle delta confirmed at ~+0.5 kB gzip (acceptable).

## Risks / known limitations

- **Backend response that reshapes the row beyond the optimistic prediction.** E.g. `setManagementRating` might trigger a downstream `final_performance_rating` change server-side. Users will briefly see the optimistic value before the refetch swaps in the real one. This is the standard TanStack optimistic-update contract; documented per mutation.
- **`useBulkApprove` partial failures.** Optimistic transform sets *every* selected goal to `"approved"`. If the server rejects some (`failures[]`), the `onSettled` refetch will revert those specific rows back to their true state and the snackbar shows the failure list. The bulk modal already handles this contract.
- **No optimistic update for `useCreateGoal` / `useUpdateGoal`** — these return new shapes (server-generated id, derived fields), and the form modals already close on success. Black-box invalidation stays.

## Pattern reinforced

Same shape as the rest of the codebase's mutation hooks; now with optimistic layering on top where it matters. The split between `onSettled` (cache reconciliation, runs always) and `onMutate` + `onError` (the optimistic / rollback pair) keeps invalidation behaviour identical to pre-F1 — the cache will always converge to server truth after the refetch.

## Related artifacts

- Phase D close-out: [15-tanstack-profile.md](./15-tanstack-profile.md) (lists every Phase D progression note)
- Plan source: [F1 plan](../../../.claude/plans/phase-a-optimization-melodic-sketch.md)
- TanStack v5 reference: `cancelQueries`, `getQueriesData`, `setQueriesData`, `setQueryData` are the four APIs used.
