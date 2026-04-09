import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  useLocation,
  Navigate,
} from "react-router-dom";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";

// Pages
import { Dashboard } from "./pages/Dashboard";
import { YearlyGoals } from "./pages/YearlyGoals";
import { Login } from "./pages/Login";
// Components
import { ProtectedRoute } from "./components/ProtectedRoute"; // <-- Import the bouncer

function RootLayout() {
  const location = useLocation();
  const currentPath = location.pathname.replace("/", "") || "dashboard";

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Topbar currentPage={currentPath} />
        <main className="flex-1 overflow-y-auto p-8">
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
        {/* PUBLIC ROUTE */}
        <Route path="/login" element={<Login />} />

        {/* PROTECTED ROUTES: Nested under the ProtectedRoute bouncer */}
        <Route element={<ProtectedRoute />}>
          <Route element={<RootLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/yearly-goals" element={<YearlyGoals />} />
          </Route>
        </Route>

        {/* CATCH-ALL: Redirect unknown paths to dashboard (which will then bounce to login if needed) */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
