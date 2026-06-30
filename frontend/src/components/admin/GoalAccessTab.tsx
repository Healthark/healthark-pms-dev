/**
 * GoalAccessTab — Admin "Goal Access" surface.
 *
 * Grants a specific employee a temporary exception to the closed annual-goal
 * window: a toggle to let them add new goals, and a per-goal "Throw back to
 * draft" action on their approved goals (which also unlocks editing for that
 * goal's half). A second section lists everyone with an active grant so the
 * Admin can revoke once the work is done.
 *
 * All writes go through /admin/goal-access* + /admin/goals/{id}/revert-to-draft;
 * the goal gate honours the resulting grants (see backend goal_routes).
 */
import { useState } from "react";
import { KeyRound, RotateCcw, Trash2, Users2 } from "lucide-react";
import { UserCombobox } from "../common/UserCombobox";
import { ApprovalStatusBadge } from "../goals/ApprovalStatusBadge";
import type { ApprovalStatus } from "../../services/goal.service";
import type { AdminGoalBrief, GoalAccessGrant } from "../../services/admin.service";
import {
  useGoalAccessForUser,
  useGoalAccessGrants,
  useRevertGoalToDraft,
  useRevokeGoalAccess,
  useSetGoalAccess,
} from "../../queries/goalAccess";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";

export function GoalAccessTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data: detail, isLoading: detailLoading } =
    useGoalAccessForUser(selectedUserId);
  const { data: grants = [], isLoading: grantsLoading } = useGoalAccessGrants();
  const setAccess = useSetGoalAccess();
  const revokeAccess = useRevokeGoalAccess();
  const revertGoal = useRevertGoalToDraft();

  const busy =
    setAccess.isPending || revokeAccess.isPending || revertGoal.isPending;

  // allow_create lives on the active-half grant row.
  const activeGrant = detail?.grants.find(
    (g) => g.period_label === detail.active_period_label,
  );
  const allowCreate = activeGrant?.allow_create ?? false;

  const handleToggleCreate = async (next: boolean) => {
    if (!selectedUserId) return;
    try {
      await setAccess.mutateAsync({
        userId: selectedUserId,
        payload: { allow_create: next },
      });
      toast.success(
        next
          ? "Granted — the employee can add new goals."
          : "Removed add-new-goals access.",
      );
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleRevert = async (goal: AdminGoalBrief) => {
    const ok = await confirm({
      title: "Throw this goal back to draft?",
      message:
        `"${goal.title}" will return to draft and ${detail?.user_name ?? "the employee"} ` +
        "will be able to edit it. They must resubmit it for their mentor's approval.",
      variant: "warning",
      confirmText: "Throw back",
    });
    if (!ok) return;
    try {
      await revertGoal.mutateAsync(goal.id);
      toast.success("Goal thrown back to draft — the employee can now edit it.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleRevoke = async (grant: GoalAccessGrant) => {
    const ok = await confirm({
      title: "Revoke goal access?",
      message: `Revoke ${grant.user_name}'s goal access for ${grant.period_label}?`,
      variant: "warning",
      confirmText: "Revoke",
    });
    if (!ok) return;
    try {
      await revokeAccess.mutateAsync({
        userId: grant.user_id,
        periodLabel: grant.period_label,
      });
      toast.success(`Revoked ${grant.user_name}'s goal access.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Goal Access
          </h2>
          <p className="text-xs text-text-muted">
            Grant a specific employee a temporary exception to the closed goal
            window — let them add new goals, or throw an approved goal back to
            draft so they can revise it.
          </p>
        </div>
      </div>

      {/* ── Manage an employee ── */}
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

        {selectedUserId != null && detailLoading && (
          <p className="text-sm text-text-muted">Loading…</p>
        )}

        {selectedUserId != null && detail && (
          <div className="space-y-5 rounded-xl border border-border bg-surface-muted/40 p-4">
            {/* Allow adding new goals */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-main">
                  Allow adding new goals
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Lets {detail.user_name} create new annual goals for{" "}
                  {detail.active_period_label ?? "the active half"} even though
                  the window is closed. (Creating a goal still needs a mentor.)
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={allowCreate}
                disabled={busy}
                onClick={() => handleToggleCreate(!allowCreate)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                  allowCreate ? "bg-brand" : "bg-slate-200 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-surface shadow transition duration-200 ${
                    allowCreate ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Goals — throw approved ones back to draft */}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">
                Annual goals · current fiscal year
              </p>
              {detail.goals.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No annual goals for the current fiscal year.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border bg-surface">
                  {detail.goals.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="truncate text-sm text-text-main">
                          {g.title}
                        </span>
                        <ApprovalStatusBadge
                          status={g.approval_status as ApprovalStatus}
                        />
                      </div>
                      {g.can_revert && (
                        <button
                          type="button"
                          onClick={() => handleRevert(g)}
                          disabled={busy}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-main transition-colors hover:bg-surface-muted disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Revert to draft
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Active grants overview ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-brand" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-text-main">
            Employees with active access
          </h3>
        </div>
        {grantsLoading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            No active grants. Use the picker above to grant an employee access.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-muted/80 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Access</th>
                  <th className="px-4 py-2.5">Half</th>
                  <th className="px-4 py-2.5">Granted by</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {grants.map((grant) => (
                  <tr
                    key={`${grant.user_id}-${grant.period_label}`}
                    className="hover:bg-surface-muted/40"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-text-main">
                        {grant.user_name}
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {grant.employee_code}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {grant.allow_create && (
                          <span className="rounded-full border border-brand/40 bg-brand-light px-2 py-0.5 text-[11px] font-medium text-brand">
                            Add
                          </span>
                        )}
                        {grant.allow_edit && (
                          <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            Edit
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {grant.period_label}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {grant.granted_by_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(grant)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
