/**
 * CriteriaChecklist.tsx — Interactive Key Results Tracker (Story 3.3).
 *
 * Displayed inside the annual goal cards/rows for goals that have criteria.
 * Interactivity is gated by:
 *   - `interactive` prop (parent's call: true for the owner's own goals,
 *     false for mentor team views)
 *   - `readOnly` prop (hard override for special read-only surfaces)
 *   - approval_status post-approval check (only Approved + post-Approved
 *     review states can have criteria toggled / proof saved)
 *
 * Mutations go through the shared `useUpdateCriterion` hook so cache
 * invalidation propagates to every consumer of the goals domain.
 *
 * Placement: src/components/goals/CriteriaChecklist.tsx
 */

import { useState, useCallback } from "react";
import { MessageSquareText, ChevronDown, ChevronUp } from "lucide-react";
import {
  type Criterion,
  type ApprovalStatus,
} from "../../services/goal.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { isPostApproved } from "../../utils/goalStatus";
import { useUpdateCriterion } from "../../queries/goals";

interface CriteriaChecklistProps {
  readonly criteria: Criterion[];
  readonly approvalStatus: ApprovalStatus;
  readonly progressPercent: number;
  /**
   * True if the viewer owns the goal and can toggle criteria + save
   * proof. Mentor team views pass `false` (or omit) for a read-only
   * checklist. Combined with `approvalStatus` and `readOnly`.
   */
  readonly interactive?: boolean;
  /** Forces the checklist to render read-only regardless of approval status. */
  readonly readOnly?: boolean;
}

// ── Progress Bar ────────────────────────────────────────────────────

function ProgressBar({ percent }: { readonly percent: number }) {
  const colorClass =
    percent === 100
      ? "bg-green-500"
      : percent >= 50
        ? "bg-blue-500"
        : "bg-amber-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Goal progress: ${percent}%`}
        />
      </div>
      <span className="text-xs font-medium text-text-muted w-8 text-right">
        {percent}%
      </span>
    </div>
  );
}

// ── Single Criterion Row ────────────────────────────────────────────

function CriterionRow({
  criterion,
  canToggle,
}: {
  readonly criterion: Criterion;
  readonly canToggle: boolean;
}) {
  const [showProof, setShowProof] = useState(false);
  const [proofText, setProofText] = useState(criterion.proof_comments ?? "");
  const toast = useToast();
  const snackbar = useSnackbar();

  const updateCriterion = useUpdateCriterion();
  const isToggling = updateCriterion.isPending && updateCriterion.variables?.criterionId === criterion.id;

  const handleToggle = useCallback(async () => {
    if (!canToggle || isToggling) return;
    try {
      await updateCriterion.mutateAsync({
        criterionId: criterion.id,
        payload: { is_completed: !criterion.is_completed },
      });
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  }, [canToggle, isToggling, criterion.id, criterion.is_completed, updateCriterion, snackbar]);

  const handleSaveProof = useCallback(async () => {
    try {
      await updateCriterion.mutateAsync({
        criterionId: criterion.id,
        payload: { proof_comments: proofText.trim() || null },
      });
      setShowProof(false);
      toast.success("Evidence saved.");
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  }, [criterion.id, proofText, updateCriterion, toast, snackbar]);

  const isSavingProof = updateCriterion.isPending && updateCriterion.variables?.criterionId === criterion.id && updateCriterion.variables?.payload?.proof_comments !== undefined;

  return (
    <li className="space-y-1.5">
      <div className="flex items-start gap-2.5">
        {/* Checkbox or read-only indicator */}
        {canToggle ? (
          <button
            type="button"
            onClick={handleToggle}
            disabled={isToggling}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              criterion.is_completed
                ? "bg-green-500 border-green-500 text-white"
                : "border-border hover:border-brand"
            } ${isToggling ? "opacity-50" : ""}`}
            aria-label={`Mark "${criterion.title}" as ${criterion.is_completed ? "incomplete" : "complete"}`}
          >
            {criterion.is_completed && (
              <svg
                className="h-3 w-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </button>
        ) : (
          <span
            className={`mt-0.5 text-sm shrink-0 ${
              criterion.is_completed ? "text-green-600 dark:text-green-300" : "text-text-muted"
            }`}
          >
            {criterion.is_completed ? "✓" : "○"}
          </span>
        )}

        {/* Title + proof toggle */}
        <div className="flex-1 min-w-0">
          <span
            className={`text-sm leading-snug ${
              criterion.is_completed
                ? "line-through text-text-muted"
                : "text-text-main"
            }`}
          >
            {criterion.title}
          </span>

          {/* Proof toggle — only on approved goals */}
          {canToggle && (
            <button
              type="button"
              onClick={() => setShowProof((v) => !v)}
              className="ml-2 inline-flex items-center gap-0.5 text-xs text-text-muted hover:text-brand transition-colors"
              aria-label={showProof ? "Hide proof input" : "Add proof"}
            >
              <MessageSquareText className="h-3 w-3" aria-hidden="true" />
              {criterion.proof_comments ? "Edit proof" : "Add proof"}
            </button>
          )}

          {/* Existing proof preview (read-only contexts) */}
          {!canToggle && criterion.proof_comments && (
            <p className="mt-0.5 text-xs text-text-muted italic">
              {criterion.proof_comments}
            </p>
          )}
        </div>
      </div>

      {/* Proof input area */}
      {showProof && (
        <div className="ml-6.5 pl-0.5 space-y-2">
          <textarea
            rows={2}
            value={proofText}
            onChange={(e) => setProofText(e.target.value)}
            placeholder='e.g. "Certificate uploaded to Drive — link: ..."'
            className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label={`Proof for "${criterion.title}"`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowProof(false)}
              className="rounded-md px-2.5 py-1 text-xs text-text-muted hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveProof}
              disabled={isSavingProof}
              className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSavingProof ? "Saving…" : "Save Proof"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function CriteriaChecklist({
  criteria,
  approvalStatus,
  progressPercent,
  interactive = false,
  readOnly = false,
}: CriteriaChecklistProps) {
  const [expanded, setExpanded] = useState(false);
  const canToggle =
    interactive && !readOnly && isPostApproved(approvalStatus);
  const completedCount = criteria.filter((c) => c.is_completed).length;

  if (criteria.length === 0) return null;

  // Show first 3 by default, expand to show all
  const visible = expanded ? criteria : criteria.slice(0, 3);
  const hasMore = criteria.length > 3;

  return (
    <div className="space-y-2">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">
          Key Results ({completedCount}/{criteria.length})
        </p>
      </div>

      <ProgressBar percent={progressPercent} />

      {/* Criteria list */}
      <ul className="space-y-2">
        {visible.map((c) => (
          <CriterionRow
            key={c.id}
            criterion={c}
            canToggle={canToggle}
          />
        ))}
      </ul>

      {/* Expand/collapse */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-brand transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              Show {criteria.length - 3} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
