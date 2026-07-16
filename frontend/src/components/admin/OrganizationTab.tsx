/**
 * OrganizationTab — Admin "Organization" surface.
 *
 * Manage the org's departments and roles (designations) so structure no longer
 * has to be seeded by hand: add / rename / deactivate / reactivate. An accordion
 * of departments, each expanding to its roles.
 *
 * Deliberate boundaries:
 *   - Deletes are SOFT (deactivate) — the row is hidden from every dropdown but
 *     existing assignments and history stay intact, and it can be reactivated.
 *   - A role's LEVEL is shown read-only here with a deep-link to the Competency
 *     Framework tab, which stays the single writer of designation levels.
 *   - Re-parenting a role to another department is out of scope for v1.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  useOrgStructure,
  useCreateDepartment,
  useRenameDepartment,
  useDeactivateDepartment,
  useReactivateDepartment,
  useCreateDesignation,
  useRenameDesignation,
  useDeactivateDesignation,
  useReactivateDesignation,
} from "../../queries/orgStructure";
import type { OrgDepartment, OrgDesignation } from "../../services/orgStructure.service";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";

type Editing = { kind: "dept" | "role"; id: number } | null;

function ActivePill({ active }: { readonly active: boolean }) {
  return active ? (
    <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      Active
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
      Inactive
    </span>
  );
}

export function OrganizationTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const [, setSearchParams] = useSearchParams();

  const { data, isLoading, isError } = useOrgStructure();

  const createDept = useCreateDepartment();
  const renameDept = useRenameDepartment();
  const deactivateDept = useDeactivateDepartment();
  const reactivateDept = useReactivateDepartment();
  const createRole = useCreateDesignation();
  const renameRole = useRenameDesignation();
  const deactivateRole = useDeactivateDesignation();
  const reactivateRole = useReactivateDesignation();

  const busy =
    createDept.isPending || renameDept.isPending || deactivateDept.isPending ||
    reactivateDept.isPending || createRole.isPending || renameRole.isPending ||
    deactivateRole.isPending || reactivateRole.isPending;

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [editValue, setEditValue] = useState("");
  const [newDept, setNewDept] = useState("");
  const [addingRoleFor, setAddingRoleFor] = useState<number | null>(null);
  const [newRole, setNewRole] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const err = (e: unknown) => snackbar.error(getErrorMessage(e));

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startEdit = (kind: "dept" | "role", id: number, name: string) => {
    setEditing({ kind, id });
    setEditValue(name);
  };
  const cancelEdit = () => {
    setEditing(null);
    setEditValue("");
  };
  const commitEdit = () => {
    // Guard against a second commit (onBlur + Enter, or a repeated Enter) while
    // a rename is already in flight — `editing` is only cleared in onSuccess.
    if (!editing || busy) return;
    const name = editValue.trim();
    if (!name) return cancelEdit();
    const opts = { onSuccess: () => { toast.success("Renamed."); cancelEdit(); }, onError: err };
    if (editing.kind === "dept") renameDept.mutate({ id: editing.id, name }, opts);
    else renameRole.mutate({ id: editing.id, name }, opts);
  };

  const addDepartment = () => {
    const name = newDept.trim();
    // `busy` guard: the input isn't cleared until onSuccess, so a repeated Enter
    // would otherwise fire a duplicate create and surface a spurious 409.
    if (!name || busy) return;
    createDept.mutate(name, {
      onSuccess: () => { toast.success(`Added "${name}".`); setNewDept(""); },
      onError: err,
    });
  };

  const addRole = (departmentId: number) => {
    const name = newRole.trim();
    if (!name || busy) return;
    createRole.mutate(
      { name, department_id: departmentId },
      {
        onSuccess: () => {
          toast.success(`Added "${name}".`);
          setNewRole("");
          setAddingRoleFor(null);
        },
        onError: err,
      },
    );
  };

  const confirmDeactivateDept = async (dep: OrgDepartment) => {
    const ok = await confirm({
      title: `Deactivate "${dep.name}"?`,
      message:
        `It (and its roles) will be hidden from all dropdowns. ${dep.active_user_count} active ` +
        `${dep.active_user_count === 1 ? "user keeps their" : "users keep their"} current ` +
        "assignment. You can reactivate it later.",
      variant: "warning",
      confirmText: "Deactivate",
    });
    if (ok) deactivateDept.mutate(dep.id, { onSuccess: () => toast.success(`Deactivated "${dep.name}".`), onError: err });
  };

  const confirmDeactivateRole = async (role: OrgDesignation) => {
    const ok = await confirm({
      title: `Deactivate "${role.name}"?`,
      message:
        `It will be hidden from role dropdowns. ${role.active_user_count} active ` +
        `${role.active_user_count === 1 ? "user keeps this role" : "users keep this role"}. ` +
        "You can reactivate it later.",
      variant: "warning",
      confirmText: "Deactivate",
    });
    if (ok) deactivateRole.mutate(role.id, { onSuccess: () => toast.success(`Deactivated "${role.name}".`), onError: err });
  };

  const goEditLevel = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "competency-framework");
        return next;
      },
      { replace: true },
    );

  const departments = (data?.departments ?? []).filter((d) => showInactive || d.is_active);
  const unscoped = (data?.unscoped_designations ?? []).filter((d) => showInactive || d.is_active);
  const hiddenInactive =
    (data?.departments ?? []).some((d) => !d.is_active) ||
    (data?.departments ?? []).some((d) => d.designations.some((r) => !r.is_active)) ||
    (data?.unscoped_designations ?? []).some((d) => !d.is_active);

  // Once nothing inactive remains, the "Show inactive" toggle unmounts. Reset
  // the flag during render (React's "adjust state on data change" pattern) so a
  // later deactivation starts hidden, matching a fresh visit — otherwise the
  // toggle would silently reappear pre-checked.
  if (!hiddenInactive && showInactive) setShowInactive(false);

  // ── Row renderer for a role (used in dept cards + unscoped section) ──────
  const renderRole = (role: OrgDesignation) => (
    <li key={role.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-muted/50">
      {editing?.kind === "role" && editing.id === role.id ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
          aria-label="Role name"
          className="min-w-0 flex-1 rounded-md border border-brand bg-surface px-2 py-1 text-sm text-text-main outline-none"
        />
      ) : (
        <span className={`min-w-0 flex-1 truncate text-sm ${role.is_active ? "text-text-main" : "text-text-muted italic"}`}>
          {role.name}
        </span>
      )}

      <span className="shrink-0 rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
        {role.level != null ? `L${role.level}` : "—"}
      </span>
      <button
        type="button"
        onClick={goEditLevel}
        className="shrink-0 text-[10px] text-brand hover:underline"
        title="Levels are set in the Competency Framework tab"
      >
        Edit level ↗
      </button>

      <ActivePill active={role.is_active} />

      {role.is_active ? (
        <>
          <button type="button" disabled={busy} onClick={() => startEdit("role", role.id, role.name)} className="shrink-0 rounded p-1 text-text-muted hover:text-text-main disabled:opacity-40" aria-label="Rename role">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={busy} onClick={() => confirmDeactivateRole(role)} className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40" aria-label="Deactivate role">
            <Power className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => reactivateRole.mutate(role.id, { onSuccess: () => toast.success(`Reactivated "${role.name}".`), onError: err })} className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40 disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" /> Reactivate
        </button>
      )}
    </li>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">Organization</h2>
          <p className="text-xs text-text-muted">
            Manage departments and roles. Deactivating hides an item from all
            dropdowns but keeps existing assignments — it&rsquo;s reversible.
            Role <strong>levels</strong> are set in the Competency Framework tab.
          </p>
        </div>
      </div>

      {/* Toolbar: add department + show-inactive */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDepartment()}
            placeholder="New department name…"
            aria-label="New department name"
            className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={addDepartment}
            disabled={!newDept.trim() || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add department
          </button>
        </div>
        {hiddenInactive && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
            <SlidersHorizontal className="h-3.5 w-3.5" /> Show inactive
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load the organization structure.
        </div>
      ) : departments.length === 0 && unscoped.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
          No departments yet. Add your first one above.
        </p>
      ) : (
        <div className="space-y-3">
          {departments.map((dep) => {
            const isOpen = expanded.has(dep.id);
            const roles = dep.designations.filter((r) => showInactive || r.is_active);
            return (
              <div key={dep.id} className="rounded-xl border border-border bg-surface">
                {/* Department header row */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => toggleExpand(dep.id)} className="shrink-0 text-text-muted hover:text-text-main" aria-label={isOpen ? "Collapse" : "Expand"}>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  {editing?.kind === "dept" && editing.id === dep.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                      aria-label="Department name"
                      className="min-w-0 flex-1 rounded-md border border-brand bg-surface px-2 py-1 text-sm font-medium text-text-main outline-none"
                    />
                  ) : (
                    <button type="button" onClick={() => toggleExpand(dep.id)} className={`min-w-0 flex-1 truncate text-left text-sm font-semibold ${dep.is_active ? "text-text-main" : "text-text-muted italic"}`}>
                      {dep.name}
                      <span className="ml-2 text-[11px] font-normal text-text-muted">
                        ({roles.length} {roles.length === 1 ? "role" : "roles"})
                      </span>
                    </button>
                  )}

                  <ActivePill active={dep.is_active} />

                  {dep.is_active ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => { setNewRole(""); setAddingRoleFor(dep.id); setExpanded((p) => new Set(p).add(dep.id)); }} className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand-light disabled:opacity-40">
                        <Plus className="h-3.5 w-3.5" /> Add role
                      </button>
                      <button type="button" disabled={busy} onClick={() => startEdit("dept", dep.id, dep.name)} className="shrink-0 rounded p-1 text-text-muted hover:text-text-main disabled:opacity-40" aria-label="Rename department">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={busy} onClick={() => confirmDeactivateDept(dep)} className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40" aria-label="Deactivate department">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => reactivateDept.mutate(dep.id, { onSuccess: () => toast.success(`Reactivated "${dep.name}".`), onError: err })} className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40 disabled:opacity-40">
                      <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                    </button>
                  )}
                </div>

                {/* Roles */}
                {isOpen && (
                  <div className="border-t border-border">
                    {roles.length === 0 && addingRoleFor !== dep.id ? (
                      <p className="px-4 py-3 text-xs italic text-text-muted">No roles in this department yet.</p>
                    ) : (
                      <ul className="divide-y divide-border/60">{roles.map(renderRole)}</ul>
                    )}

                    {addingRoleFor === dep.id && (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input
                          autoFocus
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addRole(dep.id); if (e.key === "Escape") { setAddingRoleFor(null); setNewRole(""); } }}
                          placeholder="New role name…"
                          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-main outline-none focus:border-brand"
                        />
                        <button type="button" disabled={!newRole.trim() || busy} onClick={() => addRole(dep.id)} className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          Add
                        </button>
                        <button type="button" onClick={() => { setAddingRoleFor(null); setNewRole(""); }} className="shrink-0 rounded-md px-2 py-1 text-xs text-text-muted hover:text-text-main">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Legacy roles with no department */}
          {unscoped.length > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-surface">
              <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Unassigned roles (no department)
              </div>
              <ul className="divide-y divide-border/60 border-t border-border">{unscoped.map(renderRole)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
