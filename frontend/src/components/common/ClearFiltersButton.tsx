import { X } from "lucide-react";

interface ClearFiltersButtonProps {
  /**
   * Whether any filter is currently active. The button is always rendered but
   * stays disabled (greyed out) when false — there's nothing to clear, yet the
   * affordance remains discoverable in the toolbar. Callers pass their existing
   * `hasActiveFilters`-style expression.
   */
  readonly active: boolean;
  /** Resets every filter (and search) the view owns back to its default. */
  readonly onClear: () => void;
  /** Extra classes for layout tweaks (e.g. `ml-auto`) at the call site. */
  readonly className?: string;
}

/**
 * Shared "Clear filters" control for every filterable list view. Sits in the
 * filter toolbar next to the filter controls and resets them all at once.
 * Single source of truth so the affordance looks and behaves identically
 * across Users, Projects, Goals, Reviews, etc.
 */
export function ClearFiltersButton({
  active,
  onClear,
  className = "",
}: ClearFiltersButtonProps) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={!active}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border border-border " +
        "bg-surface px-3 py-1.5 text-[13px] font-medium text-text-muted " +
        "outline-none transition-colors hover:border-brand hover:text-text-main " +
        "focus:border-brand disabled:cursor-not-allowed disabled:opacity-50 " +
        "disabled:hover:border-border disabled:hover:text-text-muted " +
        className
      }
      aria-label="Clear all filters"
    >
      <X className="h-4 w-4" aria-hidden="true" />
      Clear filters
    </button>
  );
}
