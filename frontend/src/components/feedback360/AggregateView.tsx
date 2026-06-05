import { AlertCircle, Loader2, MessageSquareText, UserCircle, Users } from "lucide-react";
import {
  type FeedbackBucketAggregate,
  type FeedbackQuestionAggregate,
  type FeedbackRemark,
} from "../../services/feedback360.service";
import { useFeedbackAggregate } from "../../queries/feedback360";
import { getErrorMessage } from "../../utils/errors";
import { Gridlines } from "./Gridlines";

interface AggregateViewProps {
  /** Target whose 360 aggregate is being displayed. */
  readonly targetUserId: number;
  /** Label rendered in the table header (left side, above n=X). */
  readonly heading?: string;
  /** Render the anonymous remark cards below the matrix. Only enabled
   *  on the My Feedback tab — the backend also only populates
   *  `remarks` for a self-view, so this is a display-side gate on top
   *  of the API gate. */
  readonly showRemarks?: boolean;
}

/**
 * Single-container tabular aggregate. Each question row contains TWO
 * stacked whiskers in the plot column — worked-with on top (brand)
 * and not-worked-with below (amber). Buckets visually rowspan their
 * questions on the left. Cohorts below the anonymity threshold render
 * a muted placeholder line in the same slot, so spacing stays
 * consistent regardless of which cohorts cleared the threshold.
 */
