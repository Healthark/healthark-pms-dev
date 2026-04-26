import type { ApprovalStatus } from "../../services/goal.service";

interface ApprovalStatusBadgeProps {
  readonly status: ApprovalStatus;
}

const CONFIG: Record<ApprovalStatus, { label: string; cls: string }> = {
  draft:                { label: "Draft",                cls: "bg-slate-100 text-slate-600" },
  pending_approval:     { label: "Pending Approval",     cls: "bg-blue-100 text-blue-700" },
  changes_requested:    { label: "Changes Requested",    cls: "bg-amber-100 text-amber-700" },
  approved:             { label: "Approved",             cls: "bg-emerald-100 text-emerald-700" },
  h1_self_reviewed:     { label: "H1 Self-Reviewed",     cls: "bg-teal-100 text-teal-700" },
  h1_mentor_reviewed:   { label: "H1 Mentor-Reviewed",   cls: "bg-cyan-100 text-cyan-700" },
  h2_self_reviewed:     { label: "H2 Self-Reviewed",     cls: "bg-indigo-100 text-indigo-700" },
  h2_mentor_reviewed:   { label: "H2 Mentor-Reviewed",   cls: "bg-violet-100 text-violet-700" },
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
