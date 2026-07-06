/**
 * GoalMentorReviewModal.tsx — Split-panel modal for mentor review of a mentee's
 * self-review, simplified to a single paragraph each side.
 *
 * Layout:
 *   Top (full-width)  — the shared role-expectation card (RoleExpectationsCard),
 *                       scoped to the mentee's (goal owner's) department ×
 *                       designation. Same card used on the Annual Goals page.
 *   Left panel        — read-only display of the mentee's self-review paragraph.
 *   Right panel       — mentor fills a single paragraph (or views read-only
 *                       when a mentor review already exists for this half).
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardCheck,
  Send,
  Loader2,
  Save,
  X,
  User,
  MessageSquarePlus,
} from "lucide-react";
import type {
  Goal,
  GoalMentorReviewPayload,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import { useGoalDetail } from "../../queries/goals";
import {
  projectReviewService,
  type RoleExpectation,
} from "../../services/project-review.service";
import { RoleExpectationsCard } from "./RoleExpectationsCard";
import { formatFyYearSpan } from "../../utils/fy";
import { halfDisplayLabel, isHalfWindowOpen } from "../../utils/goalStatus";
import { getOwnerRole } from "../../utils/goalOwner";
import { useSystemSettings } from "../../hooks/useSystemSettings";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

function cycleLabel(
  goal: Goal,
  cycleHalf: SelfReviewCycleHalf,
  cycleType: string | null,
): string {
  const display = halfDisplayLabel(cycleHalf, cycleType);
  return goal.fy_year ? `${display} ${formatFyYearSpan(goal.fy_year)}` : display;
}

// ── Props ────────────────────────────────────────────────────────────

interface GoalMentorReviewModalProps {
  readonly isOpen: boolean;
  readonly goal: Goal | null;
  readonly cycleHalf: SelfReviewCycleHalf | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => Promise<void>;
  readonly onSaveDraft?: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => Promise<void>;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

// ── Component ────────────────────────────────────────────────────────

export function GoalMentorReviewModal({
  isOpen,
  goal,
  cycleHalf,
  onClose,
  onSubmit,
  onSaveDraft,
  isSaving,
  isDraftSaving = false,
  error,
}: GoalMentorReviewModalProps) {
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  // The /goals/team list response was slimmed (PR 18) to drop the heavy
  // self_overall_review + mentor_overall_review text bodies. The modal
  // fetches the full goal on open to populate the read-only self-review
  // pane + pre-fill the mentor-review textarea when a draft already
  // exists. `useGoalDetail` is gated on isOpen so the request only fires
  // when the modal mounts, and the result is cached for subsequent opens.
  const detailQuery = useGoalDetail(isOpen && goal ? goal.id : null);
  const detail = detailQuery.data;
  const isLoadingDetail = detailQuery.isPending && detailQuery.fetchStatus !== "idle";

  // Use the mentee's submitted self-review (drafts are owner-only).
  const selfReview =
    detail && cycleHalf
      ? detail.self_reviews.find(
          (sr) => sr.cycle_half === cycleHalf && !sr.is_draft,
        ) ?? null
      : null;

  const existingMentorReview =
    detail && cycleHalf
      ? detail.mentor_reviews.find((mr) => mr.cycle_half === cycleHalf) ?? null
      : null;

  // Mentor drafts stay editable; only a final non-draft row locks the modal.
  const isReadOnly =
    existingMentorReview !== null && !existingMentorReview.is_draft;
  const isDraft =
    existingMentorReview !== null && existingMentorReview.is_draft;

  const [overall, setOverall] = useState("");
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
  const [expectationsLoaded, setExpectationsLoaded] = useState(false);

  // Re-seed the textarea whenever the modal opens on a different (goal, half).
  // Gated on `detail` so the draft text fetched from /goals/{id} is available
  // before we seed — otherwise we'd seed empty, then re-seed once detail
  // arrived, which could clobber any text the mentor typed in that window.
  useEffect(() => {
    if (!isOpen || !detail) return;
    setOverall(
      existingMentorReview ? existingMentorReview.mentor_overall_review : "",
    );
    // `existingMentorReview` is intentionally not in deps — it's derived from
    // `detail` + `cycleHalf` which are both already tracked, and including
    // it would re-fire the effect on every render that produces a fresh
    // .find() result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, detail, goal?.id, cycleHalf]);

  // Fetch role-expectation rows once when the modal first opens. The org
  // typically only has 9 of these; cache once and filter client-side by
  // the owner's department + designation.
  useEffect(() => {
    if (!isOpen || expectations.length > 0) return;
    let cancelled = false;
    projectReviewService
      .getRoleExpectations()
      .then((rows) => {
        if (!cancelled) setExpectations(rows);
      })
      .catch(() => {
        // Non-fatal — the card falls back to a "not configured" note.
      })
      .finally(() => {
        if (!cancelled) setExpectationsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, expectations.length]);

  if (!isOpen || !goal || !cycleHalf) return null;

  const { dept, desig } = getOwnerRole(goal);
  const ownerExpectation: RoleExpectation | null =
    dept && desig
      ? expectations.find(
          (e) => e.department_name === dept && e.designation_name === desig,
        ) ?? null
      : null;

  // Once the fetch has resolved with no match, surface a clear note instead of
  // a silently-blank section so the reviewer understands why the mentee's
  // expectations aren't shown (role not configured, or no dept/designation set).
  const showExpectationNote = !ownerExpectation && expectationsLoaded;
  const expectationEmptyMessage =
    dept && desig
      ? `No role expectations are configured for ${dept} · ${desig} yet.`
      : "This mentee's department or designation isn't set, so role expectations can't be shown.";

  const allFilled = overall.trim().length > 0;
  // The mentor's submit is window-gated on the backend (is_review_window_open);
  // reflect that here so Submit is disabled with a reason rather than erroring
  // after the fact (mirrors the mentee-side SelfReviewCycleMenu gate).
  const windowOpen = isHalfWindowOpen(
    cycleHalf,
    goal.fy_year,
    settings?.active_cycle_name,
  );

  const handleSubmit = async () => {
    await onSubmit(cycleHalf, { mentor_overall_review: overall.trim() });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    await onSaveDraft(cycleHalf, { mentor_overall_review: overall });
  };

  const label = cycleLabel(goal, cycleHalf, cycleType);
  const titleSuffix = isReadOnly
    ? " (Submitted)"
    : isDraft
      ? " (Draft)"
      : "";
  const title = `Mentor Review · ${label}${titleSuffix}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mentor-review-modal-title"
    >
      <div className="w-full max-w-5xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light shrink-0">
              <MessageSquarePlus className="h-5 w-5 text-brand" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="mentor-review-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">{goal.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover transition-colors"
            aria-label="Close mentor review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Role-expectation reference card (above the split) — same card as
            the Annual Goals page, scoped to the mentee being reviewed. ── */}
        {(ownerExpectation || showExpectationNote) && (
          <div className="border-b border-border px-6 py-3 shrink-0">
            <RoleExpectationsCard
              expectation={ownerExpectation}
              title="Mentee Role Expectations"
              emptyMessage={
                showExpectationNote ? expectationEmptyMessage : undefined
              }
            />
          </div>
        )}

        {/* ── Body — two-panel layout ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Mentee self-review (read-only paragraph) */}
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-muted/80 shrink-0">
              <User className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Mentee Self Review
              </span>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-6 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading review…
                </div>
              ) : selfReview === null ? (
                <div className="rounded-lg border border-border bg-surface-muted px-4 py-6 text-center text-sm text-text-muted">
                  The mentee has not submitted their self-review for this half yet.
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                  {selfReview.self_overall_review || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Right: Mentor review (editable or read-only) */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-brand/5 shrink-0">
              <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                Mentor Review
              </span>
              {isReadOnly && (
                <span className="ml-auto text-[10px] font-medium text-green-600 dark:text-green-300 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded px-1.5 py-0.5">
                  Submitted
                </span>
              )}
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-3">
              {error && (
                <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
                  {error}
                </p>
              )}

              {!isLoadingDetail && selfReview === null && !isReadOnly && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  You can draft your review now, but you can only submit it once
                  the mentee has submitted their self-review.
                </div>
              )}

              {!isLoadingDetail && selfReview !== null && !isReadOnly && !windowOpen && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  The review window for this cycle is closed — a mentor review
                  can no longer be submitted for it.
                </div>
              )}

              <div>
                <label
                  htmlFor="mentor-overall"
                  className="block text-xs font-semibold text-text-main mb-1"
                >
                  Mentor Review
                  {!isReadOnly && " *"}
                </label>
                {isReadOnly ? (
                  <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                    {overall || "—"}
                  </div>
                ) : (
                  <textarea
                    id="mentor-overall"
                    rows={12}
                    className={TEXTAREA_CLS}
                    value={overall}
                    onChange={(e) => setOverall(e.target.value)}
                    placeholder="Your assessment of the mentee's delivery this half — what was strong, where to grow, and how it ties into the role expectations above."
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 shrink-0">
          <p className="text-xs text-text-muted">
            {isReadOnly
              ? "Mentor review is locked once submitted."
              : selfReview === null
                ? "You can draft now; submitting unlocks once the mentee submits their self-review."
                : isDraft
                  ? "Draft saved — keep editing or submit when ready."
                  : "Drafts can be saved and edited; submit when ready."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
            >
              {isReadOnly ? "Close" : "Cancel"}
            </button>
            {!isReadOnly && onSaveDraft && (
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSaving || isDraftSaving}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-surface-muted disabled:opacity-50 transition-colors"
              >
                {isDraftSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                {isDraftSaving ? "Saving…" : "Save Draft"}
              </button>
            )}
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSaving || isDraftSaving || !allFilled || !windowOpen || selfReview === null}
                title={selfReview === null ? "The mentee must submit their self-review before you can submit." : undefined}
                className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                {isSaving ? "Submitting…" : "Submit Review"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
