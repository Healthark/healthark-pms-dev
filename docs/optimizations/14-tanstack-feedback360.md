# Phase D step 5 — Feedback 360 domain migration

> Fifth TanStack migration. Smallest domain by surface area but with
> a couple of nice wins: shared question registry across multiple
> peer reviews in one session, and the Org-tab combobox now hits the
> same peers cache as the virtualized Give Feedback list.

## What was migrated

Every server-state read and write in the 360-feedback domain. Plus a
cleanup pass on the `MenteeFeedbackTab` inside `Feedback360.tsx` that
was still reaching for `menteeService.getSummaries()` directly — now
on the D4 `useMenteeSummaries` hook.

### Reads (4 hooks)
- `GET /feedback-360/questions` → `['feedback-360', 'questions']` (**15-min staleTime** — effectively-static registry)
- `GET /feedback-360/peers` → `['feedback-360', 'peers']`
- `GET /feedback-360/my-review/{id}` → `['feedback-360', 'my-review', id]`
- `GET /feedback-360/aggregate/{id}` → `['feedback-360', 'aggregate', id]`

### Mutations (1 hook)
- `useSubmitFeedback` — invalidates `['feedback-360']` (top-level broadcast). That catches the peers list (the `has_submitted` flag flips on the just-reviewed row), the requester's own `my-review` for that target (now read-only), and any open aggregate views for the target (counts + cohort whiskers shift).

The dashboard summary is **not** invalidated — 360 feedback isn't surfaced there. If a future PR adds a counter (e.g. "peers awaiting your feedback") to the dashboard summary, add `dashboardSummaryQueryKey` to the broadcast.

## Files changed

### New
- [frontend/src/queries/feedback360.ts](../../frontend/src/queries/feedback360.ts) — 4 read hooks + 1 mutation. Long staleTime on `useFeedbackQuestions` since the registry rarely changes.
- [docs/optimizations/14-tanstack-feedback360.md](./14-tanstack-feedback360.md) — this note.

