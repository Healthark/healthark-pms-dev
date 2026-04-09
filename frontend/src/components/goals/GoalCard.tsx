import { CalendarDays, Pencil } from "lucide-react";
import type { Goal } from "../../services/goal.service";
import { GoalStatusBadge } from "./GoalStatusBadge";

interface GoalCardProps {
  readonly goal: Goal;
  readonly onEdit: (goal: Goal) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No due date";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function GoalCard({ goal, onEdit }: GoalCardProps) {
  const isCompleted = goal.status === "completed";
  const isCancelled = goal.status === "cancelled";
  const isDimmed = isCompleted || isCancelled;

  return (
    <div
      className={`rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md ${
        isDimmed ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Title + description */}
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium text-text-main leading-snug ${
              isCompleted ? "line-through text-text-muted" : ""
            }`}
          >
            {goal.title}
          </p>
          {goal.description && (
            <p className="mt-1 text-sm text-text-muted line-clamp-2">
              {goal.description}
            </p>
          )}
        </div>

        {/* Edit action */}
        {!isCancelled && (
          <button
            type="button"
            onClick={() => onEdit(goal)}
            title="Edit goal"
            className="shrink-0 rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatDate(goal.due_date)}
        </div>
        <GoalStatusBadge status={goal.status} />
      </div>
    </div>
  );
}
