import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";
import {
  goalService,
  type TeamGoal,
  type ApprovalStatus,
} from "../../services/goal.service";
import { getErrorMessage } from "../../utils/errors";
import { TeamGoalCard } from "./TeamGoalCard";

// ---------------------------------------------------------------------------
// Feedback modal (Portal) — shown when manager clicks "Request Changes"
// ---------------------------------------------------------------------------

interface FeedbackModalProps {
  readonly goal: TeamGoal;
  readonly onSend: (feedback: string) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function FeedbackModal({
  goal,
  onSend,
  onClose,
  isSaving,
  error,
}: FeedbackModalProps) {
  const [feedback, setFeedback] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="feedback-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            Request Changes
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Explain what needs to be revised for{" "}
            <strong>{goal.owner_name}</strong>.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}
          <label
            htmlFor="feedback-text"
            className="block text-xs font-medium text-text-muted mb-1"
          >
            Feedback *
          </label>
          <textarea
            id="feedback-text"
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Please make the target more specific and measurable."
            className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

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
            onClick={() => onSend(feedback)}
            disabled={isSaving || !feedback.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Sending…" : "Send Feedback"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type Filter = "all" | "submitted" | "approved" | "changes_requested";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Pending Review" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes Requested" },
];

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

export function TeamGoalsTab() {
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setFilter] = useState<Filter>("all");
  const [feedbackTarget, setFeedbackTarget] = useState<TeamGoal | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await goalService.getTeamGoals("yearly");
      setGoals(data);
    } catch {
      // Stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const handleApprove = async (goal: TeamGoal) => {
    setIsActing(true);
    try {
      const updated = await goalService.updateApproval(goal.id, {
        approval_status: "approved",
      });
      setGoals((prev) =>
        prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)),
      );
    } catch {
      // Card stays in submitted state — user can retry
    } finally {
      setIsActing(false);
    }
  };

  const handleSendFeedback = async (feedback: string) => {
    if (!feedbackTarget) return;
    setIsActing(true);
    setModalError("");
    try {
      const updated = await goalService.updateApproval(feedbackTarget.id, {
        approval_status: "changes_requested",
        feedback,
      });
      setGoals((prev) =>
        prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)),
      );
      setFeedbackTarget(null);
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const filtered =
    activeFilter === "all"
      ? goals
      : goals.filter(
          (g) => g.approval_status === (activeFilter as ApprovalStatus),
        );

  const filterBtn = (f: Filter) =>
    `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
      activeFilter === f
        ? "bg-brand text-white"
        : "bg-slate-100 text-text-muted hover:bg-slate-200"
    }`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading team goals…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={filterBtn(f.value)}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1 opacity-70">
                ({goals.filter((g) => g.approval_status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Goal cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
          <Users
            className="h-10 w-10 text-text-muted mb-3"
            aria-hidden="true"
          />
          <p className="font-display text-base font-medium text-text-main">
            No yearly goals here
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Your team hasn't submitted any yearly goal requests for this filter yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((goal) => (
            <TeamGoalCard
              key={goal.id}
              goal={goal}
              onApprove={handleApprove}
              onRequestChanges={(g) => {
                setModalError("");
                setFeedbackTarget(g);
              }}
              isActing={isActing}
            />
          ))}
        </div>
      )}

      {/* Feedback modal */}
      {feedbackTarget && (
        <FeedbackModal
          goal={feedbackTarget}
          onSend={handleSendFeedback}
          onClose={() => setFeedbackTarget(null)}
          isSaving={isActing}
          error={modalError}
        />
      )}
    </div>
  );
}
