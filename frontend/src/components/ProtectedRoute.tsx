import { Navigate, Outlet } from "react-router-dom";

export const ProtectedRoute = () => {
  // We check if the token exists in localStorage
  // Later, we'll improve this to verify if the token is expired
  const token = localStorage.getItem("token");

  if (!token) {
    // No token? Redirect to login while saving the attempted location
    return <Navigate to="/login" replace />;
  }

  // If token exists, render the child routes (Dashboard, etc.)
  return <Outlet />;
};
