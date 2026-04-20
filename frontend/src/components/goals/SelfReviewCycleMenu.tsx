/**
 * SelfReviewCycleMenu.tsx — Compact 2-row dropdown listing H1 / H2
 * self-review entries for an approved goal.
 *
 * Each row shows: cycle label + submitted status.  Clicking a row fires
 * `onSelect(cycleHalf)` so the parent can open the form modal (either
 * in edit-or-view mode for the mentee, or view-only for the mentor).
 */

import { useEffect, useRef, useState } from "react";
import {
  ClipboardCheck,
  ChevronDown,
  Check,
  Circle,
  Eye,
} from "lucide-react";
import type { Goal, SelfReviewCycleHalf } from "../../services/goal.service";

interface SelfReviewCycleMenuProps {
  readonly goal: Goal;
  /** "mentee" shows Fill / Submitted; "mentor" shows View / Not submitted. */
  readonly mode: "mentee" | "mentor";
  readonly onSelect: (cycleHalf: SelfReviewCycleHalf) => void;
}

const HALVES: readonly SelfReviewCycleHalf[] = ["H1", "H2"];

function cycleLabel(goal: Goal, half: SelfReviewCycleHalf): string {
  return goal.fy_year ? `${half} FY ${goal.fy_year}` : half;
}

export function SelfReviewCycleMenu({
  goal,
  mode,
  onSelect,
}: SelfReviewCycleMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const submittedCount = goal.self_reviews.length;
  const triggerLabel =
    mode === "mentor"
      ? submittedCount > 0
        ? `Self Reviews (${submittedCount}/2)`
        : "Self Reviews"
      : submittedCount === 2
      ? "Self Reviews · Submitted"
      : submittedCount === 1
      ? "Self Reviews (1/2)"
      : "Self Review";

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
      >
        <ClipboardCheck className="h-3 w-3" />
        {triggerLabel}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
          {HALVES.map((half) => {
            const submitted = goal.self_reviews.some(
              (sr) => sr.cycle_half === half,
            );
            return (
              <button
                key={half}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSelect(half);
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-brand/5 transition-colors border-b border-border last:border-b-0"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] font-semibold text-text-main">
                    {cycleLabel(goal, half)}
                  </span>
                  <span
                    className={`text-[10px] ${
                      submitted ? "text-green-600" : "text-text-muted"
                    }`}
                  >
                    {submitted ? (
                      <span className="flex items-center gap-1">
                        <Check className="h-2.5 w-2.5" /> Submitted
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Circle className="h-2.5 w-2.5" /> Not Submitted
                      </span>
                    )}
                  </span>
                </div>
                {mode === "mentor" ? (
                  <Eye className="h-3.5 w-3.5 text-text-muted shrink-0" />
                ) : submitted ? (
                  <Eye className="h-3.5 w-3.5 text-text-muted shrink-0" />
                ) : (
                  <ClipboardCheck className="h-3.5 w-3.5 text-brand shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