### Refactored (4 files)
- [pages/Feedback360.tsx](../../frontend/src/pages/Feedback360.tsx) — `OrgFeedbackTab` now reads peers via `useFeedbackPeers()` (shared cache with `PeerList`). `MenteeFeedbackTab` now reads via `useMenteeSummaries()` (shared cache with `MyMentees` from D4). The auto-select-first-mentee behaviour is preserved via a small `useEffect` watching the hook's data.
- [pages/FeedbackGive.tsx](../../frontend/src/pages/FeedbackGive.tsx) — dropped the local `questions`/`my`/`isLoading`/`loadError`/`isSubmitting` state machine plus the `Promise.all` parallel loader. Two query hooks (`useFeedbackQuestions`, `useFeedbackMyReview`) run in parallel and the mutation hook (`useSubmitFeedback`) drives submit lifecycle. The read-only pre-fill is now an effect on `my?.ratings`.
- [components/feedback360/PeerList.tsx](../../frontend/src/components/feedback360/PeerList.tsx) — dropped the local fetch effect. The virtualization machinery (@tanstack/react-virtual, paired-row layout, 640px scroll container) is untouched.
- [components/feedback360/AggregateView.tsx](../../frontend/src/components/feedback360/AggregateView.tsx) — dropped the local fetch effect; query is keyed on `targetUserId` so prop changes automatically swap caches.

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/feedback` (Give tab default) | 1× `GET /peers` (×2 in dev StrictMode = up to 2×) | **1×** |
| Switch to My Feedback tab | 1× `GET /aggregate/{self}` | **1×** (same as before — first visit) |
| Switch back to Give tab | 0 requests (was already cached) | **0** (same) |
| Switch to Org Feedback tab (Management) | 1× `GET /peers` again (separate component, separate fetch) | **0 — cache hit** with the Give tab's `PeerList` |
| Switch to Mentee Feedback tab | 1× `GET /mentees/summary` | **0 — cache hit** with the D4 `/my-mentees` cache |
| Click a peer → `/feedback/give/:id` | 2× requests in parallel: `GET /questions` + `GET /my-review/{id}` | **1× `GET /my-review/{id}`** (`/questions` is cached for 15 min) |
| Visit another peer in same session | 2× requests again (questions re-fetched) | **1× `GET /my-review/{id}`** (questions still cached) |
| Submit feedback | 1× POST → manual `navigate('/feedback')` → peer list shows stale `has_submitted` until next reload | 1× POST → invalidation broadcast → peers + that target's aggregate + my-review all refetch → `has_submitted` flips and the row flips to "View" CTA |
| Open the Org-tab aggregate, then the same target via Give-tab `/feedback/give/:id` | 2× separate `GET /aggregate/{id}` calls (no cache) | **1× aggregate** call total — both surfaces share the cache |

### Cross-domain sharing
- **Peers cache shared** between `PeerList` (Give tab, virtualized) and `OrgFeedbackTab`'s combobox. Switching tabs is a cache hit.
- **Mentee summaries shared** with the D4 mentees domain. Visiting `/my-mentees` then jumping to `/feedback` → Mentee Feedback tab is a cache hit.
- **Questions registry** is a single fetch per ~15-minute session window — every visit to `/feedback/give/:id` after the first hits the cache.

### Submit feedback UX
Same trade-off as the prior migrations: with strict invalidate-only, the peer's "Give Feedback" CTA flips to "View ✓" after the refetch completes (~150–300 ms) rather than synchronously. The mutation's `isPending` covers the button-disable window so users don't double-submit. Form state (`ratings`) is dropped on navigate, same as before.

### LOC removed
- `FeedbackGive.tsx`: ~30 LOC (the parallel-load `useEffect`, cancellation guard, manual `isSubmitting`/`loadError` state).
- `PeerList.tsx`, `AggregateView.tsx`, `Feedback360.tsx` org+mentee tabs: ~60 LOC combined (three local-fetch `useEffect`s with cancellation guards each).

### Bundle delta

| Asset | Pre (D4) | Post (D5) |
|---|---|---|
| Shared `index-*.js` | 217.42 kB / 68.09 kB gzip | **217.47 kB / 68.09 kB gzip** *(+50 bytes raw, flat gzip — queries module imports)* |
| `Feedback360-*.js` | 37.72 kB / 10.43 kB gzip | **37.08 kB / 10.31 kB gzip** *(−640 bytes raw, −120 bytes gzip — two local-state machines removed)* |
| `FeedbackGive-*.js` | 9.47 kB / 3.04 kB gzip | **9.32 kB / 2.98 kB gzip** *(−150 bytes raw, −60 bytes gzip)* |
| `MyMentees-*.js` | 13.03 kB / 3.40 kB gzip | **12.99 kB / 3.38 kB gzip** *(flat — MenteeFeedbackTab now shares its hook)* |

**Net: ~−180 bytes gzip.** Bundle shrinks despite a new queries module.

## Verification

### Functional
1. **Cold load `/feedback`** → 1× `GET /feedback-360/peers`. Virtualized list renders, filter chips work.
2. **Switch to My Feedback tab** → 1× `GET /aggregate/{self}`. Table + whiskers render or empty state.
3. **Switch to Org Feedback tab** (Management) → **0 new requests**. Picker dropdown lists every peer.
4. **Pick a peer in Org Feedback** → 1× `GET /aggregate/{picked}`. Switching peers fires 1× per new id; revisiting a peer in the same session is **0 requests**.
5. **Switch to Mentee Feedback tab** (if `has_mentees`) → **0 new requests** (cache shared with `/my-mentees`). Picker auto-selects first mentee. Selecting a mentee fires 1× `GET /aggregate/{id}`.
6. **Click a peer in Give tab → `/feedback/give/{id}`** → 1× each `GET /questions` + `GET /my-review/{id}` *on first visit only*; 1× `GET /my-review/{id}` *on subsequent visits* (questions cached).
7. **Submit feedback** → 1× POST + 1× refetch each of `/peers`, `/my-review/{id}`, `/aggregate/{id}` (active queries only). Navigate to `/feedback` → peer's CTA shows "View ✓".
8. **Re-open the same peer post-submit** → page mounts in read-only mode with the ratings pre-filled. No PATCH ever fires.

### Behaviour preserved
- **Virtualization** — `PeerList` still uses `@tanstack/react-virtual` v3 with paired-row layout, 640px scroll container, 6-row overscan. No changes.
- **Read-only mode** — `my?.ratings != null` still drives the disabled slider state and "Read-only — already submitted" footer.
- **Anonymous + submit-once** — backend-enforced; no frontend changes here.

## Risks / known limitations

- **Question registry staleTime is 15 min.** If HR edits the form mid-session, the change won't surface until the cache expires. Acceptable trade-off — the registry is touched roughly quarterly, and the longer cache life means more cache hits across `/feedback/give/:id` visits.
- **No optimistic update on submit.** The CTA flip is post-refetch (~150–300 ms). For the high-volume submit flow this is fine; if it ever feels slow, layer in `onMutate` + `setQueryData` on `peersQueryKey` and `myFeedbackReviewQueryKey(target)`. See [16-optimistic-updates.md](./16-optimistic-updates.md) (planned) for the pattern.
- **Dashboard summary not invalidated** — feedback-360 has no counters there today. Documented in `useSubmitFeedback`'s comment.

## Pattern reinforced

Same shape as `src/queries/users.ts`, `goals.ts`, `annualReviews.ts`, `projectReviews.ts`, `mentees.ts`:
- One module per domain, strict tuple keys, top-level invalidation broadcast.
- Read hooks return the standard useQuery shape; consumers derive their own loading/error variables.
- Effectively-static reference data gets a long staleTime (questions: 15 min, same as project-review role-expectations).
- Single mutation → single broadcast → every affected sub-key refetches.

## Related artifacts

- Phase D step 1 (goals): [10-tanstack-goals.md](./10-tanstack-goals.md)
- Phase D step 2 (annual reviews): [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md)
- Phase D step 3 (project reviews): [12-tanstack-project-reviews.md](./12-tanstack-project-reviews.md)
- Phase D step 4 (mentees): [13-tanstack-mentees.md](./13-tanstack-mentees.md)
- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
- Next: Phase D step 6 — profile domain (closes Phase D).
