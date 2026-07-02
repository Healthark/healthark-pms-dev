/**
 * ReviewScopeTab — Admin "Review Scope" surface.
 *
 * Pick an employee, then check/uncheck which of their active member projects
 * they should be REVIEWED ON. Opt-out: everything is checked by default.
 * Unchecking a project (then Save) removes that (employee, project) pair from
 * every project-review surface — the PM's queue, the employee's My Reviews,
 * the secondary queue, and completion counts — and soft-deletes its open-cycle
 * reviews (past-FY history is preserved). Re-checking restores them.
 *
 * Writes go through PATCH /admin/review-scope/{user_id}.
 */
import { useState } from "react";
import { AlertCircle, ClipboardCheck, Loader2, Save } from "lucide-react";
import { UserCombobox } from "../common/UserCombobox";
import {
  useEmployeeReviewScope,
  useUpdateReviewScope,
} from "../../queries/reviewScope";
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

export function ReviewScopeTab() {
  const toast = useToast();
  const snackbar = useSnackbar();

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { data: detail, isLoading, isError } =
    useEmployeeReviewScope(selectedUserId);
  const updateScope = useUpdateReviewScope();

  // Local checkbox state, seeded from the loaded detail. Re-seed when the
  // selected employee changes (tracked during render — React's reset pattern).
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (detail && seededFor !== detail.user_id) {
    setSeededFor(detail.user_id);
    setChecked(
      Object.fromEntries(
        detail.projects.map((p) => [p.project_id, p.review_included]),
      ),
    );
  }

  const dirty =
    detail?.projects.some(
      (p) => (checked[p.project_id] ?? true) !== p.review_included,
    ) ?? false;
  const excludedCount = detail
    ? detail.projects.filter((p) => !(checked[p.project_id] ?? true)).length
    : 0;

  const toggle = (projectId: number) =>
    setChecked((prev) => ({
      ...prev,
      [projectId]: !(prev[projectId] ?? true),
    }));

  const handleSave = async () => {
    if (!detail || !dirty) return;
    try {
      await updateScope.mutateAsync({
        userId: detail.user_id,
        payload: {
          projects: detail.projects.map((p) => ({
            project_id: p.project_id,
            review_included: checked[p.project_id] ?? true,
          })),
        },
      });
      toast.success("Review scope updated.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Review Scope
          </h2>
          <p className="text-xs text-text-muted">
            Choose which of an employee&rsquo;s projects they are reviewed on.
            Everything is included by default; unchecking a project removes that
            employee from its reviews (open reviews are cleared, past history is
            kept).
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div className="max-w-md">
          <UserCombobox
            value={selectedUserId}
            onChange={setSelectedUserId}
            label="Employee"
            placeholder="Search by name or email…"
            filter={(u) => !u.is_deleted}
          />
        </div>

        {selectedUserId != null && isLoading && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}

        {selectedUserId != null && isError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Couldn&rsquo;t load this employee&rsquo;s projects. Please try again.</span>
          </div>
        )}

        {selectedUserId != null &&
          detail &&
          !isLoading &&
          (detail.projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              {detail.user_name} isn&rsquo;t a member of any active project.
            </p>
          ) : (
            <div className="space-y-4 rounded-xl border border-border bg-surface-muted/40 p-4">
              <ul className="divide-y divide-border/60 rounded-lg border border-border bg-surface">
                {detail.projects.map((p) => (
                  <li
                    key={p.project_id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <input
                      id={`rs-${p.project_id}`}
                      type="checkbox"
                      checked={checked[p.project_id] ?? true}
                      onChange={() => toggle(p.project_id)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
                    />
                    <label
                      htmlFor={`rs-${p.project_id}`}
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

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-text-muted">
                  {excludedCount === 0
                    ? "All projects included."
                    : `${excludedCount} excluded from review.`}
                </p>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || updateScope.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateScope.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden="true" />
                  )}
                  Save
                </button>
              </div>
            </div>
          ))}
      </section>
    </div>
  );
}
