import { Info } from "lucide-react";
import type { CycleType } from "../../services/system-settings.service";
import { useSettingsYears } from "../../queries/adminSettings";
import { CycleRolloutCard } from "./CycleRolloutCard";
import { PeriodSettingsSection, type PeriodToggle } from "./PeriodSettingsSection";

interface SystemSettingsTabProps {
  readonly activeCycleName: string;
  readonly cycleType: CycleType;
  readonly fiscalStartMonth: number;
}

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

// Annual review — reviewed once a year, keyed per FISCAL YEAR.
const FY_TOGGLES: readonly PeriodToggle[] = [
  {
    key: "annual_reviews_enabled",
    label: "Enable Annual Reviews",
    description:
      "When on, employees can submit self-reviews for this fiscal year. Disabling pauses new submissions; existing reviews stay readable.",
  },
  {
    key: "annual_review_mentor_rating_visible",
    label: "Show Mentor Ratings on Annual Reviews",
    description:
      "When on, employees can see their mentor's rating on annual reviews as soon as the mentor submits — for this fiscal year.",
  },
  {
    key: "annual_review_final_rating_visible",
    label: "Show Management Rating on Annual Reviews",
    description:
      "When on, employees can see the final management rating once it's published — for this fiscal year. Appears in the My Review table's Final Rating column.",
  },
  {
    key: "management_review_enabled",
    label: "Enable Management Review",
    description:
      "When on, management can publish or override final management ratings for this fiscal year. Open it once self-reviews and mentor evaluations are complete.",
  },
];

// Annual goals + project reviews — reviewed twice a year, keyed per HALF.
const HALF_TOGGLES: readonly PeriodToggle[] = [
  {
    key: "annual_goals_edit_enabled",
    label: "Edit Access for Annual Goals",
    description:
      "When off, no one in the org can create or edit annual goals for this half-cycle.",
  },
  {
    key: "annual_goals_final_rating_visible",
    label: "Show Mentor Reviews on Annual Goals",
    description:
      "When on, employees can see their mentor's submitted review on each annual goal for this half-cycle. Drafts are never shown.",
  },
  {
    key: "project_ratings_visible",
    label: "View Ratings for Project Reviews",
    description:
      "When on, employees can see their project performance ratings for this half-cycle.",
  },
];

export function SystemSettingsTab({
  activeCycleName,
  cycleType,
  fiscalStartMonth,
}: SystemSettingsTabProps) {
  const yearsQuery = useSettingsYears();
  const years = yearsQuery.data?.years ?? [];
  const halves = yearsQuery.data?.halves ?? [];
  const optionsLoading = yearsQuery.isPending;

  return (
    <div className="p-4 space-y-4 sm:p-6 sm:space-y-6">
      <CycleRolloutCard />

      {/* Annual review — once a year, per fiscal year. */}
      <PeriodSettingsSection
        title="Annual Review Settings"
        dropdownLabel="Fiscal Year"
        helpText="Annual reviews run once a year. These toggles apply to the whole fiscal year; past years stay editable after the system advances."
        options={years}
        optionsLoading={optionsLoading}
        toggles={FY_TOGGLES}
      />

      {/* Annual goals + project reviews — twice a year, per half. */}
      <PeriodSettingsSection
        title="Goals & Project Review Settings"
        dropdownLabel="Half-Cycle (H1 / H2)"
        helpText="Annual goals and project reviews run twice a year. Open or close each half (H1 / H2) independently."
        options={halves}
        optionsLoading={optionsLoading}
        toggles={HALF_TOGGLES}
      />

      {/* ── Performance Cycle Configuration (read-only, prop-driven) ── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Performance Cycle Configuration
        </h3>
        <div className="space-y-6 bg-surface p-5 rounded-xl border border-border shadow-sm">
          {/* Current Active Cycle (Read-Only) */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Current Active Cycle
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeCycleName || "Not set"}
                disabled
                className="w-full sm:w-64 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted cursor-not-allowed"
              />
              <span className="flex items-center gap-1.5 text-xs text-text-muted bg-surface-hover px-2 py-1 rounded-md border border-border">
                <Info className="w-3.5 h-3.5" />
                Set via roll-out
              </span>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Advanced manually — use the Cycle card at the top of this tab to roll
              out the next cycle.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cadence (Read-Only) */}
            <div>
              <label htmlFor="cycle-type" className="block text-sm font-medium text-text-main mb-1">
                Cycle Cadence
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cycle-type"
                  type="text"
                  value={cycleType === "half_yearly" ? "Half-Yearly" : cycleType === "annual" ? "Annual" : "Quarterly"}
                  disabled
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted cursor-not-allowed"
                />
                <span className="flex items-center gap-1.5 text-xs text-text-muted bg-surface-hover px-2 py-1 rounded-md border border-border shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
            </div>

            {/* Fiscal Start Month (Read-Only) */}
            <div>
              <label htmlFor="fiscal-start" className="block text-sm font-medium text-text-main mb-1">
                Fiscal Start Month
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="fiscal-start"
                  type="text"
                  value={MONTHS.find((m) => m.value === fiscalStartMonth)?.label ?? "—"}
                  disabled
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-muted cursor-not-allowed"
                />
                <span className="flex items-center gap-1.5 text-xs text-text-muted bg-surface-hover px-2 py-1 rounded-md border border-border shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
