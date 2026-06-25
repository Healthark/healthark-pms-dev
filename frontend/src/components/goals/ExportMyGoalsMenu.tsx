/**
 * ExportMyGoalsMenu — small "Export Goals" split button for the My Goals tab.
 *
 * Available to EVERY user (not the HR/management export gate) and strictly
 * scoped server-side to the caller's own goals — see GET /exports/my-goals.
 * Opens a 2-item dropdown so the user picks the range: the current fiscal
 * year only, or all years.
 */

import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown, Loader2, CalendarRange, Layers } from "lucide-react";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useSnackbar } from "../../hooks/useSnackbar";
import { exportService } from "../../services/export.service";
import { extractFyToken, formatFyLabel } from "../../utils/fy";
import { getErrorMessage } from "../../utils/errors";

export function ExportMyGoalsMenu() {
  const { settings } = useSystemSettings();
  const snackbar = useSnackbar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeCycle = settings?.active_cycle_name ?? null;
  // "FY26-27" for the request, "FY 2026-27" for the menu label.
  const currentFyToken = activeCycle ? extractFyToken(activeCycle) : null;
  const currentFyLabel = activeCycle ? formatFyLabel(activeCycle) : null;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (fy?: string) => {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    try {
      await exportService.downloadMyGoals(fy);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text-main transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{busy ? "Preparing…" : "Export Goals"}</span>
        {!busy && (
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => run(currentFyToken ?? undefined)}
            className="flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-brand/5"
          >
            <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-text-main">Current year</span>
              <span className="text-[11px] text-text-muted">
                {currentFyLabel ? `Goals for ${currentFyLabel}` : "Goals for the active fiscal year"}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(undefined)}
            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-brand/5"
          >
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-text-main">All years</span>
              <span className="text-[11px] text-text-muted">Every goal you've created</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
