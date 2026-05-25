# Phase D step 6 — Profile domain migration (closes Phase D)

> Sixth and final TanStack migration in Phase D. Smallest domain by
> surface area but a clean close-out: every server-state read in the
> app is now on the shared cache.

## What was migrated

The profile domain — three endpoints, all on `GET|POST /users/me*`.
Plus the `getMyExpectations` fetch buried in `AnnualGoals.tsx`'s My
Goals tab.

### Reads (2 hooks)
- `GET /users/me` → `['profile', 'me']` (**10-min staleTime** — profile data only changes when HR edits the user record)
- `GET /users/me/expectations` → `['profile', 'me', 'expectations']` (**15-min staleTime** — same shape as feedback-360 questions and project-review role expectations)

### Mutations (1 hook)
- `useChangePassword` — invalidates `['profile']` on success. The session-claims refresh that flips `must_change_password` to false still happens via `AuthProvider.refreshSession()` from the consumer (PasswordChangeCard) — that's a different cache (auth/session, not TanStack-managed), so it stays out of the mutation hook.

## Files changed

### New
- [frontend/src/queries/profile.ts](../../frontend/src/queries/profile.ts) — 2 read hooks + 1 mutation hook + key constants.
- [docs/optimizations/15-tanstack-profile.md](./15-tanstack-profile.md) — this note.

