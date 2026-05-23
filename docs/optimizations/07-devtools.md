# TanStack Query Devtools (dev-only)

> Sequential progression note. First post-Phase-C addition.
> Pure developer-experience improvement — no behaviour change for users.

## What was added

The official `@tanstack/react-query-devtools` floating panel, mounted alongside `<QueryClientProvider>` in [src/main.tsx](../../frontend/src/main.tsx).

## Why

Phase C migrated 8 server-state domains onto TanStack. Verifying invalidations, stale state, refetch behaviour, and cache hits without the panel meant squinting at the DevTools Network tab. The panel surfaces the same information in one click:

- Every active `Query` and `Mutation` with status, fetched-at timestamp, observer count
- Manual "Refetch", "Invalidate", "Reset" buttons per query — useful for testing cross-page invalidation chains
- Live state transitions visualised
- Lets you confirm that, e.g., editing a user in AdminPanel correctly invalidates `['users']` *and* nothing else

## What changed

### Installed
- `@tanstack/react-query-devtools` ^5.100.13 as a **dev dependency** (`--save-dev`). The version is pinned to match the runtime `@tanstack/react-query` major (v5).

### Edited
- [frontend/src/main.tsx](../../frontend/src/main.tsx):

  ```tsx
  import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

  // …inside <QueryClientProvider>, as a sibling of <AuthProvider>:
  <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
  ```

  Props chosen:
  - `initialIsOpen={false}` — panel starts collapsed; click the floating logo to open.
  - `buttonPosition="bottom-right"` — out of the way of the Sidebar and Topbar.

## Production behavior

The package internally guards on `process.env.NODE_ENV === "production"` and exports a `null`-returning stub in prod builds. Vite resolves the guard at build time.

### Verified bundle delta

| Asset | Pre this PR (master) | Post |
|---|---|---|
| Shared `index-*.js` | 214.54 kB raw / 67.33 kB gzip | **214.61 kB raw / 67.35 kB gzip** |

**+20 bytes gzip total.** That's the residual cost of the import statement and the call-site JSX — both end up referencing the no-op stub. The actual devtools UI code (~24 kB) is excluded from the prod bundle.

If anyone reviewing the PR worries about the +20 bytes: this is the documented, expected behavior per the TanStack docs and is the recommended way to wire devtools.

## Verification

1. `npm run dev` → floating TanStack logo button at bottom-right of the browser viewport. Doesn't move when you scroll, sits above page content.
2. Click the logo → panel slides up. Tabs at top: Queries / Mutations / Settings.
3. Cold-load `/dashboard` and watch the Queries tab fill in: `['session']`, `['system-settings']`, `['notifications', 'summary']`, `['dashboard', 'summary']`. Click any to expand and see the cached data + status.
4. Navigate to `/admin` → `['users']`, `['admin-settings']`, `['admin', 'departments']`, `['admin', 'designations']`, `['admin', 'projects']` join the list. Confirm each shows as `fresh` (not refetching).
5. From the panel, click **Invalidate** on `['users']` while AdminPanel is open → UsersTab + the PM dropdown in any open ProjectModal both refetch. This is the cross-page invalidation chain we built in Phase B Task 2, now visible.
6. **Production check:** `npm run build && npm run preview` → open `http://localhost:4173/`. Floating logo button is **absent**. Bundle output (above) confirms the chunk size unchanged.

## Pattern note for future migrations

The devtools panel is the fastest way to confirm a new TanStack migration is wired correctly:
- New `['foo']` query appears immediately on mount.
- Mutations show up under the **Mutations** tab with their `onSuccess` invalidation visible.
- `staleTime` countdown is visible per query — easy to tune.

Use it when implementing Tier A items (virtualization, optimistic updates) to verify `setQueryData` snapshots and rollbacks if/when we add them.

## Related artifacts

- Pattern source: [src/queries/users.ts](../../frontend/src/queries/users.ts)
- Phase C closing summary: [06-admin-projects.md](./06-admin-projects.md)
