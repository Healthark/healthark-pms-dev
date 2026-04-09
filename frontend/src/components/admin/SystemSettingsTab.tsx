import { Save } from "lucide-react";

interface SystemSettingsTabProps {
  readonly cycleInput: string;
  readonly onCycleInputChange: (val: string) => void;
  readonly onSave: () => void;
  readonly isSaving: boolean;
  readonly settingsSaved: boolean;
  readonly savedCycleName: string | null;
}

export function SystemSettingsTab({
  cycleInput,
  onCycleInputChange,
  onSave,
  isSaving,
  settingsSaved,
  savedCycleName,
}: SystemSettingsTabProps) {
  return (
    <div className="p-6 max-w-md">
      <h3 className="font-display text-sm font-semibold text-text-main">
        Active Performance Cycle
      </h3>
      <p className="mt-1 text-sm text-text-muted">
        All new reviews and goals will be tagged to this cycle. Changing it does
        not affect records already created.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <input
          id="active-cycle"
          type="text"
          value={cycleInput}
          onChange={(e) => onCycleInputChange(e.target.value)}
          placeholder="e.g. H1 FY26"
          className="w-48 rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Active performance cycle"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !cycleInput.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>

      {settingsSaved && (
        <p className="mt-2 text-sm text-green-600">
          Active cycle updated to <strong>{savedCycleName}</strong>.
        </p>
      )}
    </div>
  );
}
