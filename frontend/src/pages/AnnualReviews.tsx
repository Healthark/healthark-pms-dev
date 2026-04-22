import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { SelfReviewTab } from "../components/reviews/SelfReviewTab";
import { TeamReviewTab } from "../components/reviews/TeamReviewTab";
import { SelfReviewFormModal } from "../components/reviews/SelfReviewFormModal";
import {
  annualReviewService,
  type AnnualReview,
  type SelfReviewPayload,
} from "../services/annual-review.service";
import { getErrorMessage } from "../utils/errors";
import { formatFyLabel } from "../utils/fy";

type ActiveTab = "my" | "team";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();

  const isMentor = user?.has_mentees ?? false;
  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  const [reviews, setReviews] = useState<AnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await annualReviewService.getMyReviewHistory());
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasCurrent = reviews.some((r) => r.cycle_name === activeCycle);
  const canStart =
    !!activeCycle && submissionsOpen && !hasCurrent && !isLoading;

  const handleSubmit = async (payload: SelfReviewPayload) => {
    setIsSaving(true);
    setFormError("");
    try {
      const created = await annualReviewService.submitSelfReview(payload);
      setReviews((prev) => [created, ...prev]);
      setShowForm(false);
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
        {activeTab === "my" && canStart && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setShowForm(true);
            }}
            className="shrink-0 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Self-Review
          </button>
        )}
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
          onSubmit={handleSubmit}
          onClose={() => {
            setShowForm(false);
            setFormError("");
          }}
          isSaving={isSaving}
          error={formError}
        />
      )}
    </div>
  );
}
