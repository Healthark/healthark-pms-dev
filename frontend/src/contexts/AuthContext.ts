import { createContext } from "react";
import type { AuthResponse } from "../services/auth.service";

/**
 * Describes everything a consumer can read from or do with auth state.
 * `hasFeature` is the primary guard utility for Story 1.2.
 */
export interface AuthContextType {
  user: AuthResponse | null;
  isAuthenticated: boolean;
  login: (data: AuthResponse) => void;
  logout: () => void;
  /**
   * Returns true if the current user's organization has the given feature enabled.
   * Usage: hasFeature("goals"), hasFeature("mentoring")
   */
  hasFeature: (feature: string) => boolean;
}

// Undefined sentinel forces consumers through the useAuth hook,
// which throws a clear dev-time error if used outside the Provider.
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);