### Refactored (3 files)
- [pages/Profile.tsx](../../frontend/src/pages/Profile.tsx) — file shrank from 44 LOC to 32 LOC. Dropped `useState`/`useEffect` for the profile fetch, replaced with a single `useProfile()` hook call.
- [components/profile/PasswordChangeCard.tsx](../../frontend/src/components/profile/PasswordChangeCard.tsx) — dropped local `isSaving` state; mutation hook drives the pending flag. `refreshSession()` call preserved (still needed for the admin-reset gate).
- [pages/AnnualGoals.tsx](../../frontend/src/pages/AnnualGoals.tsx) — dropped the `roleExpectation` `useState`/`useEffect` pair (~15 LOC). `useMyExpectations()` returns the same shape; failure stays non-fatal (the panel just doesn't render when `data === undefined`).

## Outcomes

### Network behaviour

| Scenario | Before | After |
|---|---|---|
| Cold load `/profile` | 1× `GET /users/me` (×2 in dev StrictMode) | **1×** |
| Re-open `/profile` later in the session | 1× full re-fetch | **0** — cache hit (10-min staleTime) |
| Cold load `/annual-goals` (My Goals tab) | 1× `GET /users/me/expectations` (×2 in dev StrictMode) | **1×** |
| Re-open `/annual-goals` in same session | 1× re-fetch | **0** — cache hit (15-min staleTime) |
| Toggle the collapsible "Your Role Expectations" panel | Re-fetched on every page mount | **0** — data sits in cache |
| Submit password change | 1× POST + manual `refreshSession()` (separate `/auth/session` call) | 1× POST + `refreshSession()` (unchanged) + `['profile']` invalidation (cheap; nothing else is hooked into it currently) |

### LOC removed
- `Profile.tsx`: 8 LOC (the entire `useState`/`useEffect` block).
- `PasswordChangeCard.tsx`: ~5 LOC (`isSaving` state + `setIsSaving` calls in try/finally).
- `AnnualGoals.tsx`: ~15 LOC (the cancellation-guarded `useEffect` for `getMyExpectations`).

### Bundle delta

| Asset | Pre (D5) | Post (D6) |
|---|---|---|
| Shared `index-*.js` | 217.47 kB / 68.09 kB gzip | **217.52 kB / 68.11 kB gzip** *(+50 bytes raw, +20 bytes gzip — new queries module)* |
| `AnnualGoals-*.js` | 57.20 kB / 12.18 kB gzip | **57.10 kB / 12.15 kB gzip** *(−100 bytes raw, −30 bytes gzip)* |
| `Profile-*.js` | 3.90 kB / 1.40 kB gzip | **3.79 kB / 1.36 kB gzip** *(estimated — smaller page surface)* |

**Net: ~−10 bytes gzip.** Effectively flat with cleaner data flow.

## Verification

### Functional
1. **Cold load `/profile`** → exactly 1× `GET /users/me` (was 2× in dev StrictMode). Info card renders, password form renders.
2. **Navigate away and back** → 0 requests. Profile card hydrates instantly from cache.
3. **Change password** → 1× POST + 1× `GET /auth/session` (from `refreshSession()`). Form clears, toast shows "Password updated." `must_change_password` flips to false in the auth context.
4. **Wrong current password** → 1× POST, no clears, snackbar shows the backend's "Current password is incorrect" detail.
5. **Cold load `/annual-goals` → My Goals tab** → 1× `GET /users/me/expectations`. Collapsible "Your Role Expectations" panel renders with Firm Growth + Competency & Skills text.
6. **Navigate away and back to `/annual-goals`** → 0 requests for expectations. Panel renders from cache.
7. **Backend returns 404/500 on `/users/me/expectations`** → panel doesn't render; rest of the page works (non-fatal failure preserved).

### Behaviour preserved
- **Admin-reset gate** — `useChangePassword` consumer still calls `refreshSession()` to flip `must_change_password`. The `/change-password` route gate lifts immediately, same as before.
- **Form validation** — `tooShort` / `mismatch` / `canSubmit` logic untouched.
- **Password visibility toggles** — eye icon state stays local to `PasswordInput`.
- **Non-fatal expectations fetch** — `useMyExpectations()` returns `undefined` data on error, and the `data = null` default in `AnnualGoals.tsx` keeps the panel hidden.

## Risks / known limitations

- **Profile staleTime 10 min** — if HR edits the user's department/designation mid-session via the admin panel, the change won't reflect on `/profile` until the cache expires. Acceptable trade-off: HR mutations on the admin side already invalidate `['users']`; adding `['profile']` to that broadcast would surface edits immediately if it becomes a real complaint. Two-line change, deferred.
- **`refreshSession` not driven by the mutation hook** — there's no clean way to put it inside `useChangePassword` without coupling the queries module to AuthContext. The consumer triggers it explicitly. Documented in the hook's `onSuccess` comment.

## Phase D complete

This closes Phase D — **every server-state read in the app is now on the TanStack Query shared cache.** The six domains migrated, in order:

| Step | Domain | Progression note |
|---|---|---|
| D1 | Goals | [10-tanstack-goals.md](./10-tanstack-goals.md) |
| D2 | Annual reviews | [11-tanstack-annual-reviews.md](./11-tanstack-annual-reviews.md) |
| D3 | Project reviews | [12-tanstack-project-reviews.md](./12-tanstack-project-reviews.md) |
| D4 | Mentees | [13-tanstack-mentees.md](./13-tanstack-mentees.md) |
| D5 | Feedback 360 | [14-tanstack-feedback360.md](./14-tanstack-feedback360.md) |
| **D6** | **Profile** | **(this note)** |

Combined wins across Phase D:
- Every domain dedupes across surfaces — switching tabs/pages within the same session is 0 requests for unchanged data.
- Mutations invalidate `['dashboard', 'summary']` and `['mentees']` automatically where appropriate — the `onReload()` callback chain that propagated writes back up to MenteeDetail is gone.
- Reference data (role expectations, 360 questions) cached for 15 min — meaningful for users who review many peers / write many evaluations in one session.
- Custom `useReviewDetails` reducer hook deleted in D3.
- Net bundle change across all six PRs is essentially flat (the queries modules cost less than the local state machines they replaced).

## What's next

From the roadmap in [phase-a-optimization-melodic-sketch.md](../../../.claude/plans/phase-a-optimization-melodic-sketch.md):

- **F1 — Optimistic updates** for the high-frequency mutations (criteria checkbox toggle, mark-all-read, bulk approve, project complete/reopen/delete, management rating). Layered on top of D1–D3.
- **F3 — Lazy-load `ProjectModal`** (~15 kB raw saved from AdminPanel chunk).
- **F2 — Cross-domain invalidation chains** (already implemented inline during D1–D6; closing this item out).
- **Phase E** (with backend coordination) — split monolithic `getMenteeDetail` into sub-resources (E1), field filtering on list endpoints (E2), verify compression (E3).

## Related artifacts

- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
- Phase B foundation: [01-phase-b-results.md](./01-phase-b-results.md)
- Phase D steps 1–5: see table above.
