/**
 * AnnualReviewFunnelCard — admin dashboard card showing annual-review
 * progress for the active cycle.
 *
 * Five stages from a single GET /annual-reviews/funnel call (admin-gated):
 * Not Started → Draft → Pending Mentor → Pending Management → Completed.
 * Unlike Miltenyi's funnel, the denominator is the full active headcount,
 * so "Not Started" is a real segment (we have the roster concept). Rendered
 * as a stacked bar + legend with a "X of Y complete" headline; "View all →"
 * deep-links to the All Reviews tab.
 */

import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAnnualReviewFunnel } from "../../queries/annualReviews";
import { formatFyLabel } from "../../utils/fy";

// Progression ramp: gray (early) → amber → blue → green (done). Inline
// colors (not theme tokens) so the bar stays calm regardless of the brand
// accent, matching the rest of the dashboard's quiet data viz.
const SEGMENTS = [
  { key: "not_started", label: "Not Started", color: "#cbd5e1" },
  { key: "draft", label: "Draft", color: "#94a3b8" },
  { key: "pending_mentor", label: "Pending Mentor", color: "#fbbf24" },
  { key: "pending_management", label: "Pending Management", color: "#60a5fa" },
  { key: "completed", label: "Completed", color: "#34d399" },
] as const;

export function AnnualReviewFunnelCard() {
  const { data, isPending, error } = useAnnualReviewFunnel();

  const fyLabel = data?.cycle_name ? formatFyLabel(data.cycle_name) : null;
  const total = data?.total ?? 0;
  const completed = data?.completed ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const hasData = !!data && data.cycle_name != null && total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Annual Review Progress
            </p>
            {fyLabel && (
              <p className="mt-0.5 text-[11px] text-text-muted">{fyLabel}</p>
            )}
          </div>
        </div>
        <Link
          to="/annual-reviews?tab=all"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isPending ? (
        <div className="animate-pulse space-y-3">
          <div className="h-7 w-24 rounded bg-surface-hover" />
          <div className="h-3 w-full rounded-full bg-surface-hover" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 rounded bg-surface-hover" />
            ))}
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600 dark:text-rose-300">
          Couldn't load review progress.
        </p>
      ) : !hasData ? (
        <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-5 text-center text-sm text-text-muted">
          {data?.cycle_name == null
            ? "No active fiscal year configured."
            : "No employees in this cycle yet."}
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold text-text-main leading-none">
              {completed}
              <span className="text-base font-normal text-text-muted">
                /{total}
              </span>
            </span>
            <span className="text-xs text-text-muted">completed · {pct}%</span>
          </div>

          {/* Stacked progress bar */}
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-surface-hover"
            role="img"
            aria-label={`${completed} of ${total} annual reviews complete (${pct}%)`}
          >
            {SEGMENTS.map((seg) => {
              const count = data[seg.key];
              if (count <= 0) return null;
              return (
                <div
                  key={seg.key}
                  style={{
                    width: `${(count / total) * 100}%`,
                    backgroundColor: seg.color,
                  }}
                  title={`${seg.label}: ${count}`}
                />
              );
            })}
          </div>

          {/* Legend */}
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            {SEGMENTS.map((seg) => (
              <li key={seg.key} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                  aria-hidden="true"
                />
                <span className="font-semibold text-text-main tabular-nums">
                  {data[seg.key]}
                </span>
                <span className="text-text-muted truncate">{seg.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