export function AggregateView({
  targetUserId,
  heading,
  showRemarks = false,
}: AggregateViewProps) {
  const {
    data,
    isPending,
    error: queryError,
  } = useFeedbackAggregate(targetUserId);
  const isLoading = isPending;
  const error = queryError ? getErrorMessage(queryError) : "";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading feedback…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300 mt-0.5" />
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.total_reviews === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border py-12 text-center">
        <Users className="h-8 w-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm font-medium text-text-main">
          No feedback yet for FY{String(data.fy_year).slice(-2)}-
          {String(data.fy_year + 1).slice(-2)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          The aggregate will populate as employees submit reviews.
        </p>
      </div>
    );
  }

  // Group by bucket — buckets are visual headings only, no roll-up.
  const grouped: { bucket: string; questions: FeedbackQuestionAggregate[] }[] = [];
  for (const q of data.questions) {
    const last = grouped[grouped.length - 1];
    if (last && last.bucket === q.bucket) {
      last.questions.push(q);
    } else {
      grouped.push({ bucket: q.bucket, questions: [q] });
    }
  }

  return (
    <div className="space-y-6">
    <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
      {/* ── Header row ────────────────────────────────────────────── */}
      <div className="flex items-stretch border-b border-border bg-surface-muted/50">
        <div className="w-[180px] shrink-0 px-6 py-4 border-r border-border/40">
          <h3 className="text-[14px] font-bold text-brand">
            {heading ?? "Feedback Ratings"}
          </h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            n = {data.total_reviews} respondent
            {data.total_reviews === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-col gap-1 text-[10px]">
            <span className="inline-flex items-center gap-1.5 text-brand font-semibold">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Worked with
            </span>
            <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Not worked with
            </span>
          </div>
        </div>
        <div className="flex flex-1">
          <div className="w-[38%] border-r border-border/40" />
          <div className="flex-1 px-6 py-4 relative">
            <div className="absolute inset-x-6 bottom-3 flex justify-between items-end pointer-events-none">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight w-24">
                Very Strongly
                <br />
                Disagree
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight text-center absolute left-1/2 -translate-x-1/2">
                Neither Agree
                <br />
                Nor Disagree
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted leading-tight w-24 text-right">
                Very Strongly
                <br />
                Agree
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bucket groups ─────────────────────────────────────────── */}
      {grouped.map((group, gIdx) => (
        <div
          key={group.bucket}
          className={`flex ${
            gIdx > 0 ? "border-t border-border" : ""
          }`}
        >
          {/* Bucket cell — vertically centered relative to its questions */}
          <div className="w-[180px] shrink-0 flex items-center justify-end px-5 py-4 border-r border-border/40 bg-surface-muted/30">
            <span className="italic font-semibold text-[13px] text-text-main text-right leading-tight">
              {group.bucket}
            </span>
          </div>

          {/* Questions column */}
          <div className="flex flex-1 flex-col">
            {group.questions.map((q, qIdx) => (
              <div
                key={q.key}
                className={`flex ${
                  qIdx > 0 ? "border-t border-border/30" : ""
                }`}
              >
                {/* Statement */}
                <div className="w-[38%] flex items-center justify-end px-4 py-3 border-r border-border/40">
                  <p className="text-[13px] text-text-muted text-right leading-snug">
                    {q.text}
                  </p>
                </div>
                {/* Two stacked whiskers, with gridlines behind them */}
                <div className="flex-1 px-6 py-3 flex flex-col justify-center gap-1.5 min-h-[60px] relative">
                  <Gridlines />
                  <div className="relative z-10">
                    <Whisker
                      cohortKey="worked"
                      data={q.worked_with}
                      threshold={data.min_reviewers_threshold}
                    />
                  </div>
                  <div className="relative z-10">
                    <Whisker
                      cohortKey="not_worked"
                      data={q.not_worked_with}
                      threshold={data.min_reviewers_threshold}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>

      {showRemarks && <RemarksStrip remarks={data.remarks} />}
    </div>
  );
}


// ── Remarks strip ───────────────────────────────────────────────────

/**
 * Horizontally-scrollable row of anonymous remark cards rendered below
 * the matrix on the My Feedback tab. Each card follows the same
 * blue (worked-with) / amber (not-worked-with) theme as the matrix.
 * Renders nothing when there are no surfaced remarks.
 */
function RemarksStrip({ remarks }: { readonly remarks: FeedbackRemark[] }) {
  if (!remarks || remarks.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquareText className="h-4 w-4 text-brand" />
        <h3 className="text-[14px] font-bold text-text-main">
          Remarks
          <span className="ml-1.5 text-[11px] font-normal text-text-muted">
            ({remarks.length} anonymous)
          </span>
        </h3>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {remarks.map((r, i) => (
          <RemarkCard key={i} remark={r} />
        ))}
      </div>
    </div>
  );
}

function RemarkCard({ remark }: { readonly remark: FeedbackRemark }) {
  const worked = remark.worked_with;
  // Same orange/blue treatment as the matrix legend + badges.
  const accent = worked
    ? "border-brand/30 bg-brand/5"
    : "border-amber-500/30 bg-amber-50 dark:bg-amber-950/30";
  const avatar = worked
    ? "bg-brand/10 text-brand"
    : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
  const label = worked
    ? "text-brand"
    : "text-amber-700 dark:text-amber-300";

  return (
    <div
      className={`shrink-0 snap-start w-72 rounded-xl border ${accent} p-4 shadow-sm flex flex-col`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full ${avatar}`}
        >
          <UserCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-text-main leading-tight">
            Anonymous user
          </p>
          <p className={`text-[10px] font-semibold ${label} leading-tight`}>
            {worked ? "Worked with" : "Not worked with"}
          </p>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-text-main">
        {remark.text}
      </p>
    </div>
  );
}


// ── Whisker ────────────────────────────────────────────────────────

function pctFor(rating: number): number {
  return ((rating - 1) / 4) * 100;
}

function Whisker({
  cohortKey,
  data,
  threshold,
}: {
  readonly cohortKey: "worked" | "not_worked";
  readonly data: FeedbackBucketAggregate | null;
  readonly threshold: number;
}) {
  const isWorked = cohortKey === "worked";
  const lineColor = isWorked ? "bg-brand/60" : "bg-amber-500/60";
  const dotColor = isWorked ? "bg-brand" : "bg-amber-500";
  const placeholderColor = isWorked ? "text-brand/60" : "text-amber-700 dark:text-amber-300/70";

  if (!data) {
    return (
      <div className="relative h-5 flex items-center">
        <div className={`absolute h-px w-full ${isWorked ? "bg-brand/15" : "bg-amber-500/15"}`} />
        <p
          className={`relative text-[10px] italic ${placeholderColor} bg-surface px-1.5`}
        >
          Need {threshold}+ reviewers
        </p>
      </div>
    );
  }

  const minPct = pctFor(data.min);
  const maxPct = pctFor(data.max);
  const avgPct = pctFor(data.avg);

  return (
    <div className="relative h-5 flex items-center" title={`avg ${data.avg.toFixed(1)} · range ${data.min}–${data.max} · ${data.count} reviewer${data.count === 1 ? "" : "s"}`}>
      {/* Whisker line (min → max) */}
      <div
        className={`absolute h-[2px] ${lineColor}`}
        style={{
          left: `${minPct}%`,
          width: `${Math.max(maxPct - minPct, 0.001)}%`,
        }}
      />
      {/* Min cap */}
      <div
        className={`absolute h-2.5 w-[2px] ${lineColor}`}
        style={{ left: `${minPct}%`, transform: "translateX(-50%)" }}
      />
      {/* Max cap */}
      <div
        className={`absolute h-2.5 w-[2px] ${lineColor}`}
        style={{ left: `${maxPct}%`, transform: "translateX(-50%)" }}
      />
      {/* Average dot */}
      <div
        className={`absolute h-2.5 w-2.5 rounded-full ${dotColor} ring-2 ring-surface shadow-sm`}
        style={{ left: `${avgPct}%`, transform: "translateX(-50%)", zIndex: 5 }}
      />
    </div>
  );
}
