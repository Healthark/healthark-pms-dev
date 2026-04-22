import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { SelfAppraisalTab } from "../components/reviews/SelfAppraisalTab";
import { MenteeReviewTab } from "../components/reviews/MenteeReviewTab";
import { TeamReviewTab } from "../components/reviews/TeamReviewTab";

type ActiveTab = "my" | "mentee" | "team";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();

  const isMentor = user?.has_mentees ?? false;

  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
            Self-appraise, receive mentor feedback, and view your final rating.
          </p>
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
            <>
              <button
                type="button"
                className={tabCls("mentee")}
                onClick={() => setActiveTab("mentee")}
              >
                Mentee Review
              </button>
              <button
                type="button"
                className={tabCls("team")}
                onClick={() => setActiveTab("team")}
              >
                Team Review
              </button>
            </>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && <SelfAppraisalTab />}
          {activeTab === "mentee" && isMentor && <MenteeReviewTab />}
          {activeTab === "team" && isMentor && <TeamReviewTab />}
        </div>
      </div>
    </div>
  );
}
