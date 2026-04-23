/**
 * ManagementReviewTab.tsx — Management Review grid for the AdminPanel.
 *
 * Only rendered when the current user is role === "Admin" AND
 * is_management === true. The backend also enforces both via
 * _require_management, so this gate is purely a UI affordance — the API
 * will 403 anyone else.
 *
 * Renders all annual reviews in the active cycle that have cleared the
 * mentor stage (pending_management + completed) as a single table, and
 * lets management set/override the management rating inline via a modal.
 */

import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Pencil, Search, X } from "lucide-react";
import {
  annualReviewService,
  type CalibrationRow,
} from "../../services/annual-review.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "../reviews/PerformanceRatingSelect";
import { AnnualReviewDetailModal } from "../reviews/AnnualReviewDetailModal";
import { getErrorMessage } from "../../utils/errors";

type RatingValue = number | "";

interface EditTarget {
  readonly row: CalibrationRow;
  readonly draft: RatingValue;
}

export function ManagementReviewTab() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [viewReviewId, setViewReviewId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setRows(await annualReviewService.getCalibrationGrid());
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.employee_name.toLowerCase().includes(q) ||
      (r.employee_email ?? "").toLowerCase().includes(q) ||
      (r.mentor_name ?? "").toLowerCase().includes(q) ||
      (r.department ?? "").toLowerCase().includes(q)
    );
  });

  const handleSave = async () => {
    if (!editTarget) return;
    if (editTarget.draft === "") {
      setSaveError("Please select a rating.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      await annualReviewService.setManagementRating(editTarget.row.review_id, {
        management_performance_rating: editTarget.draft,
      });
      setEditTarget(null);
      await load();
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading reviews…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-5">
        <p className="text-sm text-rose-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Management Review
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Set or override the final management rating for reviews that have
            cleared mentor evaluation.
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, email, mentor…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] outline-none focus:border-brand"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm text-text-muted">
            {rows.length === 0
              ? "No reviews have reached the management stage yet."
              : "No reviews match this search."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  User
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Email
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Mentor
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Department
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Self Review
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Mentor Review
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Management Rating
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((r) => (
                <tr
                  key={r.review_id}
                  className="hover:bg-slate-50/60 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-text-main">
                    {r.employee_name}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.employee_email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.mentor_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.department ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge value={r.self_performance_rating} />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.mentor_performance_rating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.management_performance_rating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setViewReviewId(r.review_id)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                        aria-label={`View review for ${r.employee_name}`}
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSaveError("");
                          setEditTarget({
                            row: r,
                            draft: r.management_performance_rating ?? "",
                          });
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                        aria-label={`Edit management rating for ${r.employee_name}`}
                      >
                        <Pencil className="h-3 w-3" />
                        {r.management_performance_rating == null
                          ? "Add"
                          : "Edit"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewReviewId != null && (
        <ReviewDetailLoader
          reviewId={viewReviewId}
          onClose={() => setViewReviewId(null)}
        />
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-text-main">
                  Management Rating
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {editTarget.row.employee_name} · {editTarget.row.department ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-md p-1 text-text-muted hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-text-muted">Self Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.self_performance_rating}
                  />
                </div>
                <div>
                  <p className="text-text-muted">Mentor Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.mentor_performance_rating}
                  />
                </div>
              </div>
              <PerformanceRatingSelect
                id="management-rating-input"
                label="Management Rating"
                value={editTarget.draft}
                onChange={(next) =>
                  setEditTarget({ ...editTarget, draft: next })
                }
                disabled={isSaving}
              />
              {saveError && (
                <p className="text-xs text-rose-600">{saveError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={isSaving}
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewDetailLoader({
  reviewId,
  onClose,
}: {
  readonly reviewId: number;
  readonly onClose: () => void;
}) {
  const [review, setReview] = useState<
    Awaited<ReturnType<typeof annualReviewService.getReview>> | null
  >(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    annualReviewService
      .getReview(reviewId)
      .then((r) => {
        if (alive) setReview(r);
      })
      .catch((err) => {
        if (alive) setError(getErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [reviewId]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
          <p className="text-sm text-rose-600">{error}</p>
          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!review) return null;

  return (
    <AnnualReviewDetailModal
      review={review}
      title="Annual Review"
      subtitle={`Year: ${review.cycle_name}`}
      onClose={onClose}
    />
  );
}
