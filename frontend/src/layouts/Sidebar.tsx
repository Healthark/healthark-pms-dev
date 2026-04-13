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
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface NavItemData {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Feature key checked against the org's enabled_features array.
   *  Omit for items that are always visible (Profile, Support). */
  readonly feature?: string;
  /** If set, the item is additionally hidden unless the user has one of these roles. */
  readonly requiredRole?: readonly string[];
}

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
      title={isCollapsed ? item.label : undefined}
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

// ---------------------------------------------------------------------------
// Nav manifest — add `feature` to gate an item behind org feature flags,
// add `requiredRole` to further restrict by user role.
// ---------------------------------------------------------------------------
const MAIN_NAV: NavItemData[] = [
  {
    id: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    feature: "dashboard",
  },
  {
    id: "project-reviews",
    path: "/project-reviews",
    label: "Project Reviews",
    icon: Briefcase,
    feature: "project_reviews",
  },
  {
    id: "yearly-goals",
    path: "/yearly-goals",
    label: "Yearly Goals",
    icon: Target,
    feature: "goals",
  },
  {
    id: "annual-reviews",
    path: "/annual-reviews",
    label: "Annual Reviews",
    icon: FileText,
    feature: "annual_reviews",
  },
  {
    id: "my-mentees",
    path: "/my-mentees",
    label: "My Mentees",
    icon: Users,
    feature: "mentoring",
  },
  {
    id: "practitioners",
    path: "/practitioners",
    label: "Practitioners Reviews",
    icon: FileText,
    feature: "project_reviews",
  },
  {
    id: "admin",
    path: "/admin",
    label: "Admin Panel",
    icon: Settings,
    feature: "admin",
    requiredRole: ["Admin"],
  },
];

// Profile and Support are always visible — no feature flag needed.
const BOTTOM_NAV: NavItemData[] = [
  { id: "profile", path: "/profile", label: "Profile", icon: User },
  { id: "support", path: "/support", label: "Support", icon: HelpCircle },
];

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const { logout, hasFeature, user } = useAuth();

  const handleLogout = (): void => {
    logout();
    navigate("/login", { replace: true });
  };

  /** Returns true if the item should be rendered for the current user. */
  const isVisible = (item: NavItemData): boolean => {
    if (item.feature && !hasFeature(item.feature)) return false;
    if (item.requiredRole && !item.requiredRole.includes(user?.role ?? "")) {
      return false;
    }
    return true;
  };

  const visibleMainNav = MAIN_NAV.filter(isVisible);

  return (
    <aside
      className={`${
        isCollapsed ? "w-[80px]" : "w-[260px]"
      } h-screen shrink-0 bg-surface border-r border-border flex flex-col transition-all duration-300 relative`}
    >
      {/* Floating collapse toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3.5 top-6 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:text-brand shadow-sm z-50 transition-colors"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      {/* Logo — big when expanded, small icon when collapsed */}
      <div
        className={`h-16 flex items-center border-b border-border transition-all duration-300 ${
          isCollapsed ? "justify-center px-0" : "px-6"
        }`}
      >
        {isCollapsed ? (
          <img
            src="/healtharklogo-small.png"
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

      {/* Main navigation */}
      <nav
        aria-label="Main menu"
        className="flex-1 px-3 py-6 flex flex-col gap-1 overflow-y-auto overflow-x-hidden"
      >
        {visibleMainNav.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}
      </nav>

      {/* Bottom navigation + logout */}
      <div className="p-3 border-t border-border flex flex-col gap-1 overflow-x-hidden">
        {BOTTOM_NAV.map((item) => (
          <NavItem key={item.id} item={item} isCollapsed={isCollapsed} />
        ))}

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
