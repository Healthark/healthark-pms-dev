import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface ProtectedRouteProps {
  /**
   * When provided, the route additionally checks that the current user's
   * organization has this feature enabled. Unauthenticated users are always
   * redirected to /login regardless of this prop.
   */
  requiredFeature?: string;
}

/**
 * Two-stage guard:
 *   Stage 1 — Authentication: No valid session → /login
 *   Stage 2 — Authorization:  Feature not enabled for this org → /unauthorized
 *
 * We preserve `location` in state so Login.tsx can redirect back after
 * successful authentication (the "intended destination" pattern).
 */
export function ProtectedRoute({
  requiredFeature,
}: Readonly<ProtectedRouteProps>) {
  const { isAuthenticated, hasFeature } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredFeature && !hasFeature(requiredFeature)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
