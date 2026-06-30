/**
 * PeriodSettingsSection — one access-control section bound to a single period.
 *
 * System Settings has two of these: the Annual Review section (FY dropdown,
 * reviewed once a year) and the Goals & Project section (H1/H2 dropdown,
 * reviewed twice a year). Each owns its own period dropdown, loaded toggles,
 * dirty-diff, and save/confirm flow; it writes only the flags it controls
 * (the backend update is per-flag optional), so the two sections never clobber
 * each other.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Save, AlertTriangle } from "lucide-react";
import type {
  YearOption,
  YearPreflightResponse,
  YearSettingsUpdatePayload,
} from "../../services/admin.service";
import {
  useYearSettings,
  useYearPreflight,
  useUpdateYearSettings,
} from "../../queries/adminSettings";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { getErrorMessage } from "../../utils/errors";

type ToggleKey = keyof YearSettingsUpdatePayload;

export interface PeriodToggle {
  readonly key: ToggleKey;
  readonly label: string;
  readonly description: string;
}

/** Short labels for the diff confirmation modal. */
const TOGGLE_LABELS: Record<ToggleKey, string> = {
  annual_reviews_enabled: "Annual Reviews",
  annual_review_final_rating_visible: "Management Rating Visibility",
  annual_review_mentor_rating_visible: "Mentor Rating Visibility",
  annual_goals_edit_enabled: "Annual Goal Edit Access",
  project_ratings_visible: "Project Rating Visibility",
  annual_goals_final_rating_visible: "Annual Goal Review Visibility",
  management_review_enabled: "Management Review",
};

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (val: boolean) => void;
  readonly disabled?: boolean;
}) {
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

interface DiffRow {
  readonly key: ToggleKey;
  readonly from: boolean;
  readonly to: boolean;
}

function SaveConfirmationModal({
  periodLabel,
  diff,
  preflight,
  preflightLoading,
  isSaving,
  onConfirm,
  onCancel,
}: {
  readonly periodLabel: string;
  readonly diff: ReadonlyArray<DiffRow>;
  readonly preflight: YearPreflightResponse | null;
  readonly preflightLoading: boolean;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onCancel();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel, isSaving]);

  const flips = diff
    .filter((d) => d.to === false && preflight)
    .map((d) => ({ key: d.key, warning: preflight?.[d.key]?.warning ?? null }));

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
              Apply changes to {periodLabel}?
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              These access settings will be saved for {periodLabel}. Other
              periods remain untouched.
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
                    <span className={d.from ? "text-green-700" : "text-text-muted"}>
                      {d.from ? "ON" : "OFF"}
                    </span>
                    <span className="mx-2 text-text-muted">→</span>
                    <span className={d.to ? "text-green-700" : "text-text-muted"}>
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

export function PeriodSettingsSection({
  title,
  dropdownLabel,
  helpText,
  options,
  optionsLoading,
  toggles,
}: {
  readonly title: string;
  readonly dropdownLabel: string;
  readonly helpText: string;
  readonly options: readonly YearOption[];
  readonly optionsLoading: boolean;
  readonly toggles: readonly PeriodToggle[];
}) {
  const toast = useToast();
  const snackbar = useSnackbar();
  const { refreshSettings } = useSystemSettings();

  const defaultPeriod = useMemo(
    () =>
      options.find((o) => o.is_current)?.period_label ??
      options[0]?.period_label ??
      null,
    [options],
  );
  const [selected, setSelected] = useState<string | null>(null);
  if (selected === null && defaultPeriod !== null) setSelected(defaultPeriod);

  const settingsQuery = useYearSettings(selected ?? "");
  const saved = settingsQuery.data ?? null;

  const blank = useMemo(
    () => Object.fromEntries(toggles.map((t) => [t.key, false])) as Record<ToggleKey, boolean>,
    [toggles],
  );
  const [form, setForm] = useState<Record<ToggleKey, boolean>>(blank);
  const [formKey, setFormKey] = useState<string | null>(null);
  if (saved && formKey !== saved.period_label) {
    setForm(
      Object.fromEntries(toggles.map((t) => [t.key, saved[t.key]])) as Record<
        ToggleKey,
        boolean
      >,
    );
    setFormKey(saved.period_label);
  }

  const diff = useMemo<DiffRow[]>(() => {
    if (!saved) return [];
    return toggles
      .filter((t) => form[t.key] !== saved[t.key])
      .map((t) => ({ key: t.key, from: saved[t.key], to: form[t.key] }));
  }, [form, saved, toggles]);

  const [showConfirm, setShowConfirm] = useState(false);
  const preflightQuery = useYearPreflight(selected ?? "", showConfirm && !!selected);
  const updateMutation = useUpdateYearSettings();

  const handleConfirmSave = () => {
    if (!selected) return;
    const payload: YearSettingsUpdatePayload = {};
    for (const t of toggles) payload[t.key] = form[t.key];
    updateMutation.mutate(
      { fy: selected, payload },
      {
        onSuccess: (fresh) => {
          void refreshSettings();
          setShowConfirm(false);
          toast.success(`Configuration saved for ${fresh.period_label}.`);
        },
        onError: (err) => snackbar.error(getErrorMessage(err)),
      },
    );
  };

  const loading = settingsQuery.isPending || !saved;

  return (
    <div>
      <h3 className="font-display text-lg font-semibold text-text-main mb-4">
        {title}
      </h3>
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm font-medium text-text-main mb-1">
              {dropdownLabel}
            </label>
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value || null)}
              disabled={optionsLoading}
              className="w-full sm:w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand"
            >
              {optionsLoading && <option value="">Loading…</option>}
              {!optionsLoading && options.length === 0 && (
                <option value="">None available</option>
              )}
              {options.map((o) => (
                <option key={o.period_label} value={o.period_label}>
                  {o.period_label}
                  {o.is_current ? " (Current)" : ""}
                  {!o.has_override ? " — unconfigured" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-text-muted">{helpText}</p>
          </div>
          <button
            type="button"
            onClick={() => diff.length > 0 && setShowConfirm(true)}
            disabled={!selected || diff.length === 0 || updateMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {updateMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="px-5 py-2">
          <div className="divide-y divide-border/60">
            {toggles.map((t) => (
              <ToggleRow
                key={t.key}
                label={t.label}
                description={t.description}
                checked={form[t.key]}
                disabled={loading}
                onChange={(next) => setForm((prev) => ({ ...prev, [t.key]: next }))}
              />
            ))}
          </div>
        </div>
      </div>

      {showConfirm && selected && (
        <SaveConfirmationModal
          periodLabel={selected}
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
