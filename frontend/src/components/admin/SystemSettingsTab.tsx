import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Save, Info, AlertTriangle } from "lucide-react";
import type { CycleType } from "../../services/system-settings.service";
import type {
  YearPreflightResponse,
  YearSettingsUpdatePayload,
} from "../../services/admin.service";
import {
  useSettingsYears,
  useYearSettings,
  useYearPreflight,
  useUpdateYearSettings,
} from "../../queries/adminSettings";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { getErrorMessage } from "../../utils/errors";
import { CycleRolloutCard } from "./CycleRolloutCard";

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

interface ToggleRowProps {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (val: boolean) => void;
  readonly disabled?: boolean;
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-main">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "bg-brand" : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-surface shadow transition duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/** Labels shown in the diff confirmation modal. Short enough to fit a
 *  one-line "Label: ON → OFF" row. */
const TOGGLE_LABELS: Record<keyof YearSettingsUpdatePayload, string> = {
  annual_reviews_enabled: "Annual Reviews",
  annual_review_final_rating_visible: "Annual Review Rating Visibility",
  annual_goals_edit_enabled: "Annual Goal Edit Access",
  project_ratings_visible: "Project Rating Visibility",
  annual_goals_final_rating_visible: "Annual Goal Review Visibility",
  management_review_enabled: "Management Review",
};

interface SaveConfirmationModalProps {
  readonly fyLabel: string;
  readonly diff: ReadonlyArray<{
    key: keyof YearSettingsUpdatePayload;
    from: boolean;
    to: boolean;
  }>;
  readonly preflight: YearPreflightResponse | null;
  readonly preflightLoading: boolean;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Modal that pops up on Save Configuration. Lists each toggle that
 *  changed for the selected FY plus the in-flight impact from the
 *  preflight endpoint, so HR sees who they're affecting before
 *  committing. Built as a local component (structured body, not a
 *  single-string ConfirmDialog). */
function SaveConfirmationModal({
  fyLabel,
  diff,
  preflight,
  preflightLoading,
  isSaving,
  onConfirm,
  onCancel,
}: SaveConfirmationModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onCancel();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel, isSaving]);

