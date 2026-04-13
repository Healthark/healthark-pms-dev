import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface ProtectedRouteProps {
  /**
   * When provided, the route additionally checks that the current user's
   * organization has this feature enabled. Unauthenticated users are always
   * redirected to /login regardless of this prop.
   */
  requiredFeature?: string;
  /**
   * When provided, the route additionally checks that the current user's
   * role is included in this array. If not, they are redirected to /unauthorized.
   */
  requiredRole?: string[];
}

/**
 * Three-stage guard:
 *   Stage 1 — Authentication: No valid session → /login
 *   Stage 2 — Feature Gate:   Feature not enabled for this org → /unauthorized
 *   Stage 3 — Role Gate:      User role not in allowed list → /unauthorized
 *
 * We preserve `location` in state so Login.tsx can redirect back after
 * successful authentication (the "intended destination" pattern).
 */
export function ProtectedRoute({
  requiredFeature,
  requiredRole,
}: Readonly<ProtectedRouteProps>) {
  const { isAuthenticated, hasFeature, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredFeature && !hasFeature(requiredFeature)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requiredRole && !requiredRole.includes(user?.role ?? "")) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}