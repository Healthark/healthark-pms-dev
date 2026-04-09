import type { GoalStatus } from "../../services/goal.service";

interface GoalStatusBadgeProps {
  readonly status: GoalStatus;
}

const STATUS_CONFIG: Record<GoalStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700" },
  in_progress: { label: "In Progress", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500" },
};

export function GoalStatusBadge({ status }: GoalStatusBadgeProps) {
  const { label, cls } = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
