import { useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthContext, type AuthContextType } from "./AuthContext";
import { authService, type AuthResponse } from "../services/auth.service";
import { useSessionQuery } from "../queries/session";
import { useIdleTimeout, SESSION_EXPIRED_KEY } from "../hooks/useIdleTimeout";

// Maps outside the component and acts as source of truth.
// Single-tenant deployment — only Healthark is populated. Kept as a
// lookup table so the existing org_id-driven plumbing continues to
// work and a second tenant could be wired in by inserting one row.
const THEME_MAP: Record<number, string> = {
  1: "healthark",
};

/** Browser tab title + favicon per org */
const BRAND_META: Record<number, { title: string; favicon: string }> = {
  1: { title: "Healthark PMS", favicon: "/Icon_Blue.png" },
};

/** Helper – create or reuse the <link rel="icon"> element */
function setFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: Readonly<AuthProviderProps>) {
  const queryClient = useQueryClient();

  /**
   * Lazy initializer: runs exactly once on mount.
   * After C12 the JWT lives in an HttpOnly cookie that JS cannot read, so
   * "am I logged in?" is no longer derivable synchronously. We hydrate the
   * cached claims from localStorage (so the UI can skip the login flash for
   * likely-authenticated users) and let the `['session']` query below
   * confirm against the server. If the cookie is gone/expired, /auth/session
   * 401s, the axios interceptor runs forceLogout(), and the user state here
   * gets cleared via the storage event.
   */
  const [user, setUser] = useState<AuthResponse | null>(() => {
    try {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        return JSON.parse(savedUser) as AuthResponse;
      }
    } catch {
      localStorage.removeItem("user");
    }
    return null;
  });

  /**
   * Persist session claims and update state atomically. The token is NOT
   * stored here — it lives in an HttpOnly cookie the browser attaches on
   * every request automatically. Post-login navigation is handled by the
   * consuming component (Login.tsx watches `user`).
   */
  const login = useCallback((data: AuthResponse): void => {
    // Store the CSRF token separately so the axios interceptor can read it
    // on cross-origin deployments where document.cookie is domain-scoped.
    if (data.csrf_token) {
      localStorage.setItem("csrf_token", data.csrf_token);
    }
    localStorage.setItem("user", JSON.stringify(data));
    setUser(data);
  }, []);

  const logout = useCallback((): void => {
    // Clear the server-side cookies first (fire-and-forget — local cleanup
    // still runs even if the network call fails).
    void authService.logout();
    localStorage.removeItem("user");
    localStorage.removeItem("csrf_token");
    setUser(null);
    // Evict every domain's cached data so no prior-user payload (users,
    // settings, dashboard, etc.) survives into the next sign-in. This is
    // the security/correctness benefit of moving server-state into TanStack.
    queryClient.clear();
  }, [queryClient]);

  /**
   * Live session claims via TanStack Query (cache key `['session']`).
   * Replaces the prior manual `useEffect(refreshSession, [])` so that:
   *   - React StrictMode no longer double-fires the bootstrap GET in dev.
   *   - Concurrent consumers (e.g. multiple providers mounting near
   *     simultaneously) dedupe to a single network call.
   *   - The cache persists across route navigations within `staleTime`.
   */
  const sessionQuery = useSessionQuery(user !== null);

  /**
   * Merge fresh server claims into the existing user state on success.
   * Preserves the login-time fields (notably `csrf_token`) that aren't
   * present on the /auth/session response — mirrors the prior merge
   * semantics of `refreshSession()`.
   */
  useEffect(() => {
    if (!sessionQuery.data) return;
    setUser((prev) => ({ ...(prev ?? {}), ...sessionQuery.data } as AuthResponse));
    try {
      const saved = JSON.parse(localStorage.getItem("user") ?? "null");
      localStorage.setItem(
        "user",
        JSON.stringify({ ...(saved ?? {}), ...sessionQuery.data }),
      );
    } catch {
      /* localStorage write best-effort — quota/disabled cases are non-fatal */
    }
  }, [sessionQuery.data]);

  /**
   * Public `refreshSession()` API — preserved for the 22+ consumers that
   * call it after actions that mutate claims (password change, etc.).
   * Backed by the query's refetch under the hood.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    await sessionQuery.refetch();
  }, [sessionQuery]);

  /**
   * Multi-tab session sync. When another tab logs out (or logs in as a
   * different user), the `user` key changes in localStorage — the `storage`
   * event fires in *other* tabs. Mirror the change here so the whole
   * browser stays on one session. (We no longer store `token`; the browser
   * already shares HttpOnly cookies across tabs of the same origin.)
   */
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== "user" && e.key !== null) return;
      const savedUser = localStorage.getItem("user");
      if (!savedUser) {
        setUser(null);
        return;
      }
      try {
        setUser(JSON.parse(savedUser) as AuthResponse);
      } catch {
        setUser(null);
      }
    };
    globalThis.addEventListener("storage", handler);
    return () => globalThis.removeEventListener("storage", handler);
  }, []);

  /**
   * Dynamic Theming Sync
   * Automatically updates the CSS variables on the root document whenever
   * the authenticated organization changes.
   */
  useEffect(() => {
    if (user?.org_id) {
      const themeKey = THEME_MAP[user.org_id] || "healthark";
      document.documentElement.setAttribute("data-theme", themeKey);

      const meta = BRAND_META[user.org_id] ?? BRAND_META[1];
      document.title = meta.title;
      setFavicon(meta.favicon);
    } else {
      document.documentElement.removeAttribute("data-theme");
      // Reset to Healthark defaults when logged out
      document.title = "Healthark PMS";
      setFavicon("/Icon_Blue.png");
    }
  }, [user?.org_id]);

  /**
   * The primary Story 1.2 guard. Checks the features array that came
   * from the org's `enabled_features` column at login time.
   */
  const hasFeature = useCallback(
    (feature: string): boolean => {
      return user?.features?.includes(feature) ?? false;
    },
    [user],
  );

  // Derived boolean — avoids null checks scattered across the codebase
  const isAuthenticated = useMemo(() => user !== null, [user]);

  /**
   * 30-minute idle timeout. While authenticated, `useIdleTimeout` slides the
   * server-side session window on user activity (throttled POST /auth/refresh)
   * and calls this handler once the idle limit is hit. We drop a marker that
   * the Login page reads to show the "session expired" notice, then log out —
   * clearing `user` makes ProtectedRoute redirect to /login (a soft
   * react-router redirect, so the sessionStorage marker survives the hop).
   */
  const handleIdleExpire = useCallback((): void => {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, "idle");
    logout();
  }, [logout]);
  useIdleTimeout(isAuthenticated, handleIdleExpire);

  /**
   * useMemo here is non-negotiable: without it, every render creates a new
   * value object, causing all consumers to re-render even with stable state.
   * useCallback on each function ensures the deps array stays stable.
   */
  const value = useMemo<AuthContextType>(
    () => ({ user, isAuthenticated, login, logout, hasFeature, refreshSession }),
    [user, isAuthenticated, login, logout, hasFeature, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
