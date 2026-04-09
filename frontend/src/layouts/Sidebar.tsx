import { useState } from "react";
import {
  LayoutDashboard,
  Briefcase,
  Target,
  Users,
  FileText,
  User,
  HelpCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface NavItemData {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// 1. Updated NavItem to accept the new isCollapsed prop
const NavItem = ({
  item,
  isCollapsed,
}: {
  readonly item: NavItemData;
  readonly isCollapsed: boolean;
}) => {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      title={isCollapsed ? item.label : undefined} // Shows a native tooltip when collapsed
      className={({ isActive }) =>
        `w-full flex items-center rounded-lg transition-all duration-200 ${
          isCollapsed ? "justify-center py-3 px-0" : "px-4 py-2.5 gap-3"
        } ${
          isActive
            ? "bg-brand-light text-brand font-semibold"
            : "text-text-muted hover:bg-slate-50 hover:text-text-main font-medium"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`w-5 h-5 shrink-0 transition-colors ${
              isActive ? "text-brand" : "text-text-muted"
            }`}
          />
          {/* Only render the text if NOT collapsed */}
          {!isCollapsed && (
            <span className="text-[14px] whitespace-nowrap overflow-hidden">
              {item.label}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
};

export function Sidebar() {
  // 2. Add state to track if the sidebar is open or closed
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = (): void => {
    logout();
    navigate("/login", { replace: true });
  };
  const mainNav: NavItemData[] = [
    {
      id: "dashboard",
      path: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      id: "project-reviews",
      path: "/project-reviews",
      label: "Project Reviews",
      icon: Briefcase,
    },
    {
      id: "yearly-goals",
      path: "/yearly-goals",
      label: "Yearly Goals",
      icon: Target,
    },
    { id: "my-mentees", path: "/my-mentees", label: "My Mentees", icon: Users },
    {
      id: "practitioners",
      path: "/practitioners",
      label: "Practitioners Reviews",
      icon: FileText,
    },
  ];

  const bottomNav: NavItemData[] = [
    { id: "profile", path: "/profile", label: "Profile", icon: User },
    { id: "support", path: "/support", label: "Support", icon: HelpCircle },
  ];

  return (
    // 3. Dynamic width and relative positioning on the main wrapper
    <aside
      className={`${
        isCollapsed ? "w-[80px]" : "w-[260px]"
      } h-screen shrink-0 bg-surface border-r border-border flex flex-col transition-all duration-300 relative`}
    >
      {/* 4. The Floating Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3.5 top-6 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:text-brand shadow-sm z-50 transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      {/* 5. Dynamic Logo Area */}
      <div
        className={`h-16 flex items-center border-b border-border transition-all duration-300 ${
          isCollapsed ? "justify-center px-0" : "px-6"
        }`}
      >
        {isCollapsed ? (
          <img
            src="/healtharklogo-small.png" // Make sure to add this file to your public/ folder
            alt="Healthark"
            className="h-8 w-8 object-contain shrink-0"
          />
        ) : (
          <>
            <img
              src="/healtharklogov2.png"
              alt="Healthark Insights"
              className="h-7 w-auto object-contain shrink-0"
            />
            <span className="text-text-muted font-normal text-sm ml-1 shrink-0 whitespace-nowrap">
              PMS
            </span>
          </>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-6 flex flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {mainNav.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}
      </nav>

      {/* Bottom Navigation */}
      <div className="p-3 border-t border-border flex flex-col gap-1 overflow-x-hidden">
        {bottomNav.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}

        {/* Updated Logout Button */}
        <button
          onClick={handleLogout}
          title={isCollapsed ? "Logout" : undefined}
          className={`w-full flex items-center rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors mt-2 ${
            isCollapsed ? "justify-center py-3 px-0" : "px-4 py-2.5 gap-3"
          }`}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!isCollapsed && (
            <span className="text-[14px] whitespace-nowrap">Logout</span>
          )}
        </button>
      </div>
    </aside>
  );
}
