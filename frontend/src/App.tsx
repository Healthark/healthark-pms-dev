import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  useLocation,
} from "react-router-dom";
import { Sidebar } from "./layouts/Sidebar";
import { Topbar } from "./layouts/Topbar";

// Import our new pages
import { Dashboard } from "./pages/Dashboard";
import { YearlyGoals } from "./pages/YearlyGoals";

// 1. Define the persistent Layout wrapper
function RootLayout() {
  const location = useLocation();
  // We extract the current path to pass to the Topbar for the title
  const currentPath = location.pathname.replace("/", "") || "dashboard";

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Topbar currentPage={currentPath} />
        <main className="flex-1 overflow-y-auto p-8">
          {/* This Outlet is where our pages (Dashboard, YearlyGoals) will be injected */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// 2. Define the Routing Logic
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Everything inside this Route inherits the RootLayout */}
        <Route element={<RootLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/yearly-goals" element={<YearlyGoals />} />
          {/* Add more routes here later as we build them */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
