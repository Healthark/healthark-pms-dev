import { useState, useMemo, useCallback, type ReactNode } from "react";
import { AuthContext } from "./AuthContext";
import type { AuthResponse } from "../services/auth.service";

function getStoredUser(): AuthResponse | null {
  const savedUser = localStorage.getItem("user");
  const token = localStorage.getItem("token");
  if (!savedUser || !token) return null;
  try {
    return JSON.parse(savedUser) as AuthResponse;
  } catch {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    return null;
  }
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthResponse | null>(getStoredUser);

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

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
