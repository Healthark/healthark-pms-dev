import { LayoutDashboard } from "lucide-react";

/**
 * Dashboard — placeholder.
 *
 * The role-specific dashboard is being rebuilt from scratch; until then this
 * renders a single "coming soon" state for every role. The previous widgets
 * lived in components/dashboard/ and were removed.
 */
export function Dashboard() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
        <LayoutDashboard className="h-7 w-7 text-brand" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-xl font-semibold text-text-main">
        Dashboard coming soon
      </h1>
      <p className="mt-1 max-w-sm text-sm text-text-muted">
        We're rebuilding the dashboard. Check back after the next update.
      </p>
    </div>
  );
}
