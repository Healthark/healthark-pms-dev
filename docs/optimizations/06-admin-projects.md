# Phase C step 7 — Admin Projects migration (final TanStack step)

> Sequential progression note for the seventh and final Phase C migration.
> Closes out the admin domain — every endpoint surfaced by `/admin` is
> now on the shared TanStack cache.

## What was migrated

The admin projects list read **plus** the three single-call mutations owned by ProjectsTab.

- `GET /projects/?include_completed=true` → `['admin', 'projects']`
- `DELETE /projects/{id}` → `useDeleteProject` (invalidates `['admin', 'projects']`)
- `POST /projects/{id}/complete` → `useMarkProjectComplete` (invalidates `['admin', 'projects']`)
- `POST /projects/{id}/reopen` → `useReopenProject` (invalidates `['admin', 'projects']`)

## What changed

### New
- [frontend/src/queries/adminProjects.ts](../../frontend/src/queries/adminProjects.ts) — `adminProjectsQueryKey = ['admin', 'projects']`, `useAdminProjects()`, `useDeleteProject()`, `useMarkProjectComplete()`, `useReopenProject()`. Each mutation runs `qc.invalidateQueries({ queryKey: adminProjectsQueryKey })` in `onSuccess` — no `setQueryData` per the established rule.

### Refactored
- [frontend/src/components/admin/ProjectsTab.tsx](../../frontend/src/components/admin/ProjectsTab.tsx)
  - Dropped local `projects` state + `isProjectsLoading` flag + the `loadProjects` callback + its `useEffect`.
  - Data now comes from `useAdminProjects()`.
  - `handleDelete` / `handleMarkComplete` / `handleReopen` no longer chain `setProjects(prev => prev.filter / map ...)` after the service call — they just `await mutation.mutateAsync(id)` and let the cache invalidation drive the UI refresh. **~30 LOC removed** from the three handlers combined.
  - `handleModalSave` no longer calls `loadProjects()`; it calls `queryClient.invalidateQueries({ queryKey: adminProjectsQueryKey })` so ProjectModal's compound save (project create/update + N assignment writes) reflects automatically.

### Intentionally NOT migrated (scope guard)
- [ProjectModal.tsx](../../frontend/src/components/admin/ProjectModal.tsx) — kept its direct service calls (`projectService.createProject`, `updateProject`, `addAssignment`, `updateAssignment`, `removeAssignment`). The save flow is a **compound transaction**: it can fire 5+ calls in sequence (e.g. create project → POST 3 assignments). Converting each to a separate `useMutation` would scatter related state across hooks without an obvious win. The parent's `handleModalSave` invalidation covers cache freshness.
- Assignment-only edits (the "edit team members" inline flow) — same reasoning. Direct service calls; parent invalidates.

## Behaviour change worth flagging

**Mutation feedback latency.** Pre-migration:

```ts
await projectService.deleteProject(project.id);
setProjects((prev) => prev.filter((p) => p.id !== project.id));  // INSTANT
```

The row disappeared synchronously after the DELETE responded.

Post-migration:

```ts
await deleteMutation.mutateAsync(project.id);
// invalidate → refetch → list re-renders without the deleted row
```

The row now disappears **after the invalidation refetch returns** — typically +100-300 ms. Same trade-off as the `markAllRead` notification migration in step 5. Matches the strict invalidate-only pattern from Phase B Task 2; no `setQueryData` shortcut.

If users complain about the delay being noticeable on delete/complete/reopen, the follow-up fix is `onMutate` + snapshot/rollback optimistic updates.

## Outcomes

### Network behavior

| Surface | Request count |
|---|---|
| Cold AdminPanel load → Projects tab | was **2× `GET /projects/?include_completed=true`** (StrictMode), now **1×** |
| Switch away from Projects tab and back within 60 s | 0 additional requests (cache hit). **Previously remounted ProjectsTab on every tab visit → fired a fresh fetch each time (× StrictMode = 2 per visit).** This is the bigger win than the cold-load dedup. |
| Delete a project | 1× DELETE + 1× GET (invalidation refetch) |
| Mark complete | 1× POST + 1× GET |
| Reopen | 1× POST + 1× GET |
| Modal save (create or update) | the modal's own service-call chain + 1× GET on save success |

