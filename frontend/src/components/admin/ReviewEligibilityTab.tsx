/**
 * ReviewEligibilityTab — Admin "Review Eligibility" surface.
 *
 * A server-paginated, searchable list of active projects, each a checkbox =
 * "eligible for review." Opt-out: everything is checked by default. Unchecking
 * a project (then Save) removes the WHOLE project — every member AND the PM —
 * from every review surface. Nothing is deleted, so re-checking restores it.
 *
 * Pagination is server-side (page / per_page / search hit the API); the
 * TablePagination bar drives it. Checkbox edits accumulate client-side in a
 * `changes` map keyed by project_id ACROSS pages and searches, so Save can send
 * every pending change at once even for projects not on the current page.
 *
 * Writes go through PATCH /admin/review-eligibility.
 */
import { useState } from "react";
import { AlertCircle, ClipboardCheck, Loader2, Save, Search } from "lucide-react";
import type { ReviewEligibilityProject } from "../../services/admin.service";
import {
  useReviewEligibility,
  useUpdateReviewEligibility,
} from "../../queries/reviewEligibility";
import { TablePagination } from "../common/TablePagination";
import { useDebounce } from "../../hooks/useDebounce";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { getErrorMessage } from "../../utils/errors";

function BillableBadge({ billable }: { readonly billable: boolean }) {
  return billable ? (
    <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      Billable
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
      Non-billable
    </span>
  );
}

export function ReviewEligibilityTab() {
  const toast = useToast();
  const snackbar = useSnackbar();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the server search so we don't fetch on every keystroke; a search
  // change resets to page 1.
  const [applySearch] = useDebounce((v: string) => {
    setSearch(v);
    setPage(1);
  }, 300);
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    applySearch(v);
  };

  const { data, isLoading, isError } = useReviewEligibility({
    page,
    per_page: perPage,
    search: search || undefined,
  });
  const update = useUpdateReviewEligibility();

  // Pending checkbox edits keyed by project_id, kept across pages + searches.
  // A row's checked state is its pending change if any, else its server value.
  const [changes, setChanges] = useState<Record<number, boolean>>({});

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const dirtyCount = Object.keys(changes).length;

  const valueFor = (p: ReviewEligibilityProject) =>
    changes[p.project_id] ?? p.review_eligible;

  const toggle = (p: ReviewEligibilityProject) =>
    setChanges((prev) => {
      const next = { ...prev };
      const newVal = !(prev[p.project_id] ?? p.review_eligible);
      if (newVal === p.review_eligible) {
        delete next[p.project_id]; // back to server value — no longer a change
      } else {
        next[p.project_id] = newVal;
      }
      return next;
    });

  const handleSave = async () => {
    if (dirtyCount === 0) return;
    try {
      const result = await update.mutateAsync({
        projects: Object.entries(changes).map(([id, v]) => ({
          project_id: Number(id),
          review_eligible: v,
        })),
      });
      setChanges({});
      toast.success(
        result.updated === 1
          ? "1 project updated."
          : `${result.updated} projects updated.`,
      );
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Review Eligibility
          </h2>
          <p className="text-xs text-text-muted">
            Choose which projects are reviewed this cycle. Everything is eligible
            by default; unchecking a project removes it — every member and the PM
            — from all review views. Nothing is deleted; re-checking restores it.
          </p>
        </div>
      </div>

      {/* Search + save toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by project name or code…"
            aria-label="Search projects"
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-text-main outline-none focus:border-brand"
          />
        </div>
        {dirtyCount > 0 && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
          </p>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={dirtyCount === 0 || update.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {update.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          Save
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : isError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Couldn&rsquo;t load projects. Please try again.</span>
        </div>
      ) : total === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {search
            ? `No projects match “${search}”.`
            : "No active projects."}
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <ul className="divide-y divide-border/60">
            {items.map((p) => (
              <li
                key={p.project_id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <input
                  id={`re-${p.project_id}`}
                  type="checkbox"
                  checked={valueFor(p)}
                  onChange={() => toggle(p)}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
                />
                <label
                  htmlFor={`re-${p.project_id}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                >
                  <span className="truncate text-sm text-text-main">
                    {p.project_name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-text-muted">
                    {p.project_code}
                  </span>
                  <BillableBadge billable={p.is_billable} />
                </label>
              </li>
            ))}
          </ul>
          <TablePagination
            page={page}
            pageSize={perPage}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPerPage(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
