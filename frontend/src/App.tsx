import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { NotificationToaster } from "./components/NotificationToaster";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";
import { PageTitleProvider } from "./contexts/PageTitleProvider";
import { SidebarProvider } from "./contexts/SidebarProvider";
import { useSidebar } from "./hooks/useSidebar";
import { useAuth } from "./hooks/useAuth";

const Login = lazy(() =>
  import("./pages/Login").then((m) => ({ default: m.Login })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const AnnualGoals = lazy(() =>
  import("./pages/AnnualGoals").then((m) => ({ default: m.AnnualGoals })),
);
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const ManagementReviews = lazy(() => import("./pages/ManagementReviews"));
const Profile = lazy(() =>
  import("./pages/Profile").then((m) => ({ default: m.Profile })),
);
const Unauthorized = lazy(() => import("./pages/Unauthorized"));
const AnnualReviews = lazy(() =>
  import("./pages/AnnualReviews").then((m) => ({ default: m.AnnualReviews })),
);
const ProjectReviews = lazy(() =>
  import("./pages/ProjectReviews").then((m) => ({ default: m.ProjectReviews })),
);
const MyMentees = lazy(() =>
  import("./pages/MyMentees").then((m) => ({ default: m.MyMentees })),
);
const MenteeDetail = lazy(() =>
  import("./pages/MenteeDetail").then((m) => ({ default: m.MenteeDetail })),
);
const ChangePassword = lazy(() =>
  import("./pages/ChangePassword").then((m) => ({ default: m.ChangePassword })),
);
const ResetPassword = lazy(() =>
  import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })),
);
const Feedback360 = lazy(() =>
  import("./pages/Feedback360").then((m) => ({ default: m.Feedback360 })),
);
const FeedbackGive = lazy(() =>
  import("./pages/FeedbackGive").then((m) => ({ default: m.FeedbackGive })),
);

function Spinner() {
  return (
    <div
      className="flex h-full w-full items-center justify-center py-10"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Wraps the route content. Reads `rightInsetPx` from the layout context so
 * an open right-side drawer (e.g. EvalDrawer) actually claims horizontal
 * space — the page reflows narrower instead of having content hidden under
 * the drawer. Drawer is still `position: fixed`; this is just the gutter.
 *
 * The inner <Suspense> keeps Sidebar/Topbar mounted while a lazily-loaded
 * route chunk resolves — only the main content area shows the spinner.
 */
function MainContent() {
  const { rightInsetPx } = useSidebar();
  return (
    <main
      className="flex-1 overflow-y-auto bg-background p-6 transition-[padding] duration-200"
      style={{
        paddingRight: rightInsetPx ? rightInsetPx + 24 : undefined,
        zoom: 0.9,
      }}
    >
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </main>
  );
}

/**
 * AppShell renders the persistent chrome (Sidebar + Topbar) around all
 * authenticated pages. <Outlet /> is where the matched child route renders.
 */
function AppShell() {
  return (
    <SidebarProvider>
      <PageTitleProvider>
        {/* Headless: watches the polled summary and pops new-notification
            toasts. Lives here so it only runs for authenticated users. */}
        <NotificationToaster />
        <div className="flex h-screen overflow-hidden flex-col">
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Topbar />
              <MainContent />
            </div>
          </div>
        </div>
      </PageTitleProvider>
    </SidebarProvider>
  );
}

/**
 * Auth wrapper for /change-password — kept out of ProtectedRoute so it
 * doesn't trigger the must_change_password redirect loop. We still require
 * authentication: unauthenticated users get bounced to /login.
 */
function RequireAuth({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/*
            Forced change-password screen. Authenticated but deliberately OUTSIDE
            ProtectedRoute so the must_change_password redirect doesn't loop.
          */}
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePassword />
              </RequireAuth>
            }
          />

          {/* Stage 1 — must be authenticated */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route element={<ProtectedRoute requiredFeature="dashboard" />}>
                <Route path="/dashboard" element={<Dashboard />} />
              </Route>

              <Route element={<ProtectedRoute requiredFeature="goals" />}>
                <Route path="/annual-goals" element={<AnnualGoals />} />
              </Route>

              <Route
                element={<ProtectedRoute requiredFeature="annual_reviews" />}
              >
                <Route path="/annual-reviews" element={<AnnualReviews />} />
              </Route>

              <Route element={<ProtectedRoute requiredFeature="admin" requiredRole={["Admin"]}/>}>
                <Route path="/management-reviews" element={<ManagementReviews />} />
                <Route path="/admin" element={<AdminPanel />} />
              </Route>

              <Route element={<ProtectedRoute requiredFeature="project_reviews" />}>
                <Route path="/project-reviews" element={<ProjectReviews />} />
              </Route>
              {/* Profile — always visible, no feature gate */}
              <Route path="/profile" element={<Profile />} />

              <Route element={<ProtectedRoute requiredFeature="mentoring" />}>
                <Route path="/my-mentees" element={<MyMentees />} />
                <Route path="/my-mentees/:id" element={<MenteeDetail />} />
              </Route>

              <Route element={<ProtectedRoute requiredFeature="feedback_360" />}>
                <Route path="/feedback" element={<Feedback360 />} />
                <Route path="/feedback/give/:id" element={<FeedbackGive />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
