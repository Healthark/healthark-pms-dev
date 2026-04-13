/**
 * AnnualReviews.tsx — Main Page Shell for the 3-Stage Appraisal.
 *
 * Tabs:
 *   "My Review"        → All users   — self-appraisal form or read-only view
 *   "Mentee Reviews"   → Managers    — mentor evaluation cards
 *   "Calibration"      → Admin only  — HR finalization grid
 *
 * Placement: src/pages/AnnualReviews.tsx
 */

import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { SelfAppraisalTab } from "../components/reviews/SelfAppraisalTab";
import { MenteeReviewsTab } from "../components/reviews/MenteeReviewsTab";
import { CalibrationTab } from "../components/reviews/CalibrationTab";

const MANAGER_ROLES = ["Admin", "Manager", "Principal"] as const;

type ActiveTab = "my" | "mentees" | "calibration";

export function AnnualReviews() {
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.includes(
    user?.role as (typeof MANAGER_ROLES)[number],
  );
  const isAdmin = user?.role === "Admin";

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
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Annual Reviews
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Self-appraise, receive mentor feedback, and view your final rating.
        </p>
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Review
          </button>
          {isManager && (
            <button
              type="button"
              className={tabCls("mentees")}
              onClick={() => setActiveTab("mentees")}
            >
              Mentee Reviews
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={tabCls("calibration")}
              onClick={() => setActiveTab("calibration")}
            >
              Calibration
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && <SelfAppraisalTab />}
          {activeTab === "mentees" && isManager && <MenteeReviewsTab />}
          {activeTab === "calibration" && isAdmin && <CalibrationTab />}
        </div>
      </div>
    </div>
  );
}
