/**
 * CalibrationTab.tsx — Stage 3: Management Calibration & Finalization.
 *
 * Shows a datatable of all reviews in pending_management or completed status.
 * HR Admin can see Self Score, Mentor Score side-by-side, enter a Final Score,
 * and click "Publish" to lock the review and make it visible to the employee.
 *
 * Placement: src/components/reviews/CalibrationTab.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Shield, Loader2, CheckCircle2 } from "lucide-react";
import {
  annualReviewService,
  type CalibrationRow,
  type ManagementFinalizePayload,
} from "../../services/annual-review.service";
import { getErrorMessage } from "../../utils/errors";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { StarRating } from "./StarRating";

// ── Finalize Modal ──────────────────────────────────────────────────

interface FinalizeModalProps {
  readonly row: CalibrationRow;
  readonly onFinalize: (
    reviewId: number,
    payload: ManagementFinalizePayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function FinalizeModal({
  row,
  onFinalize,
  onClose,
  isSaving,
  error,
}: FinalizeModalProps) {
  const [finalStars, setFinalStars] = useState(row.mentor_stars ?? 0);
  const [managementStars, setManagementStars] = useState(0);
  const [comments, setComments] = useState("");
  const [useOverride, setUseOverride] = useState(false);

  const handleSubmit = async () => {
    await onFinalize(row.review_id, {
      final_stars: finalStars,
      management_stars: useOverride ? managementStars : undefined,
      management_comments: comments.trim() || undefined,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finalize-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h2
            id="finalize-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            Finalize Review
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Set the official rating for <strong>{row.employee_name}</strong> and
            publish.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Score summary */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Self Score
              </p>
              {row.self_stars ? (
                <StarRating value={row.self_stars} readonly />
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Mentor Score
              </p>
              {row.mentor_stars ? (
                <StarRating value={row.mentor_stars} readonly />
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </div>
          </div>

          {/* Override toggle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
                className="rounded border-border text-brand focus:ring-brand"
              />
              <span className="text-text-main">
                Override with management score
              </span>
            </label>
            {useOverride && (
              <div className="ml-6">
                <p className="text-xs text-text-muted mb-1">Management Score</p>
                <StarRating
                  value={managementStars}
                  onChange={setManagementStars}
                />
              </div>
            )}
          </div>

          {/* Final rating */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-text-main">
              Final Rating *
            </p>
            <p className="text-xs text-text-muted">
              This is the official rating the employee will see.
            </p>
            <StarRating value={finalStars} onChange={setFinalStars} />
          </div>

          {/* Comments */}
          <div>
            <label
              htmlFor="mgmt-comments"
              className="block text-xs font-medium text-text-muted mb-1"
            >
              Calibration Comments (optional)
            </label>
            <textarea
              id="mgmt-comments"
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Any notes for the employee about their final rating..."
              className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || finalStars < 1}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? "Publishing…" : "Publish Final Review"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Star Display (Inline) ───────────────────────────────────────────

function InlineStars({ value }: { readonly value: number | null }) {
  if (!value) return <span className="text-text-muted">—</span>;
  return <StarRating value={value} readonly />;
}

// ── Tab Component ───────────────────────────────────────────────────

export function CalibrationTab() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [finalizeTarget, setFinalizeTarget] = useState<CalibrationRow | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadGrid = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await annualReviewService.getCalibrationGrid());
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGrid();
  }, [loadGrid]);

  const handleFinalize = async (
    reviewId: number,
    payload: ManagementFinalizePayload,
  ) => {
    setIsSaving(true);
    setModalError("");
    try {
      await annualReviewService.finalizeReview(reviewId, payload);
      // Update the row in place
      setRows((prev) =>
        prev.map((r) =>
          r.review_id === reviewId
            ? {
                ...r,
                final_stars: payload.final_stars,
                management_stars: payload.management_stars ?? null,
                status: "completed" as const,
                final_rating_enabled: true,
              }
            : r,
        ),
      );
      setFinalizeTarget(null);
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading calibration data…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <Shield className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No reviews ready for calibration
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Reviews will appear here after mentors complete their evaluations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        {rows.length} review(s) across the organization.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-slate-50 text-left">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Employee
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Department
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Self
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Mentor
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Final
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={row.review_id}
                className="transition-colors hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-text-main">
                    {row.employee_name}
                  </div>
                  {row.designation && (
                    <div className="text-xs text-text-muted">
                      {row.designation}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {row.department ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <InlineStars value={row.self_stars} />
                </td>
                <td className="px-4 py-3">
                  <InlineStars value={row.mentor_stars} />
                </td>
                <td className="px-4 py-3">
                  <InlineStars value={row.final_stars} />
                </td>
                <td className="px-4 py-3">
                  <ReviewStatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3">
                  {row.status === "pending_management" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setModalError("");
                        setFinalizeTarget(row);
                      }}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                    >
                      Publish
                    </button>
                  ) : row.final_rating_enabled ? (
                    <span className="text-xs font-medium text-green-600">
                      ✓ Published
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Finalize modal */}
      {finalizeTarget && (
        <FinalizeModal
          row={finalizeTarget}
          onFinalize={handleFinalize}
          onClose={() => {
            setFinalizeTarget(null);
            setModalError("");
          }}
          isSaving={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
