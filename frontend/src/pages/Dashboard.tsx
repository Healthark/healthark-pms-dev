import { useState, useEffect } from "react";
import {
  dashboardService,
  type DashboardSummary,
} from "../services/dashboard.service";
import { useAuth } from "../hooks/useAuth";
import { GoalsWidget } from "../components/dashboard/GoalsWidget";
import { ActiveCycleWidget } from "../components/dashboard/ActiveCycleWidget";
import { MenteesWidget } from "../components/dashboard/MenteesWidget";

// Skeleton shown while the summary is loading
function WidgetSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="h-3 w-24 rounded bg-slate-100" />
      </div>
      <div className="h-7 w-16 rounded bg-slate-100 mb-3" />
      <div className="space-y-2">
        <div className="h-2.5 w-full rounded bg-slate-100" />
        <div className="h-2.5 w-3/4 rounded bg-slate-100" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user, hasFeature } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    dashboardService
      .getSummary()
      .then(setSummary)
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">
          Failed to load dashboard. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {user?.full_name.split(" ")[0]}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Here's a summary of what's on your plate.
        </p>
      </div>

      {/* Widget grid — renders skeletons while loading, real widgets once data arrives */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {isLoading || !summary ? (
          <>
            <WidgetSkeleton />
            <WidgetSkeleton />
            {hasFeature("mentoring") && <WidgetSkeleton />}
          </>
        ) : (
          <>
            <GoalsWidget summary={summary} />
            <ActiveCycleWidget summary={summary} />
            {hasFeature("mentoring") && <MenteesWidget summary={summary} />}
          </>
        )}
      </div>
    </div>
  );
}
