import { useContext } from "react";
import { AuthContext, type AuthContextType } from "../contexts/AuthContext";

/**
 * Typed hook for consuming auth state throughout the application.
 * Throws at development time if used outside of <AuthProvider />.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
