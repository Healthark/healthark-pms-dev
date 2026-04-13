import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { YearlyGoals } from "./pages/YearlyGoals";
import AdminPanel from "./pages/AdminPanel";
import { Profile } from "./pages/Profile";
import Unauthorized from "./pages/Unauthorized";
import { AnnualReviews } from "./pages/AnnualReviews";
import { ProjectReviews } from "./pages/ProjectReviews";

/**
 * AppShell renders the persistent chrome (Sidebar + Topbar) around all
 * authenticated pages. <Outlet /> is where the matched child route renders.
 */
function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-background p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Stage 1 — must be authenticated */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<ProtectedRoute requiredFeature="dashboard" />}>
              <Route path="/dashboard" element={<Dashboard />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="goals" />}>
              <Route path="/yearly-goals" element={<YearlyGoals />} />
            </Route>

            <Route
              element={<ProtectedRoute requiredFeature="annual_reviews" />}
            >
              <Route path="/annual-reviews" element={<AnnualReviews />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="admin" requiredRole={["Admin"]}/>}>
              <Route path="/admin" element={<AdminPanel />} />
            </Route>

            <Route element={<ProtectedRoute requiredFeature="project_reviews" />}>
              <Route path="/project-reviews" element={<ProjectReviews />} />
            </Route>
            {/* Profile — always visible, no feature gate */}
            <Route path="/profile" element={<Profile />} />
            {/*
              Future routes:

              <Route element={<ProtectedRoute requiredFeature="mentoring" />}>
                <Route path="/my-mentees" element={<MyMentees />} />
              </Route>
            */}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
