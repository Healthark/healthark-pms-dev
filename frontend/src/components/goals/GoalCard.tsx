import {
  CalendarDays,
  Pencil,
  SendHorizonal,
  MessageSquare,
  PlayCircle,
  CheckCircle2,
  FileText,
} from "lucide-react";
import type { Goal, GoalStatus } from "../../services/goal.service";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";

interface GoalCardProps {
  readonly goal: Goal;
  readonly onEdit: (goal: Goal) => void;
  readonly onSubmit: (goal: Goal) => void;
  readonly onProgressUpdate: (goal: Goal, newStatus: GoalStatus) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No due date";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Single action button that advances the goal along the progress track. */
function ProgressButton({
  goal,
  onProgressUpdate,
}: {
  goal: Goal;
  onProgressUpdate: (goal: Goal, newStatus: GoalStatus) => void;
}) {
  if (goal.status === "pending") {
    return (
      <button
        type="button"
        onClick={() => onProgressUpdate(goal, "in_progress")}
        className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
      >
        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Start
      </button>
    );
  }
  if (goal.status === "in_progress") {
    return (
      <button
        type="button"
        onClick={() => onProgressUpdate(goal, "completed")}
        className="flex items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Mark Complete
      </button>
    );
  }
  return null; // Completed — no further action
}

export function GoalCard({
  goal,
  onEdit,
  onSubmit,
  onProgressUpdate,
}: GoalCardProps) {
  const isSubmitted = goal.approval_status === "submitted";
  const isApproved = goal.approval_status === "approved";
  const isCancelled = goal.status === "cancelled";
  const isCompleted = goal.status === "completed";
  const canSubmit =
    goal.approval_status === "draft" ||
    goal.approval_status === "changes_requested";
  const canEdit = !isSubmitted && !isCancelled;
  const canProgress = isApproved && !isCancelled && !isCompleted;

  return (
    <div
      className={`rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md flex flex-col gap-3 ${
        isCancelled ? "opacity-60" : ""
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <p
          className={`font-medium text-text-main leading-snug flex-1 ${
            isCompleted ? "line-through text-text-muted" : ""
          }`}
        >
          {goal.title}
        </p>
        {canEdit && (
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

      {/* Goal description */}
      {goal.description && (
        <p className="text-sm text-text-muted line-clamp-2">
          {goal.description}
        </p>
      )}

      {/* Manager feedback banner */}
      {goal.approval_status === "changes_requested" &&
        goal.manager_feedback && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <MessageSquare
              className="h-4 w-4 text-amber-600 mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-xs text-amber-800">{goal.manager_feedback}</p>
          </div>
        )}

      {/* Progress notes preview — only shown on approved goals with notes */}
      {isApproved && goal.progress_notes && (
        <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-border px-3 py-2">
          <FileText
            className="h-4 w-4 text-text-muted mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-xs text-text-muted line-clamp-2">
            {goal.progress_notes}
          </p>
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <GoalStatusBadge status={goal.status} />
        <ApprovalStatusBadge status={goal.approval_status} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formatDate(goal.due_date)}
        </div>

        {/* Action area — mutually exclusive states */}
        {canSubmit && (
          <button
            type="button"
            onClick={() => onSubmit(goal)}
            className="flex items-center gap-1.5 rounded-md bg-brand-light px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand hover:text-white transition-colors"
          >
            <SendHorizonal className="h-3.5 w-3.5" aria-hidden="true" />
            Submit for Review
          </button>
        )}

        {canProgress && (
          <ProgressButton goal={goal} onProgressUpdate={onProgressUpdate} />
        )}

        {isApproved && isCompleted && (
          <span className="text-xs font-medium text-green-600">
            ✓ Completed
          </span>
        )}

        {isApproved && !canProgress && !isCompleted && (
          <span className="text-xs font-medium text-green-600">✓ Approved</span>
        )}
      </div>
    </div>
  );
}
