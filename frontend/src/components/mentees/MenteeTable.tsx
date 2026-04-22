import { ArrowRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "../../services/mentee.service";

interface MenteeTableProps {
  readonly mentees: readonly MenteeSummary[];
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function reviewShortLabel(review: MenteeSummary["review"]): string {
  if (!review.status) return "—";
  const label = (() => {
    switch (review.status) {
      case "draft":
        return "Self-review";
      case "pending_mentor":
        return "Pending review";
      case "pending_management":
        return "With management";
      case "completed":
        return "Completed";
      default:
        return "In progress";
    }
  })();
  return review.cycle_name ? `${review.cycle_name} · ${label}` : label;
}

function goalsSummary(goals: MenteeSummary["goals"]): string {
  if (goals.total === 0) return "—";
  return `${goals.approved}/${goals.total} approved`;
}

function projectsSummary(projects: MenteeSummary["projects"]): string {
  if (projects.active_count === 0) return "—";
  const pending = projects.pending_reviews_count;
  const pendingNote = pending > 0
    ? ` · ${pending} pending`
    : "";
  return `${projects.active_count} active${pendingNote}`;
}

export function MenteeTable({ mentees }: MenteeTableProps) {
  const thCls =
    "px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-slate-50/80">
            <th className={thCls}>Mentee</th>
            <th className={thCls}>Designation</th>
            <th className={thCls}>Department</th>
            <th className={thCls}>Goals</th>
            <th className={thCls}>Review</th>
            <th className={thCls}>Projects</th>
            <th className={thCls}>Rating</th>
            <th className={thCls}>Pending</th>
            <th className={`${thCls} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {mentees.map((m) => {
            const hasPending = m.pending_actions_count > 0;
            const initials = initialsFor(m.full_name);
            return (
              <tr
                key={m.user_id}
                className="border-b border-border last:border-b-0 hover:bg-slate-50/60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white shrink-0"
                      aria-hidden="true"
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-main">
                        {m.full_name}
                      </p>
                      <p className="truncate text-[11px] text-text-muted">
                        {m.employee_code}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-main">
                  {m.designation_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {m.department_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {goalsSummary(m.goals)}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {reviewShortLabel(m.review)}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {projectsSummary(m.projects)}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {m.projects.latest_performance_group ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {hasPending ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {m.pending_actions_count}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/my-mentees/${m.user_id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    View details
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
