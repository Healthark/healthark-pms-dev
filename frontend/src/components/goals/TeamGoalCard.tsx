import { CalendarDays, UserCircle, Check, RotateCcw, Link } from "lucide-react";
import type { TeamGoal } from "../../services/goal.service";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { GoalStatusBadge } from "./GoalStatusBadge";

interface TeamGoalCardProps {
  readonly goal: TeamGoal;
  readonly onApprove: (goal: TeamGoal) => void;
  readonly onRequestChanges: (goal: TeamGoal) => void;
  readonly isActing: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No due date";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TeamGoalCard({
  goal,
  onApprove,
  onRequestChanges,
  isActing,
}: TeamGoalCardProps) {
  const isSubmitted = goal.approval_status === "submitted";
  const isActedOn =
    goal.approval_status === "approved" ||
    goal.approval_status === "changes_requested";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      {/* Employee name */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <UserCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {goal.owner_name}
      </div>

      {/* Title */}
      <p className="font-medium text-text-main leading-snug">{goal.title}</p>

      {/* Description */}
      {goal.description && (
        <p className="text-sm text-text-muted line-clamp-2">
          {goal.description}
        </p>
      )}

      {/* Attachment link — mentor needs to review the referenced material */}
      {goal.attachment_url && (
        <a
          href={goal.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-brand hover:underline truncate w-fit"
        >
          <Link className="h-3 w-3 shrink-0" aria-hidden="true" />
          Attachment
        </a>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <GoalStatusBadge status={goal.status} />
        <ApprovalStatusBadge status={goal.approval_status} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatDate(goal.due_date)}
        </div>

        {/* Action buttons — only shown for submitted goals */}
        {isSubmitted && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRequestChanges(goal)}
              disabled={isActing}
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Request Changes
            </button>
            <button
              type="button"
              onClick={() => onApprove(goal)}
              disabled={isActing}
              className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </button>
          </div>
        )}

        {isActedOn && (
          <span className="text-xs text-text-muted italic">
            Action recorded
          </span>
        )}
      </div>
    </div>
  );
}
