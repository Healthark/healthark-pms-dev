import {
  Target,
  FileText,
  Briefcase,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Star,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "../../services/mentee.service";

interface MenteeCardProps {
  readonly mentee: MenteeSummary;
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

function reviewLabel(review: MenteeSummary["review"]): string {
  if (!review.status) return "No review yet";
  switch (review.status) {
    case "draft":
      return `${review.cycle_name} · Self-review in progress`;
    case "pending_mentor":
      return `${review.cycle_name} · Pending your review`;
    case "pending_management":
      return `${review.cycle_name} · With management`;
    case "completed":
      return `${review.cycle_name} · Completed`;
    default:
      return review.cycle_name ?? "In progress";
  }
}

export function MenteeCard({ mentee }: MenteeCardProps) {
  const hasPending = mentee.pending_actions_count > 0;
  const initials = initialsFor(mentee.full_name);
  const subtitle = [mentee.designation_name, mentee.department_name]
    .filter(Boolean)
    .join(" · ");

  const pendingLabel = `${mentee.pending_actions_count} item${
    mentee.pending_actions_count === 1 ? "" : "s"
  } need${mentee.pending_actions_count === 1 ? "s" : ""} your attention`;

  // Pick the most relevant quick-action destination. Goals tab takes priority
  // because a submitted goal is the most common mentor action.
  const quickActionTab = mentee.goals.submitted > 0
    ? "goals"
    : mentee.review.status === "pending_mentor"
    ? "review"
    : "profile";
  const quickActionLabel = mentee.goals.submitted > 0
    ? "Review goals"
    : mentee.review.status === "pending_mentor"
    ? "Evaluate review"
    : "View profile";

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-sm transition hover:shadow-md ${
        hasPending ? "border-border border-l-4 border-l-amber-400" : "border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-white shrink-0"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text-main">{mentee.full_name}</p>
          <p className="truncate text-xs text-text-muted">
            {subtitle || mentee.role}
          </p>
        </div>
        <span
          className={`flex h-2.5 w-2.5 shrink-0 rounded-full ${
            mentee.is_active ? "bg-green-500" : "bg-slate-300"
          }`}
          aria-label={mentee.is_active ? "Active" : "Inactive"}
        />
      </div>

      {/* Mini-stats */}
      <div className="flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2.5">
        <StatRow
          icon={Target}
          label="Goals"
          value={
            mentee.goals.total === 0
              ? "No annual goals yet"
              : `${mentee.goals.approved}/${mentee.goals.total} approved · ${mentee.goals.avg_progress_percent}% avg`
          }
        />
        <StatRow
          icon={FileText}
          label="Review"
          value={reviewLabel(mentee.review)}
          rightSlot={
            mentee.review.mentor_performance_rating !== null ? (
              <span className="flex items-center gap-0.5 text-xs font-medium text-amber-600">
                <Star className="h-3.5 w-3.5 fill-amber-500 stroke-amber-500" aria-hidden="true" />
                {mentee.review.mentor_performance_rating}
              </span>
            ) : null
          }
        />
        <StatRow
          icon={Briefcase}
          label="Projects"
          value={
            mentee.projects.active_count === 0
              ? "No active projects"
              : `${mentee.projects.active_count} active · ${mentee.projects.pending_reviews_count} review${
                  mentee.projects.pending_reviews_count === 1 ? "" : "s"
                } pending`
          }
        />
      </div>

      {/* Attention strip */}
      {hasPending ? (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {pendingLabel}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          All caught up
        </div>
      )}

      {/* Footer — quick action + view details */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        {hasPending ? (
          <Link
            to={`/my-mentees/${mentee.user_id}?tab=${quickActionTab}`}
            className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand/90"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {quickActionLabel}
          </Link>
        ) : (
          <span className="text-xs text-text-muted italic">No pending actions</span>
        )}
        <Link
          to={`/my-mentees/${mentee.user_id}`}
          className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          View details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
  rightSlot,
}: {
  readonly icon: typeof Target;
  readonly label: string;
  readonly value: string;
  readonly rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {label}
          </p>
          <p className="truncate text-xs text-text-main">{value}</p>
        </div>
        {rightSlot}
      </div>
    </div>
  );
}
