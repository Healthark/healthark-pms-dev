/**
 * CompetencyFrameworkTab — Admin "Competency Framework" surface.
 *
 * Edits the per-department competency matrix (competencies × levels) plus the
 * org DEFAULT fallback set and the role→level mapping. Every field autosaves on
 * blur/change and surfaces its own save state inline (saving / saved / error),
 * so the admin never has to wonder whether an edit landed.
 *
 * Data layer is untouched — all reads/writes go through the competencyFramework
 * query hooks, which mirror the backend admin_competency_routes contract.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  LayoutGrid,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useDepartments } from "../../queries/adminReferenceData";
import {
  useFramework,
  useCreateCompetency,
  useUpdateCompetency,
  useDeleteCompetency,
  useUpdateCell,
  useAddLevel,
  useSetDesignationLevel,
} from "../../queries/competencyFramework";
import {
  DEFAULT_CELL_KEY,
  type FrameworkCell,
  type FrameworkCompetency,
} from "../../services/competencyFramework.service";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";

const DEFAULT_OPTION = "default";

const TEXTAREA_CLS =
  "w-full min-w-[200px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] leading-relaxed text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand resize-y";

// Sticky-left column shells: keep the reorder + competency columns pinned while
// the level columns scroll, so a wide matrix never loses the row it's on.
const STICKY_NUM_CLS = "sticky left-0 z-10 w-12";
const STICKY_COMP_CLS = "sticky left-12 z-10 min-w-[240px] border-r border-border";

type SaveState = "saving" | "saved" | "error";

/** Tiny inline status glyph shown next to an autosaving field. */
function SaveIndicator({ state }: { readonly state: SaveState | undefined }) {
  if (state === "saving")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" aria-label="Saving" />;
  if (state === "saved")
    return <Check className="h-3.5 w-3.5 text-emerald-500" aria-label="Saved" />;
  if (state === "error")
    return <AlertCircle className="h-3.5 w-3.5 text-red-500" aria-label="Save failed" />;
  return null;
}