  const flips: Array<{ key: keyof YearSettingsUpdatePayload; warning: string | null }> = [];
  for (const d of diff) {
    if (d.to === false && preflight) {
      flips.push({ key: d.key, warning: preflight[d.key]?.warning ?? null });
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <Save className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">
              Apply changes to {fyLabel}?
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              The following access settings will be saved for the {fyLabel}{" "}
              fiscal year. Other years remain untouched.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-surface-muted p-3">
          {diff.length === 0 ? (
            <p className="text-sm text-text-muted">No changes to save.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {diff.map((d) => (
                <li
                  key={d.key}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-text-main">{TOGGLE_LABELS[d.key]}</span>
                  <span className="font-mono text-xs">
                    <span
                      className={d.from ? "text-green-700" : "text-text-muted"}
                    >
                      {d.from ? "ON" : "OFF"}
                    </span>
                    <span className="mx-2 text-text-muted">→</span>
                    <span
                      className={d.to ? "text-green-700" : "text-text-muted"}
                    >
                      {d.to ? "ON" : "OFF"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {flips.length > 0 && (
          <div className="mt-3 space-y-2">
            {preflightLoading && (
              <p className="text-xs text-text-muted">
                Checking who would be affected…
              </p>
            )}
            {!preflightLoading &&
              flips.map((f) =>
                f.warning ? (
                  <div
                    key={f.key}
                    className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{f.warning}</span>
                  </div>
                ) : null,
              )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving || diff.length === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Apply Configuration"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SystemSettingsTab({
  activeCycleName,
  cycleType,
  fiscalStartMonth,
}: SystemSettingsTabProps) {
  const toast = useToast();
  const snackbar = useSnackbar();
  const { refreshSettings } = useSystemSettings();

  // ── Year dropdown options ────────────────────────────────────────
  const yearsQuery = useSettingsYears();
  const yearOptions = useMemo(
    () => yearsQuery.data?.years ?? [],
    [yearsQuery.data],
  );
  const defaultYear = useMemo(
    () =>
      yearOptions.find((y) => y.is_current)?.fy_label ??
      yearOptions[0]?.fy_label ??
      null,
    [yearOptions],
  );

  // Snap to the default once the dropdown options arrive; after that HR's
  // selection sticks. Render-phase setState guarded so it fires once.
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  if (selectedYear === null && defaultYear !== null) {
    setSelectedYear(defaultYear);
  }

  // ── Selected year's saved values ─────────────────────────────────
  const yearSettingsQuery = useYearSettings(selectedYear ?? "");
  const savedYear = yearSettingsQuery.data ?? null;

  // ── Local form state for the four toggles ────────────────────────
  // Re-snapshot whenever HR picks a different FY (or the saved row first
  // resolves). Render-phase setState gated by `formKey` so it fires once
  // per FY change.
  const [form, setForm] = useState<YearSettingsUpdatePayload>({
    annual_reviews_enabled: false,
    annual_review_final_rating_visible: false,
    annual_goals_edit_enabled: false,
    project_ratings_visible: false,
    annual_goals_final_rating_visible: false,
    management_review_enabled: false,
  });
  const [formKey, setFormKey] = useState<string | null>(null);
  if (savedYear && formKey !== savedYear.fy_label) {
    setForm({
      annual_reviews_enabled: savedYear.annual_reviews_enabled,
      annual_review_final_rating_visible:
        savedYear.annual_review_final_rating_visible,
      annual_goals_edit_enabled: savedYear.annual_goals_edit_enabled,
      project_ratings_visible: savedYear.project_ratings_visible,
      annual_goals_final_rating_visible:
        savedYear.annual_goals_final_rating_visible,
      management_review_enabled: savedYear.management_review_enabled,
    });
    setFormKey(savedYear.fy_label);
  }

  // Diff between local form state and last-saved values — drives the
  // confirmation modal's row list. Empty when HR hasn't touched anything.
  const diff = useMemo(() => {
    if (!savedYear) return [];
    const keys: Array<keyof YearSettingsUpdatePayload> = [
      "annual_reviews_enabled",
      "annual_review_final_rating_visible",
      "annual_goals_edit_enabled",
      "project_ratings_visible",
      "annual_goals_final_rating_visible",
      "management_review_enabled",
    ];
    return keys
      .filter((k) => form[k] !== savedYear[k])
      .map((k) => ({ key: k, from: savedYear[k], to: form[k] }));
  }, [form, savedYear]);

  // ── Save flow ────────────────────────────────────────────────────
  const [showConfirm, setShowConfirm] = useState(false);
  const preflightQuery = useYearPreflight(
    selectedYear ?? "",
    showConfirm && !!selectedYear,
  );
  const updateMutation = useUpdateYearSettings();

  const handleOpenConfirm = () => {
    if (!selectedYear || diff.length === 0) return;
    setShowConfirm(true);
  };

  const handleConfirmSave = () => {
    if (!selectedYear) return;
    updateMutation.mutate(
      { fy: selectedYear, payload: form },
      {
        onSuccess: (fresh) => {
          // Banners on AnnualReviews etc. read /settings/, so refresh that.
          void refreshSettings();
          setShowConfirm(false);
          toast.success(`Configuration saved for ${fresh.fy_label}.`);
        },
        onError: (err) => snackbar.error(getErrorMessage(err)),
      },
    );
  };

  const selectedOption = yearOptions.find((y) => y.fy_label === selectedYear);
  const yearLoading = yearSettingsQuery.isPending || !savedYear;

  return (
    <div className="p-4 space-y-4 sm:p-6 sm:space-y-6">
      <CycleRolloutCard />

      {/* ── Year-scoped configuration header ────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex-1 min-w-[240px]">
          <label
            htmlFor="settings-year"
            className="block text-sm font-medium text-text-main mb-1"
          >
            Configure Access for Fiscal Year
          </label>
          <select
            id="settings-year"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value || null)}
            disabled={yearsQuery.isPending}
            className="w-full sm:w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand"
          >
            {yearsQuery.isPending && <option value="">Loading…</option>}
            {!yearsQuery.isPending && yearOptions.length === 0 && (
              <option value="">No years available</option>
            )}
            {yearOptions.map((y) => (
              <option key={y.fy_label} value={y.fy_label}>
                {y.fy_label}
                {y.is_current ? " (Current)" : ""}
                {!y.has_override ? " — unconfigured" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-text-muted">
            Toggles below apply only to the selected fiscal year. Past years
            stay editable even after the system advances.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenConfirm}
          disabled={!selectedYear || diff.length === 0 || updateMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {updateMutation.isPending ? "Saving…" : "Save Configuration"}
        </button>
      </div>

      {/* ── Annual Review Settings ───────────────────────────────────── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Annual Review Settings
          {selectedOption && (
            <span className="ml-2 text-xs font-medium text-text-muted">
              · {selectedOption.fy_label}
            </span>
          )}
        </h3>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
          <div className="px-5 py-4">
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="Enable Annual Reviews"
                description="When on, employees can submit self-reviews for this fiscal year. Disabling pauses new submissions; existing reviews stay readable."
                checked={form.annual_reviews_enabled}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, annual_reviews_enabled: next }))
                }
              />
              <ToggleRow
                label="Show Ratings on Annual Reviews"
                description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to employees once published — for this fiscal year."
                checked={form.annual_review_final_rating_visible}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    annual_review_final_rating_visible: next,
                  }))
                }
              />
              <ToggleRow
                label="Enable Management Review"
                description="When on, management can publish or override final management ratings for this fiscal year. Independent of Annual Reviews — open this once self-reviews and mentor evaluations are complete."
                checked={form.management_review_enabled}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, management_review_enabled: next }))
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Goal & Review Access Controls ───────────────────────────── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Goal & Review Access Controls
          {selectedOption && (
            <span className="ml-2 text-xs font-medium text-text-muted">
              · {selectedOption.fy_label}
            </span>
          )}
        </h3>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">

          {/* Annual Goal Settings */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Annual Goal Settings
            </p>
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="Edit Access for Annual Goals"
                description="When off, no one in the org can create or edit annual goals for this fiscal year."
                checked={form.annual_goals_edit_enabled}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, annual_goals_edit_enabled: next }))
                }
              />
              <ToggleRow
                label="Show Mentor Reviews on Annual Goals"
                description="When on, employees can see their mentor's submitted review on each annual goal for this fiscal year. Drafts are never shown."
                checked={form.annual_goals_final_rating_visible}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    annual_goals_final_rating_visible: next,
                  }))
                }
              />
            </div>
          </div>

          {/* Project Goal Settings */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Project Goal Settings
            </p>
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="View Ratings for Project Goals"
                description="When on, employees can see their project performance ratings for this fiscal year."
                checked={form.project_ratings_visible}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, project_ratings_visible: next }))
                }
              />
            </div>
          </div>

        </div>
      </div>

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

      {showConfirm && selectedYear && (
        <SaveConfirmationModal
          fyLabel={selectedYear}
          diff={diff}
          preflight={preflightQuery.data ?? null}
          preflightLoading={preflightQuery.isPending}
          isSaving={updateMutation.isPending}
          onConfirm={handleConfirmSave}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
