/**
 * ReviewEligibilityTab — Admin "Review Eligibility" surface.
 *
 * A searchable list of active projects, each with a checkbox = "eligible for
 * review." Opt-out: everything is checked by default. Unchecking a project
 * (then Save) removes the WHOLE project — every member AND the PM — from every
 * review surface (PM queue, My Reviews, secondary queue, management/All Reviews,
 * reports-to, dashboard counts). Nothing is deleted, so re-checking restores it.
 *
 * Writes go through PATCH /admin/review-eligibility.
 */
import { useMemo, useState } from "react";
import { AlertCircle, ClipboardCheck, Loader2, Save, Search } from "lucide-react";
import {
  useReviewEligibility,
  useUpdateReviewEligibility,
} from "../../queries/reviewEligibility";
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

  const { data, isLoading, isError } = useReviewEligibility();
  const updateEligibility = useUpdateReviewEligibility();

  const [search, setSearch] = useState("");
  // Local checkbox state, seeded from the loaded list. Re-seed when a fresh
  // list arrives (tracked during render — React's reset pattern).
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) {
    setSeeded(true);
    setChecked(
      Object.fromEntries(
        data.projects.map((p) => [p.project_id, p.review_eligible]),
      ),
    );
  }

  const projects = data?.projects ?? [];
  const dirty = projects.some(
    (p) => (checked[p.project_id] ?? true) !== p.review_eligible,
  );
  const ineligibleCount = projects.filter(
    (p) => !(checked[p.project_id] ?? true),
  ).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.project_name.toLowerCase().includes(q) ||
        p.project_code.toLowerCase().includes(q),
    );
  }, [projects, search]);

  const toggle = (projectId: number) =>
    setChecked((prev) => ({
      ...prev,
      [projectId]: !(prev[projectId] ?? true),
    }));

  const handleSave = async () => {
    if (!dirty) return;
    try {
      await updateEligibility.mutateAsync({
        projects: projects.map((p) => ({
          project_id: p.project_id,
          review_eligible: checked[p.project_id] ?? true,
        })),
      });
      // Re-seed from the fresh server list on next render.
      setSeeded(false);
      toast.success("Review eligibility updated.");
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

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Couldn&rsquo;t load projects. Please try again.</span>
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-4">
          {/* Search + save toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project name or code…"
                aria-label="Search projects"
                className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-text-main outline-none focus:border-brand"
              />
            </div>
            <p className="text-xs text-text-muted">
              {ineligibleCount === 0
                ? "All projects eligible."
                : `${ineligibleCount} excluded from review.`}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || updateEligibility.isPending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateEligibility.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Save
            </button>
          </div>

          {/* Project list */}
          {projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              No active projects.
            </p>
          ) : visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              No projects match &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border bg-surface">
              {visible.map((p) => (
                <li
                  key={p.project_id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <input
                    id={`re-${p.project_id}`}
                    type="checkbox"
                    checked={checked[p.project_id] ?? true}
                    onChange={() => toggle(p.project_id)}
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
          )}
        </div>
      )}
    </div>
  );
}
