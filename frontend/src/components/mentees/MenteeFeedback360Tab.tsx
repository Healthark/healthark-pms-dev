/**
 * MenteeFeedback360Tab — read-only 360 feedback for a mentee, on the My
 * Mentees detail page. Reuses the same anonymized AggregateView as the
 * 360 Feedback page (per-competency whiskers + remark cards, with the
 * ≥N-reviewer anonymity gate enforced server-side). A year picker lets the
 * mentor look back at previous fiscal years; it defaults to the newest.
 *
 * Mentor access is enforced by the API (GET /aggregate/{id} allows self,
 * direct mentor, or Management) — this tab just renders.
 */

import { useState } from "react";
import { useFeedbackAggregateYears } from "../../queries/feedback360";
import { AggregateView } from "../feedback360/AggregateView";
import { formatFyYearSpan } from "../../utils/fy";

interface MenteeFeedback360TabProps {
  readonly menteeId: number;
  readonly menteeName: string;
}

export function MenteeFeedback360Tab({
  menteeId,
  menteeName,
}: MenteeFeedback360TabProps) {
  const { data: years = [] } = useFeedbackAggregateYears(menteeId);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  // Default to the newest year once the list loads; until then AggregateView
  // (fyYear undefined) shows the active cycle.
  const effectiveYear = selectedYear ?? years[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-text-muted">
          Anonymous 360 feedback received by {menteeName}. Reviewer identities
          are never shown.
        </p>
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-360-year"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Fiscal Year
            </label>
            <select
              id="mentee-360-year"
              value={effectiveYear ?? ""}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {formatFyYearSpan(y)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <AggregateView
        key={effectiveYear ?? "active"}
        targetUserId={menteeId}
        fyYear={effectiveYear ?? undefined}
        heading={`${menteeName}'s 360 feedback`}
        showRemarks
      />
    </div>
  );
}
