import { Target, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "../../services/dashboard.service";

interface GoalsWidgetProps {
  readonly summary: DashboardSummary;
}

interface StatRowProps {
  readonly label: string;
  readonly count: number;
  readonly dotClass: string;
}

function StatRow({ label, count, dotClass }: StatRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span className="text-sm text-text-muted">{label}</span>
      </div>
      <span className="text-sm font-semibold text-text-main">{count}</span>
    </div>
  );
}

export function GoalsWidget({ summary }: GoalsWidgetProps) {
  const { total_goals, pending_goals, in_progress_goals, completed_goals } =
    summary;

  const completionPct =
    total_goals > 0 ? Math.round((completed_goals / total_goals) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
            <Target className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Annual Goals
            </p>
            <p className="font-display text-2xl font-semibold text-text-main leading-tight">
              {total_goals}
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-text-muted">Completion</span>
          <span className="text-xs font-medium text-text-main">
            {completionPct}%
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={completionPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-1.5 rounded-full bg-brand transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Breakdown */}
      <div className="space-y-2 border-t border-border pt-3">
        <StatRow
          label="Pending"
          count={pending_goals}
          dotClass="bg-amber-400"
        />
        <StatRow
          label="In Progress"
          count={in_progress_goals}
          dotClass="bg-blue-400"
        />
        <StatRow
          label="Completed"
          count={completed_goals}
          dotClass="bg-green-400"
        />
      </div>

      {/* CTA */}
      <Link
        to="/yearly-goals"
        className="flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-auto"
      >
        View all goals <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
