import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient for the app. v5 API.
 *
 * Defaults are chosen for an internal HR tool where data changes
 * sporadically and users may keep tabs open for hours:
 *   - 60s staleTime so common reads (users, projects, settings) don't
 *     refetch on every component remount while still picking up edits
 *     within a minute.
 *   - 5min gcTime keeps unmounted query caches around for fast tab-switching
 *     without holding memory forever.
 *   - refetchOnWindowFocus disabled — too jumpy for form-heavy screens.
 *   - 1 retry on errors to absorb transient network blips without burning
 *     the user's time on dead endpoints.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
