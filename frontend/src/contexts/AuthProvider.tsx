import { useState, useCallback, useMemo, type ReactNode } from "react";
import { AuthContext, type AuthContextType } from "./AuthContext";
import type { AuthResponse } from "../services/auth.service";

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
