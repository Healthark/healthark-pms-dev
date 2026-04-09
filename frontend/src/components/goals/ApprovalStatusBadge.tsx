import type { ApprovalStatus } from "../../services/goal.service";

interface ApprovalStatusBadgeProps {
  readonly status: ApprovalStatus;
}

const CONFIG: Record<ApprovalStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-500" },
  submitted: { label: "Pending Review", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700" },
  changes_requested: {
    label: "Changes Requested",
    cls: "bg-amber-100 text-amber-700",
  },
};

export function ApprovalStatusBadge({ status }: ApprovalStatusBadgeProps) {
  const { label, cls } = CONFIG[status] ?? CONFIG.draft;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
