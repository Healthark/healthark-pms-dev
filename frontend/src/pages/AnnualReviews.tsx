import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { SelfReviewTab } from "../components/reviews/SelfReviewTab";
import { TeamReviewTab } from "../components/reviews/TeamReviewTab";
import { SelfReviewFormModal } from "../components/reviews/SelfReviewFormModal";
import {
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
} from "../services/annual-review.service";
import {
  useMyAnnualReviewHistory,
  useSubmitSelfReview,
  useCreateSelfDraft,
  useSaveSelfDraft,
} from "../queries/annualReviews";
import { getErrorMessage } from "../utils/errors";
import { formatFyLabel, extractFyToken } from "../utils/fy";
import { ExportExcelButton } from "../components/exports/ExportExcelButton";
import { exportService } from "../services/export.service";

type ActiveTab = "my" | "team";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const confirm = useConfirm();

  const isMentor = user?.has_mentees ?? false;
  const activeCycle = settings?.active_cycle_name ?? "";
  // Admin-controlled gate for the Self-Review button. Mirrors the
  // annual_goals_edit_enabled pattern used on the Annual Goals page —
  // when off the button is replaced with a "submissions closed" indicator
  // and the backend rejects writes via _assert_module_enabled().
  const moduleEnabled = settings?.annual_reviews_enabled ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;
  const exportFy = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : undefined;

  // Active tab lives in the URL (`?tab=my|team`) so a notification can deep-link
  // straight to the Team tab (e.g. "X submitted their self-review"). Derived
  // from the URL — works even when already on the page. Team is mentor-only, so
  // `tab=team` falls back to My Review for non-mentors.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: ActiveTab =
    searchParams.get("tab") === "team" && isMentor ? "team" : "my";
  const setActiveTab = (tab: ActiveTab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };

  // ['annual-reviews', 'mine', 'history'] — shared TanStack cache
  const { data: reviews = [], isLoading } = useMyAnnualReviewHistory();
  const submitSelfReviewMutation = useSubmitSelfReview();
  const createSelfDraftMutation = useCreateSelfDraft();
  const saveSelfDraftMutation = useSaveSelfDraft();
  const isSaving = submitSelfReviewMutation.isPending;
  const isDraftSaving =
    createSelfDraftMutation.isPending || saveSelfDraftMutation.isPending;

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");

  // Lookup the active-cycle row (if any). May be a draft (still editable),
  // or one of the post-draft statuses (locked).
  const currentReview =
    reviews.find((r) => r.cycle_name === activeCycle) ?? null;
  const isCurrentDraft = currentReview?.status === "draft";
  // Can open the form when there's no row yet, OR when the existing row
  // is still a draft. Past-draft statuses lock the modal closed.
  const canStart =
    !!activeCycle &&
    moduleEnabled &&
    (!currentReview || isCurrentDraft) &&
    !isLoading;

  const handleSubmit = async (payload: SelfReviewPayload) => {
    const ok = await confirm({
      title: "Submit annual self-review?",
      message: `Submit your self-review for ${
        fyLabel ?? "this cycle"
      }. Once submitted you can't edit your responses, and your mentor will receive it for evaluation.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    setFormError("");
    try {
      await submitSelfReviewMutation.mutateAsync(payload);
      setShowForm(false);
      toast.success("Self-review submitted.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  const handleSaveDraft = async (payload: SelfReviewDraftPayload) => {
    setFormError("");
    try {
      // First save creates the draft row; subsequent saves PATCH it.
      if (currentReview) {
        await saveSelfDraftMutation.mutateAsync({
          reviewId: currentReview.id,
          payload,
        });
      } else {
        await createSelfDraftMutation.mutateAsync(payload);
      }
      toast.success("Draft saved.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Annual Reviews
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Complete your annual review, receive mentor feedback, and view your
            final rating.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportExcelButton
            label="Export Reviews"
            onDownload={() =>
              exportService.downloadAnnualReviews({ fy: exportFy }, "inline")
            }
          />
          {activeTab === "my" &&
            (canStart ? (
              <button
                type="button"
                onClick={() => {
                  setFormError("");
                  setShowForm(true);
                }}
                className="shrink-0 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {isCurrentDraft ? "Continue Draft" : "Self-Review"}
              </button>
            ) : !moduleEnabled ? (
              <div className="shrink-0 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Annual review submissions are currently closed.
              </div>
            ) : null)}
        </div>
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Review
          </button>
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Review
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && (
            <SelfReviewTab reviews={reviews} isLoading={isLoading} />
          )}
          {activeTab === "team" && isMentor && <TeamReviewTab />}
        </div>
      </div>

      {/* Form modal lives at page scope so the header button can open it */}
      {showForm && activeCycle && (
        <SelfReviewFormModal
          cycleName={activeCycle}
          draft={isCurrentDraft ? currentReview : null}
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onClose={() => {
            setShowForm(false);
            setFormError("");
          }}
          isSaving={isSaving}
          isDraftSaving={isDraftSaving}
          error={formError}
        />
      )}
    </div>
  );
}
