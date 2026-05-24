import { useQuery } from "@tanstack/react-query";
import { authService, type SessionClaims } from "../services/auth.service";

/**
 * Strict, shared query key for the live session claims read
 * (`GET /auth/session`). Bootstrap fetch — fires once on mount,
 * dedupes across StrictMode's double-invocation in dev, and stays
 * cached for the default staleTime so route navigations don't refire it.
 *
 * Note: this is the READ. Login/logout remain in AuthProvider — login
 * is a synchronous state setter called by Login.tsx after its own POST,
 * logout is a fire-and-forget cleanup that also calls queryClient.clear()
 * to evict every other domain's cache between user sessions.
 */
export const sessionQueryKey = ["session"] as const;

export function useSessionQuery(enabled: boolean = true) {
  return useQuery<SessionClaims>({
    queryKey: sessionQueryKey,
    queryFn: () => authService.getSession(),
    // A 401 here means the cookie is gone/expired — retrying just delays
    // the inevitable redirect that the axios interceptor will do via
    // forceLogout(). Don't retry; let the error path resolve fast.
    retry: false,
    // Gate auto-fetch on having a logged-in user. After logout we call
    // queryClient.clear(), which would otherwise trigger an immediate
    // refetch and race the /auth/logout call — if /auth/session lands
    // before the cookie is cleared server-side, the stale claims would
    // re-hydrate `user` and briefly flash the dashboard before the next
    // 401 forces a hard reload. Manual refetch() still works when disabled.
    enabled,
  });
}