### Bundle delta

| Asset | Pre this PR | Post |
|---|---|---|
| Shared `index-*.js` | 214.54 kB / 67.32 kB gzip | **214.54 kB / 67.33 kB gzip** |
| `AdminPanel-*.js` | 63.09 kB / 14.61 kB gzip | **63.35 kB / 14.69 kB gzip** |

+80 bytes gzip in AdminPanel chunk for the three new mutation hooks. Shared chunk effectively unchanged.

## Phase C — closing summary

With this commit, the Phase C TanStack quest is complete. Every domain on the original prioritized list (in `01-phase-b-results.md`) is now migrated:

| # | Domain | Status |
|---|---|---|
| 1 | `['users']` (Phase B Task 2) | ✅ shipped |
| 2 | `['system-settings']` | ✅ shipped |
| 3 | `['admin-settings']` | ✅ shipped |
| 4 | `['admin', 'departments']` + `['admin', 'designations']` | ✅ shipped |
| 5 | `['session']` | ✅ shipped |
| 6 | `['notifications', 'summary']` | ✅ shipped |
| 7 | `['dashboard', 'summary']` | ✅ shipped |
| 8 | **`['admin', 'projects']`** | ✅ **this commit** |

Every server-state read across the app that fires on a route mount is now deduped through TanStack. Every primary mutation in the admin surface invalidates the right key on success.

## What's left for *future* phases

Out of scope for Phase C — flagged for whenever the team picks them up:

- **Optimistic updates** on the slower-feeling mutations (mark-all-read, delete project, mark-complete, reopen). Trivial `onMutate` + snapshot/rollback per hook. Maybe 2–3 hours of work total across the affected hooks. Do only if the ~150-300 ms delay is a real UX complaint.
- **Cross-domain invalidation** on the dashboard. Goal-approve / review-submit / project-complete mutations could invalidate `['dashboard', 'summary']` so the dashboard counters stay fresh after writes. Currently the 60s `staleTime` covers most flows.
- **Polling on notifications** — one-line `refetchInterval: 60_000` add to `useNotificationsSummary` if the team wants live updates.
- **`useReviewDetails` hook refactor** — Phase A flagged the reducer-based pattern in `src/hooks/useReviewDetails.ts` as not trivially convertible to `useQuery`. Worth its own design pass.
- **Goal / project-review / annual-review domain migrations** — large, intertwined. Phase A explicitly deferred these to a future Phase D.
- **Backend-side payload optimizations** — the 4.4 kB `/admin/users` payload conversation from earlier (field filtering, dropping nested objects, etc.). Separate from TanStack work entirely.

## Pattern reinforced

This migration reused the established template **without modification**:
- One file per domain in `src/queries/`.
- Strict tuple query key.
- One read hook + one mutation hook per write.
- `onSuccess: invalidate(<key>)` — no `setQueryData`.
- Parent component swaps local state + `useEffect` fetch for `useQuery`; manual `setState(prev => ...)` chains in mutation handlers are removed.

Worth bookmarking [src/queries/users.ts](../../frontend/src/queries/users.ts) and [src/queries/adminProjects.ts](../../frontend/src/queries/adminProjects.ts) as the canonical examples for any future migration.

## Related artifacts

- Phase A audit: [00-audit.md](./00-audit.md)
- Phase B summary + pattern: [01-phase-b-results.md](./01-phase-b-results.md)
- Phase C step 3 (admin reference data): [02-admin-reference-data.md](./02-admin-reference-data.md)
- Phase C step 4 (session): [03-session-auth.md](./03-session-auth.md)
- Phase C step 5 (notifications): [04-notifications.md](./04-notifications.md)
- Phase C step 6 (dashboard): [05-dashboard.md](./05-dashboard.md)
