import { Bell } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Derives a readable page title from the current URL pathname so that
 * AppShell never needs to pass a `currentPage` prop.
 * "/project-reviews" → "Project Reviews"
 * "/yearly-goals"    → "Yearly Goals"
 */
function usePageTitle(): string {
  const { pathname } = useLocation();
  return (
    pathname
      .slice(1) // strip leading "/"
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || "Dashboard"
  );
}

export function Topbar() {
  const title = usePageTitle();
  const { user } = useAuth();

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-8 shrink-0">
      <h2 className="font-display font-medium text-lg text-text-main">
        {title}
      </h2>

      <div className="flex items-center gap-4">
        <button
          className="p-2 text-text-muted hover:text-brand transition-colors rounded-full hover:bg-slate-50 relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-surface" />
        </button>

        <div
          className="h-8 w-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-sm"
          aria-label={user?.full_name ?? "User avatar"}
          title={user?.full_name ?? ""}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
