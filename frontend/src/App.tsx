import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { YearlyGoals } from "./pages/YearlyGoals";
import Unauthorized from "./pages/Unauthorized";

/**
 * The AppShell wraps all authenticated pages with the chrome layout.
 * Defined inline here to keep the route tree readable without an extra file.
 */
function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
          {/* Nested <Outlet /> from each ProtectedRoute renders here */}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Protected shell — Stage 1: must be authenticated */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            {/* Always-visible — every authenticated user gets a dashboard */}
            <Route element={<ProtectedRoute requiredFeature="dashboard" />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>

            {/* Feature-gated routes — org must have the feature enabled */}
            <Route element={<ProtectedRoute requiredFeature="goals" />}>
              <Route path="/goals" element={<YearlyGoals />} />
            </Route>

            {/*
              Future routes follow the same pattern:
              <Route element={<ProtectedRoute requiredFeature="project_reviews" />}>
                <Route path="/reviews" element={<ProjectReviews />} />
              </Route>
            */}
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