export function CompetencyFrameworkTab() {
  const { data: departments = [] } = useDepartments();
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  // "" = nothing chosen yet, "default" = org default set, else a department id.
  const [selected, setSelected] = useState<string>("");
  useEffect(() => {
    if (!selected && departments.length) setSelected(String(departments[0].id));
  }, [selected, departments]);

  const isDefault = selected === DEFAULT_OPTION;
  const deptId = isDefault || selected === "" ? null : Number(selected);
  const { data: fw, isLoading } = useFramework(deptId, selected !== "");

  const createComp = useCreateCompetency();
  const updateComp = useUpdateCompetency();
  const deleteComp = useDeleteCompetency();
  const updateCell = useUpdateCell();
  const addLevel = useAddLevel();
  const setDesigLevel = useSetDesignationLevel(deptId);

  const [newLabel, setNewLabel] = useState("");
  const [newReviewable, setNewReviewable] = useState(true);
  const [newLevel, setNewLevel] = useState("");

  // Per-field autosave status, keyed by a stable field id (cell-42, label-foo…).
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const clearTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [movingKey, setMovingKey] = useState<string | null>(null);

  // Drop any pending "saved → clear" timers on unmount.
  useEffect(() => {
    const timers = clearTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const beginSave = (id: string) =>
    setSaveState((s) => ({ ...s, [id]: "saving" }));

  const markSaved = (id: string) => {
    setSaveState((s) => ({ ...s, [id]: "saved" }));
    clearTimeout(clearTimers.current[id]);
    clearTimers.current[id] = setTimeout(() => {
      setSaveState((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }, 1800);
  };

  const markError = (id: string, e: unknown) => {
    setSaveState((s) => ({ ...s, [id]: "error" }));
    snackbar.error(getErrorMessage(e));
  };

  const busy =
    createComp.isPending ||
    updateComp.isPending ||
    deleteComp.isPending ||
    addLevel.isPending;

  // Column keys: the default set has a single "default" column; a department
  // has one column per level.
  const columns = useMemo(
    () => (fw?.is_default ? [DEFAULT_CELL_KEY] : (fw?.levels ?? []).map(String)),
    [fw],
  );

  // Roles mapped to each level, for the column subtitles.
  const rolesByLevel = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const d of fw?.designations ?? []) {
      const k = String(d.level);
      (m[k] ??= []).push(d.name);
    }
    return m;
  }, [fw]);

  const saveCell = (cell: FrameworkCell, value: string) => {
    if ((cell.expectation ?? "") === value) return;
    const id = `cell-${cell.competency_id}`;
    beginSave(id);
    updateCell.mutate(
      { competencyId: cell.competency_id, expectation: value === "" ? null : value },
      { onSuccess: () => markSaved(id), onError: (e) => markError(id, e) },
    );
  };

  const saveLabel = (comp: FrameworkCompetency, value: string) => {
    const v = value.trim();
    if (!v || v === comp.label) return;
    const id = `label-${comp.key}`;
    beginSave(id);
    updateComp.mutate(
      { department_id: deptId, key: comp.key, label: v },
      { onSuccess: () => markSaved(id), onError: (e) => markError(id, e) },
    );
  };

  const toggleReviewable = (comp: FrameworkCompetency, value: boolean) => {
    const id = `rev-${comp.key}`;
    beginSave(id);
    updateComp.mutate(
      { department_id: deptId, key: comp.key, is_reviewable: value },
      { onSuccess: () => markSaved(id), onError: (e) => markError(id, e) },
    );
  };

  const move = async (index: number, dir: -1 | 1) => {
    const comps = fw?.competencies ?? [];
    const other = comps[index + dir];
    const cur = comps[index];
    if (!other || !cur) return;
    setMovingKey(cur.key);
    try {
      await updateComp.mutateAsync({
        department_id: deptId,
        key: cur.key,
        display_order: other.display_order,
      });
      await updateComp.mutateAsync({
        department_id: deptId,
        key: other.key,
        display_order: cur.display_order,
      });
    } catch (e) {
      snackbar.error(getErrorMessage(e));
    } finally {
      setMovingKey(null);
    }
  };

  const removeComp = async (comp: FrameworkCompetency) => {
    const ok = await confirm({
      title: "Remove this competency?",
      message:
        `"${comp.label}" will be removed from this framework. Existing reviews that ` +
        "already reference it keep showing it — this only affects future evaluations.",
      variant: "warning",
      confirmText: "Remove",
    });
    if (!ok) return;
    deleteComp.mutate(
      { departmentId: deptId, key: comp.key },
      {
        onSuccess: () => toast.success(`Removed "${comp.label}".`),
        onError: (e) => snackbar.error(getErrorMessage(e)),
      },
    );
  };

  const addComp = () => {
    const label = newLabel.trim();
    if (!label) return;
    createComp.mutate(
      { departmentId: deptId, label, isReviewable: newReviewable },
      {
        onSuccess: () => {
          setNewLabel("");
          setNewReviewable(true);
          toast.success(`Added "${label}".`);
        },
        onError: (e) => snackbar.error(getErrorMessage(e)),
      },
    );
  };

  const doAddLevel = () => {
    const lvl = Number(newLevel);
    if (deptId == null || !Number.isInteger(lvl) || lvl < 1 || lvl > 20) return;
    if ((fw?.levels ?? []).includes(lvl)) {
      snackbar.error(`Level ${lvl} already exists for this department.`);
      return;
    }
    addLevel.mutate(
      { departmentId: deptId, level: lvl },
      {
        onSuccess: () => {
          setNewLevel("");
          toast.success(`Added level ${lvl}.`);
        },
        onError: (e) => snackbar.error(getErrorMessage(e)),
      },
    );
  };

  const selectedDeptName = departments.find((d) => String(d.id) === selected)?.name;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header — mirrors the other admin tabs (icon + title + blurb) */}
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Competency Framework
          </h2>
          <p className="text-xs text-text-muted">
            Define the competencies and per-level expectations used in project
            reviews. Departments without their own framework fall back to the{" "}
            <strong>Default</strong> set. Edits save automatically; removing a
            competency is a soft-delete, so historical reviews keep the
            competencies they were written against.
          </p>
        </div>
      </div>

      {/* Toolbar — department picker + at-a-glance summary */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="fw-dept" className="text-sm font-medium text-text-main">
          Framework for
        </label>
        <select
          id="fw-dept"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
        >
          {departments.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
            </option>
          ))}
          <option value={DEFAULT_OPTION}>★ Default (fallback set)</option>
        </select>

        {fw && (
          <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-medium text-text-muted">
            {fw.competencies.length}{" "}
            {fw.competencies.length === 1 ? "competency" : "competencies"}
            {!fw.is_default && (
              <>
                {" · "}
                {columns.length} {columns.length === 1 ? "level" : "levels"}
              </>
            )}
          </span>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
      </div>

      {isLoading || !fw ? (
        <div className="flex items-center gap-2 py-10 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading framework…
        </div>
      ) : (
        <>
          {/* Default-set explainer */}
          {fw.is_default && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-xs text-text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              <span>
                This is the organization-wide fallback used by any department
                that doesn&rsquo;t have its own framework. It carries a single
                expectation per competency — no per-level columns.
              </span>
            </div>
          )}

          {/* Role → level mapping (departments only) */}
          {!fw.is_default && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Roles → Levels
              </h3>
              <p className="mb-3 text-xs text-text-muted">
                Map each role in {selectedDeptName ?? "this department"} to a
                level. The matrix below shows one column per level in use.
              </p>
              {fw.designations.length === 0 ? (
                <p className="text-sm italic text-text-muted">
                  No roles in this department yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {fw.designations.map((d) => {
                    const id = `desig-${d.id}`;
                    return (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
                      >
                        <span className="text-text-main">{d.name}</span>
                        <span className="text-text-muted">L</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          defaultValue={d.level ?? undefined}
                          placeholder="—"
                          onBlur={(e) => {
                            const lvl = Number(e.target.value);
                            if (
                              Number.isInteger(lvl) &&
                              lvl >= 1 &&
                              lvl <= 20 &&
                              lvl !== d.level
                            ) {
                              beginSave(id);
                              setDesigLevel.mutate(
                                { designationId: d.id, level: lvl },
                                {
                                  onSuccess: () => markSaved(id),
                                  onError: (err) => markError(id, err),
                                },
                              );
                            }
                          }}
                          className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-main outline-none focus:border-brand"
                        />
                        <SaveIndicator state={saveState[id]} />
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Competency matrix */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-muted">
                  <th
                    className={`${STICKY_NUM_CLS} bg-surface-muted px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted`}
                  >
                    <span className="sr-only">Reorder</span>
                  </th>
                  <th
                    className={`${STICKY_COMP_CLS} bg-surface-muted px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted`}
                  >
                    Competency
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 align-bottom text-[11px] font-bold uppercase tracking-wider text-text-muted"
                    >
                      {fw.is_default ? "Expectation" : `Level ${col}`}
                      {!fw.is_default && rolesByLevel[col] && (
                        <div className="mt-0.5 text-[10px] font-normal normal-case text-text-muted/80">
                          {rolesByLevel[col].join(", ")}
                        </div>
                      )}
                    </th>
                  ))}
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {fw.competencies.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 3}
                      className="px-3 py-8 text-center text-sm italic text-text-muted"
                    >
                      No competencies yet. Add your first one below.
                    </td>
                  </tr>
                ) : (
                  fw.competencies.map((comp, i) => (
                    <tr
                      key={comp.key}
                      className="group border-t border-border align-top hover:bg-surface-muted/40"
                    >
                      <td
                        className={`${STICKY_NUM_CLS} bg-surface px-2 py-2 text-xs text-text-muted group-hover:bg-surface-muted/40`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0 || movingKey !== null}
                            onClick={() => move(i, -1)}
                            className="text-text-muted hover:text-text-main disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[10px] tabular-nums text-text-muted/70">
                            {i + 1}
                          </span>
                          <button
                            type="button"
                            disabled={
                              i === fw.competencies.length - 1 || movingKey !== null
                            }
                            onClick={() => move(i, 1)}
                            className="text-text-muted hover:text-text-main disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td
                        className={`${STICKY_COMP_CLS} bg-surface px-3 py-2 group-hover:bg-surface-muted/40`}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            key={`${comp.key}-label`}
                            defaultValue={comp.label}
                            onBlur={(e) => saveLabel(comp, e.target.value)}
                            className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-text-main outline-none hover:border-border focus:border-brand"
                          />
                          <SaveIndicator state={saveState[`label-${comp.key}`]} />
                        </div>
                        <label className="mt-1 flex items-center gap-1.5 px-2 text-[11px] text-text-muted">
                          <input
                            type="checkbox"
                            defaultChecked={comp.is_reviewable}
                            onChange={(e) => toggleReviewable(comp, e.target.checked)}
                            className="h-3.5 w-3.5 cursor-pointer accent-brand"
                          />
                          Reviewable (has a comment box)
                          <SaveIndicator state={saveState[`rev-${comp.key}`]} />
                        </label>
                      </td>
                      {columns.map((col) => {
                        const cell = comp.cells[col];
                        return (
                          <td key={col} className="px-3 py-2">
                            {cell ? (
                              <div className="relative">
                                <textarea
                                  key={cell.competency_id}
                                  rows={3}
                                  defaultValue={cell.expectation ?? ""}
                                  onBlur={(e) => saveCell(cell, e.target.value)}
                                  placeholder="Expectation…"
                                  className={TEXTAREA_CLS}
                                />
                                <span className="pointer-events-none absolute right-1.5 top-1.5">
                                  <SaveIndicator
                                    state={saveState[`cell-${cell.competency_id}`]}
                                  />
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeComp(comp)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Add competency + add level */}
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-dashed border-border bg-surface-muted/40 p-4">
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="fw-new" className="text-[11px] font-medium text-text-muted">
                  New competency
                </label>
                <input
                  id="fw-new"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addComp()}
                  placeholder="e.g. Task Execution & Problem Solving"
                  className="w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
                />
              </div>
              <label className="flex items-center gap-1.5 pb-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={newReviewable}
                  onChange={(e) => setNewReviewable(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-brand"
                />
                Reviewable
              </label>
              <button
                type="button"
                onClick={addComp}
                disabled={!newLabel.trim() || createComp.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add competency
              </button>
            </div>

            {!fw.is_default && (
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="fw-lvl" className="text-[11px] font-medium text-text-muted">
                    Add level column
                  </label>
                  <input
                    id="fw-lvl"
                    type="number"
                    min={1}
                    max={20}
                    value={newLevel}
                    onChange={(e) => setNewLevel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doAddLevel()}
                    placeholder="e.g. 4"
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
                  />
                </div>
                <button
                  type="button"
                  onClick={doAddLevel}
                  disabled={!newLevel || addLevel.isPending}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-main hover:bg-surface-muted disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Add level
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
