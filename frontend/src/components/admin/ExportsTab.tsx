import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search, ShieldAlert, UserRound } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useSnackbar } from "../../hooks/useSnackbar";
import { canExport } from "../../utils/exportEligibility";
import {
  extractFyToken,
  formatFyYearSpan,
  fyTokenToStartYear,
} from "../../utils/fy";
import { getErrorMessage } from "../../utils/errors";
import {
  exportService,
  type EmployeeSlim,
} from "../../services/export.service";

const ALL_CYCLES = "__all__";

const CARD_CLS =
  "rounded-xl border border-border bg-white shadow-sm";
const CARD_HEADER_CLS =
  "border-b border-border px-5 py-3 flex items-center justify-between";
const CARD_TITLE_CLS =
  "font-display text-base font-semibold text-text-main";
const CARD_BODY_CLS = "px-5 py-4 space-y-3";
const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

function buildFyOptions(activeCycleName: string | null | undefined): string[] {
  // Always include "All cycles" + the active FY + 4 prior years for context.
  const tokens: string[] = [];
  if (activeCycleName) {
    const token = extractFyToken(activeCycleName);
    const year = fyTokenToStartYear(token);
    if (year !== null) {
      for (let i = 0; i < 5; i++) {
        const y = year - i;
        const t = `FY${(y % 100).toString().padStart(2, "0")}-${((y + 1) % 100)
          .toString()
          .padStart(2, "0")}`;
        if (!tokens.includes(t)) tokens.push(t);
      }
    } else if (!tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

interface DownloadButtonProps {
  readonly label: string;
  readonly onClick: () => Promise<void>;
  readonly disabled?: boolean;
}

function DownloadButton({ label, onClick, disabled }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const snackbar = useSnackbar();
  const handle = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onClick();
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy || disabled}
      className={
        "inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 " +
        "text-[13px] font-medium text-text-main transition-colors hover:bg-surface " +
        "disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{busy ? "Preparing…" : label}</span>
    </button>
  );
}

export function ExportsTab() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const snackbar = useSnackbar();

  // FY selection — default to the active cycle's FY token. "All cycles" sends fy=undefined.
  const defaultFy = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : null;
  const [fySelection, setFySelection] = useState<string>(
    defaultFy ?? ALL_CYCLES,
  );
  // Re-seed when settings load asynchronously
  useEffect(() => {
    if (defaultFy && fySelection === ALL_CYCLES) {
      setFySelection(defaultFy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFy]);

  const fyForApi = fySelection === ALL_CYCLES ? undefined : fySelection;
  const fyOptions = useMemo(
    () => buildFyOptions(settings?.active_cycle_name),
    [settings?.active_cycle_name],
  );

  // Per-employee picker
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employees, setEmployees] = useState<EmployeeSlim[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setEmployeeLoading(true);
      try {
        const rows = await exportService.listEmployees(employeeQuery || undefined);
        if (!cancelled) setEmployees(rows);
      } catch (err) {
        if (!cancelled) snackbar.error(getErrorMessage(err));
      } finally {
        if (!cancelled) setEmployeeLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeQuery]);

  if (!canExport(user)) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <ShieldAlert className="h-10 w-10 text-text-muted" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-text-main">
          Not authorised
        </h2>
        <p className="max-w-md text-sm text-text-muted">
          The Export workflows are available only to HR and Management users.
        </p>
      </div>
    );
  }

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) ?? null;

  return (
    <div className="space-y-5 p-5">
      {/* Filters card */}
      <section className={CARD_CLS}>
        <div className={CARD_HEADER_CLS}>
          <h2 className={CARD_TITLE_CLS}>Filters</h2>
        </div>
        <div className={CARD_BODY_CLS}>
          <div className="flex items-center gap-3 flex-wrap">
            <label htmlFor="export-fy-filter" className={FILTER_LABEL_CLS}>
              Fiscal Year
            </label>
            <select
              id="export-fy-filter"
              value={fySelection}
              onChange={(e) => setFySelection(e.target.value)}
              className={`${FILTER_SELECT_CLS} min-w-[180px]`}
            >
              <option value={ALL_CYCLES}>All cycles</option>
              {fyOptions.map((token) => {
                const year = fyTokenToStartYear(token);
                const label =
                  year !== null ? formatFyYearSpan(year) : token;
                return (
                  <option key={token} value={token}>
                    {label}
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-text-muted">
              The FY filter applies to Goals, Annual Reviews, and Project
              Reviews. Users and Projects ignore it.
            </p>
          </div>
        </div>
      </section>

      {/* Single-entity exports */}
      <section className={CARD_CLS}>
        <div className={CARD_HEADER_CLS}>
          <h2 className={CARD_TITLE_CLS}>Single-Sheet Exports</h2>
        </div>
        <div className={CARD_BODY_CLS}>
          <p className="text-sm text-text-muted">
            Each download contains one .xlsx sheet for the chosen entity.
            All records are included — drafts, pending, and deactivated rows.
          </p>
          <div className="flex flex-wrap gap-2">
            <DownloadButton
              label="Users"
              onClick={() => exportService.downloadUsers(fyForApi, "central")}
            />
            <DownloadButton
              label="Projects"
              onClick={() => exportService.downloadProjects(fyForApi, "central")}
            />
            <DownloadButton
              label="Annual Goals"
              onClick={() =>
                exportService.downloadGoals({ fy: fyForApi }, "central")
              }
            />
            <DownloadButton
              label="Annual Reviews"
              onClick={() =>
                exportService.downloadAnnualReviews({ fy: fyForApi }, "central")
              }
            />
            <DownloadButton
              label="Project Reviews"
              onClick={() =>
                exportService.downloadProjectReviews({ fy: fyForApi }, "central")
              }
            />
          </div>
        </div>
      </section>

      {/* Combined workbook */}
      <section className={CARD_CLS}>
        <div className={CARD_HEADER_CLS}>
          <h2 className={CARD_TITLE_CLS}>Combined Workbook</h2>
        </div>
        <div className={CARD_BODY_CLS}>
          <p className="text-sm text-text-muted">
            A single .xlsx workbook with sheets for all five entities plus
            Project Assignments and Project Review Evaluators.
          </p>
          <DownloadButton
            label="Download Combined Workbook"
            onClick={() => exportService.downloadCombined(fyForApi)}
          />
        </div>
      </section>

      {/* Per-employee */}
      <section className={CARD_CLS}>
        <div className={CARD_HEADER_CLS}>
          <h2 className={CARD_TITLE_CLS}>Per-Employee Export</h2>
        </div>
        <div className={CARD_BODY_CLS}>
          <p className="text-sm text-text-muted">
            Multi-sheet workbook for one employee: Profile + Annual Goals
            + Annual Reviews + Project Reviews.
          </p>
          <div className="relative max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search by name, code or email…"
              value={employeeQuery}
              onChange={(e) => {
                setEmployeeQuery(e.target.value);
                setSelectedEmployeeId(null);
              }}
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
              aria-label="Search employees for export"
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            {employeeLoading ? (
              <div className="p-3 text-sm text-text-muted">Searching…</div>
            ) : employees.length === 0 ? (
              <div className="p-3 text-sm text-text-muted">No employees match.</div>
            ) : (
              <ul className="divide-y divide-border">
                {employees.map((e) => {
                  const isSelected = e.id === selectedEmployeeId;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedEmployeeId(e.id)}
                        className={
                          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm " +
                          (isSelected
                            ? "bg-surface"
                            : "hover:bg-surface")
                        }
                      >
                        <UserRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
                        <span className="flex-1">
                          <span className="font-medium text-text-main">{e.full_name}</span>
                          <span className="ml-2 text-xs text-text-muted">
                            {e.employee_code} · {e.email}
                          </span>
                        </span>
                        {e.is_deleted && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">
                            Deactivated
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <DownloadButton
            label={
              selectedEmployee
                ? `Download ${selectedEmployee.full_name}'s File`
                : "Select an employee to export"
            }
            onClick={() =>
              selectedEmployee
                ? exportService.downloadEmployee(selectedEmployee.id, fyForApi)
                : Promise.resolve()
            }
            disabled={!selectedEmployee}
          />
        </div>
      </section>
    </div>
  );
}
