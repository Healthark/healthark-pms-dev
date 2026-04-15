import { useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { AuthContext, type AuthContextType } from "./AuthContext";
import type { AuthResponse } from "../services/auth.service";

// Maps outside the component and acts as source of truth
const THEME_MAP: Record<number, string> = {
  1: "healthark",
  2: "miltenyi",
};

/** Browser tab title + favicon per org */
const BRAND_META: Record<number, { title: string; favicon: string }> = {
  1: { title: "HealthArk PMS",       favicon: "/healtharklogo-small.png" },
  2: { title: "Miltenyi Biotec PMS", favicon: "/miltenyi-biotech-small.svg" },
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
  /**
   * Lazy initializer: runs exactly once on mount.
   * Starting state from localStorage synchronously prevents a cascading
   * render cycle where the app flashes the login page for authenticated users.
   */
  const [user, setUser] = useState<AuthResponse | null>(() => {
    try {
      const savedUser = localStorage.getItem("user");
      const token = localStorage.getItem("token");
      if (savedUser && token) {
        return JSON.parse(savedUser) as AuthResponse;
      }
    } catch {
      // Corrupt storage — clear it and force re-login
      localStorage.removeItem("user");
      localStorage.removeItem("token");
    }
    return null;
  });

  /**
   * Persist session data and update state atomically.
   * Post-login navigation is handled by a useEffect watching `user` in the
   * consuming component — never imperatively here.
   */
  const login = useCallback((data: AuthResponse): void => {
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data));
    setUser(data);
  }, []);

  const logout = useCallback((): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
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
      // Reset to HealthArk defaults when logged out
      document.title = "HealthArk PMS";
      setFavicon("/healtharklogo-small.png");
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
   * useMemo here is non-negotiable: without it, every render creates a new
   * value object, causing all consumers to re-render even with stable state.
   * useCallback on each function ensures the deps array stays stable.
   */
  const value = useMemo<AuthContextType>(
    () => ({ user, isAuthenticated, login, logout, hasFeature }),
    [user, isAuthenticated, login, logout, hasFeature],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
