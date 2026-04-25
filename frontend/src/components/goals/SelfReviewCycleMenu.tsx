/**
 * SelfReviewCycleMenu.tsx — Compact 2-row dropdown listing H1 / H2
 * self-review entries for an approved goal.
 *
 * Each row shows: cycle label + submitted status.  Clicking a row fires
 * `onSelect(cycleHalf)` so the parent can open the form modal (either
 * in edit-or-view mode for the mentee, or view-only for the mentor).
 *
 * The dropdown is rendered via a portal into document.body and positioned
 * with `position: fixed` based on the trigger's getBoundingClientRect().
 * This avoids being clipped by ancestor overflow containers (the table's
 * `overflow-x-auto` wrapper, in particular, forces `overflow-y: auto`
 * and would otherwise hide the menu behind the scrollbar edge).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardCheck,
  ChevronDown,
  Check,
  Circle,
  CheckCircle2,
  Eye,
} from "lucide-react";
import type { Goal, SelfReviewCycleHalf } from "../../services/goal.service";
import { formatFyYearSpan } from "../../utils/fy";

interface SelfReviewCycleMenuProps {
  readonly goal: Goal;
  /** "mentee" shows Fill / Submitted; "mentor" shows View / Not submitted. */
  readonly mode: "mentee" | "mentor";
  readonly onSelect: (cycleHalf: SelfReviewCycleHalf) => void;
}

const HALVES: readonly SelfReviewCycleHalf[] = ["H1", "H2"];
const MENU_WIDTH = 224; // Tailwind w-56
const MENU_GAP = 4;

function cycleLabel(goal: Goal, half: SelfReviewCycleHalf): string {
  return goal.fy_year ? `${half} ${formatFyYearSpan(goal.fy_year)}` : half;
}

export function SelfReviewCycleMenu({
  goal,
  mode,
  onSelect,
}: SelfReviewCycleMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Compute the menu position from the trigger's bounding rect.  Called on
  // open, on window resize, and on any scroll (capture: true catches
  // scrolls on ancestors like the table's overflow-x container).
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Anchor the menu's right edge to the trigger's right edge, clamped so
    // the menu never overflows the viewport horizontally.
    const left = Math.max(
      8,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    );
    // Prefer below; flip above when there isn't room.  Estimated menu
    // height: ~120px for two rows.
    const MENU_EST_HEIGHT = 120;
    const belowTop = rect.bottom + MENU_GAP;
    const top =
      belowTop + MENU_EST_HEIGHT <= window.innerHeight
        ? belowTop
        : Math.max(8, rect.top - MENU_GAP - MENU_EST_HEIGHT);
    setPos({ top, left });
  }, []);

  // Position once synchronously on open to avoid a one-frame flicker.
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Reposition on viewport changes while the menu is open.
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, updatePosition]);

  // Close on outside click (must allow clicks inside the portal menu itself).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const submittedCount = goal.self_reviews.length;
  const mentorReviewedCount = goal.mentor_reviews.length;

  const triggerLabel =
    mode === "mentor"
      ? mentorReviewedCount > 0
        ? `Reviews (${mentorReviewedCount}/${submittedCount} reviewed)`
        : submittedCount > 0
        ? `Self Reviews (${submittedCount}/2)`
        : "Self Reviews"
      : submittedCount === 2
      ? "Self Reviews · Submitted"
      : submittedCount === 1
      ? "Self Reviews (1/2)"
      : "Self Review";

  const menu =
    open && pos ? (
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: MENU_WIDTH,
        }}
        className="z-50 rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
        role="menu"
      >
        {HALVES.map((half) => {
          const submitted = goal.self_reviews.some(
            (sr) => sr.cycle_half === half,
          );
          return (
            <button
              key={half}
              type="button"
              role="menuitem"
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
                // Read-only view — icons are status indicators only, not edit actions.
                // CheckCircle2 = mentor has reviewed this half in Team Review tab.
                // Eye          = self-review submitted, awaiting mentor review.
                // Circle       = mentee hasn't submitted yet.
                (() => {
                  const mentorReviewed = goal.mentor_reviews.some(
                    (mr) => mr.cycle_half === half,
                  );
                  if (mentorReviewed) {
                    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
                  }
                  if (submitted) {
                    return <Eye className="h-3.5 w-3.5 text-text-muted shrink-0" />;
                  }
                  return <Circle className="h-3.5 w-3.5 text-text-muted shrink-0" />;
                })()
              ) : submitted ? (
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : (
                <ClipboardCheck className="h-3.5 w-3.5 text-brand shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ClipboardCheck className="h-3 w-3" />
        {triggerLabel}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
