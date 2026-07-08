/**
 * CompetencyFrameworkTab — Admin "Competency Framework" surface.
 *
 * Edits the per-department competency matrix (competencies × levels) plus the
 * org DEFAULT fallback set and the role→level mapping. This is a critical page,
 * so nothing hits the API as you type: every edit — cell text, name, reviewable
 * toggle, reorder, add/remove competency, add level, role→level — is staged in
 * a local DRAFT and applied together only when you click Save (one atomic
 * backend transaction). Discard reverts the draft to the last saved state.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Info,
  LayoutGrid,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useDepartments } from "../../queries/adminReferenceData";
import { useFramework, useBulkSaveFramework } from "../../queries/competencyFramework";
import {
  DEFAULT_CELL_KEY,
  type FrameworkBulkSave,
  type FrameworkResponse,
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
const STICKY_NUM_CLS = "sticky left-0 z-10 w-12 min-w-[48px] max-w-[48px]";
const STICKY_COMP_CLS = "sticky left-12 z-10 min-w-[240px] border-r border-border";

// ── Draft model ─────────────────────────────────────────────────────────
// A local, editable mirror of the server framework. Cells are keyed by column
// ("default" for the org set, else the level as a string).

interface DraftCompetency {
  /** Stable client id for React keys — the server key, or "new-N" while unsaved. */
  uid: string;
  /** null = a NEW competency not yet persisted. */
  key: string | null;
  label: string;
  is_reviewable: boolean;
  /** Staged for removal — kept in the draft so Discard can restore it. */
  is_deleted: boolean;
  cells: Record<string, string | null>;
}

interface Draft {
  /** Explicitly-added level columns (departments only). The visible column set
   *  also unions in any level a role is mapped to (see `columns`). */
  levels: number[];
  competencies: DraftCompetency[];
  /** designation id → level (null = unmapped). */
  designationLevels: Record<number, number | null>;
}

function buildDraft(fw: FrameworkResponse): Draft {
  return {
    levels: fw.is_default ? [] : [...fw.levels],
    competencies: fw.competencies.map((c) => ({
      uid: c.key,
      key: c.key,
      label: c.label,
      is_reviewable: c.is_reviewable,
      is_deleted: false,
      cells: Object.fromEntries(
        Object.entries(c.cells).map(([col, cell]) => [col, cell.expectation]),
      ),
    })),
    designationLevels: Object.fromEntries(fw.designations.map((d) => [d.id, d.level])),
  };
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
  const bulkSave = useBulkSaveFramework();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newReviewable, setNewReviewable] = useState(true);
  const [newLevel, setNewLevel] = useState("");
  const [newCounter, setNewCounter] = useState(0);

  // (Re)build the draft whenever the SERVER framework changes — initial load,
  // department switch, or a save priming the cache. During editing `fw` is a
  // stable reference (no autosave/refetch), so in-progress edits are never
  // clobbered.
  useEffect(() => {
    if (fw) {
      setDraft(buildDraft(fw));
      setDirty(false);
    }
  }, [fw]);

  const edit = (fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };

  // Column keys: the default set has a single "default" column; a department
  // shows one column per level it uses — the union of explicitly-added levels
  // and any level a role is currently mapped to (so re-leveling a role adds its
  // column live).
  const columns = useMemo(() => {
    if (!draft) return [];
    if (isDefault) return [DEFAULT_CELL_KEY];
    const set = new Set<number>(draft.levels);
    for (const lvl of Object.values(draft.designationLevels)) {
      if (lvl != null) set.add(lvl);
    }
    return Array.from(set)
      .sort((a, b) => a - b)
      .map(String);
  }, [draft, isDefault]);

  // Role names grouped under each level column, for the column subtitles.
  const rolesByLevel = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (draft && fw) {
      for (const d of fw.designations) {
        const lvl = draft.designationLevels[d.id];
        if (lvl != null) (m[String(lvl)] ??= []).push(d.name);
      }
    }
    return m;
  }, [draft, fw]);

  const visible = useMemo(
    () => draft?.competencies.filter((c) => !c.is_deleted) ?? [],
    [draft],
  );

  // ── Draft edits (all local; nothing hits the API until Save) ───────────
  const patch = (uid: string, p: Partial<DraftCompetency>) =>
    edit((d) => ({
      ...d,
      competencies: d.competencies.map((c) => (c.uid === uid ? { ...c, ...p } : c)),
    }));

  const setCell = (uid: string, col: string, value: string) =>
    edit((d) => ({
      ...d,
      competencies: d.competencies.map((c) =>
        c.uid === uid
          ? { ...c, cells: { ...c.cells, [col]: value === "" ? null : value } }
          : c,
      ),
    }));

  const removeComp = (uid: string) =>
    edit((d) => {
      const c = d.competencies.find((x) => x.uid === uid);
      if (!c) return d;
      // A never-saved competency just vanishes; an existing one is marked for
      // soft-deletion (applied on Save, restorable via Discard).
      if (c.key === null) {
        return { ...d, competencies: d.competencies.filter((x) => x.uid !== uid) };
      }
      return {
        ...d,
        competencies: d.competencies.map((x) =>
          x.uid === uid ? { ...x, is_deleted: true } : x,
        ),
      };
    });

  const moveComp = (uid: string, dir: -1 | 1) =>
    edit((d) => {
      const vis = d.competencies.filter((c) => !c.is_deleted);
      const vi = vis.findIndex((c) => c.uid === uid);
      const target = vis[vi + dir];
      if (!target) return d;
      const comps = [...d.competencies];
      const i1 = comps.findIndex((c) => c.uid === uid);
      const i2 = comps.findIndex((c) => c.uid === target.uid);
      [comps[i1], comps[i2]] = [comps[i2], comps[i1]];
      return { ...d, competencies: comps };
    });

  const addComp = () => {
    const label = newLabel.trim();
    if (!label) return;
    edit((d) => ({
      ...d,
      competencies: [
        ...d.competencies,
        {
          uid: `new-${newCounter}`,
          key: null,
          label,
          is_reviewable: newReviewable,
          is_deleted: false,
          cells: {},
        },
      ],
    }));
    setNewCounter((n) => n + 1);
    setNewLabel("");
    setNewReviewable(true);
  };

  const addLevel = () => {
    const lvl = Number(newLevel);
    if (deptId == null || !Number.isInteger(lvl) || lvl < 1 || lvl > 20) return;
    if (columns.includes(String(lvl))) {
      snackbar.error(`Level ${lvl} already exists for this department.`);
      return;
    }
    edit((d) => ({ ...d, levels: [...d.levels, lvl] }));
    setNewLevel("");
  };

  const setDesigLevel = (id: number, value: string) => {
    const n = value === "" ? null : Number(value);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 20)) return;
    edit((d) => ({ ...d, designationLevels: { ...d.designationLevels, [id]: n } }));
  };

  // ── Save / Discard ─────────────────────────────────────────────────────
  const save = () => {
    if (!draft) return;
    // Guard: labels are required (backend enforces min_length=1).
    if (visible.some((c) => !c.label.trim())) {
      snackbar.error("Every competency needs a name.");
      return;
    }
    const payload: FrameworkBulkSave = {
      department_id: deptId,
      competencies: draft.competencies
        // A new competency that was also removed is a no-op — drop it.
        .filter((c) => !(c.is_deleted && c.key === null))
        .map((c, i) => ({
          key: c.key,
          label: c.label.trim(),
          is_reviewable: c.is_reviewable,
          display_order: i,
          is_deleted: c.is_deleted,
          cells: columns.map((col) => ({
            level: col === DEFAULT_CELL_KEY ? null : Number(col),
            expectation: c.cells[col] ?? null,
          })),
        })),
      designations: Object.entries(draft.designationLevels).map(([id, level]) => ({
        id: Number(id),
        level,
      })),
    };
    bulkSave.mutate(payload, {
      onSuccess: () => toast.success("Framework saved."),
      onError: (e) => snackbar.error(getErrorMessage(e)),
    });
  };

  const discard = () => {
    if (fw) {
      setDraft(buildDraft(fw));
      setDirty(false);
    }
  };

  const onSelectChange = async (value: string) => {
    if (value === selected) return;
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message:
          "Switching frameworks will discard the edits you haven't saved yet.",
        variant: "warning",
        confirmText: "Discard & switch",
      });
      if (!ok) return;
    }
    setSelected(value);
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
            <strong>Default</strong> set. Edits are staged locally — click{" "}
            <strong>Save</strong> to apply them all at once. Removing a competency
            is a soft-delete, so historical reviews keep the competencies they
            were written against.
          </p>
        </div>
      </div>

      {/* Toolbar — department picker + Save / Discard */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="fw-dept" className="text-sm font-medium text-text-main">
          Framework for
        </label>
        <select
          id="fw-dept"
          value={selected}
          onChange={(e) => onSelectChange(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
        >
          {departments.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
            </option>
          ))}
          <option value={DEFAULT_OPTION}>★ Default (fallback set)</option>
        </select>

        {fw && draft && (
          <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[11px] font-medium text-text-muted">
            {visible.length} {visible.length === 1 ? "competency" : "competencies"}
            {!isDefault && (
              <>
                {" · "}
                {columns.length} {columns.length === 1 ? "level" : "levels"}
              </>
            )}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {dirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            onClick={discard}
            disabled={!dirty || bulkSave.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || bulkSave.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkSave.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </div>

      {isLoading || !fw || !draft ? (
        <div className="flex items-center gap-2 py-10 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading framework…
        </div>
      ) : (
        <>
          {/* Default-set explainer */}
          {isDefault && (
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
          {!isDefault && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Roles → Levels
              </h3>
              <p className="mb-3 text-xs text-text-muted">
                Map each role in {selectedDeptName ?? "this department"} to a
                level. The matrix below shows one column per level in use.
              </p>
              {(fw.designations ?? []).length === 0 ? (
                <p className="text-sm italic text-text-muted">
                  No roles in this department yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {fw.designations.map((d) => (
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
                        value={draft.designationLevels[d.id] ?? ""}
                        placeholder="—"
                        onChange={(e) => setDesigLevel(d.id, e.target.value)}
                        className="w-14 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-main outline-none focus:border-brand"
                      />
                    </label>
                  ))}
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
                      {isDefault ? "Expectation" : `Level ${col}`}
                      {!isDefault && rolesByLevel[col] && (
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
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 3}
                      className="px-3 py-8 text-center text-sm italic text-text-muted"
                    >
                      No competencies yet. Add your first one below.
                    </td>
                  </tr>
                ) : (
                  visible.map((comp, i) => (
                    <tr
                      key={comp.uid}
                      className="group border-t border-border align-top hover:bg-surface-muted"
                    >
                      <td
                        className={`${STICKY_NUM_CLS} bg-surface px-2 py-2 text-xs text-text-muted group-hover:bg-surface-muted`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => moveComp(comp.uid, -1)}
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
                            disabled={i === visible.length - 1}
                            onClick={() => moveComp(comp.uid, 1)}
                            className="text-text-muted hover:text-text-main disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td
                        className={`${STICKY_COMP_CLS} bg-surface px-3 py-2 group-hover:bg-surface-muted`}
                      >
                        <input
                          value={comp.label}
                          onChange={(e) => patch(comp.uid, { label: e.target.value })}
                          placeholder="Competency name"
                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-text-main outline-none hover:border-border focus:border-brand"
                        />
                        <label className="mt-1 flex items-center gap-1.5 px-2 text-[11px] text-text-muted">
                          <input
                            type="checkbox"
                            checked={comp.is_reviewable}
                            onChange={(e) =>
                              patch(comp.uid, { is_reviewable: e.target.checked })
                            }
                            className="h-3.5 w-3.5 cursor-pointer accent-brand"
                          />
                          Reviewable (has a comment box)
                        </label>
                      </td>
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2">
                          <textarea
                            rows={3}
                            value={comp.cells[col] ?? ""}
                            onChange={(e) => setCell(comp.uid, col, e.target.value)}
                            placeholder="Expectation…"
                            className={TEXTAREA_CLS}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeComp(comp.uid)}
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

          {/* Add competency + add level (staged into the draft) */}
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
                disabled={!newLabel.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add competency
              </button>
            </div>

            {!isDefault && (
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
                    onKeyDown={(e) => e.key === "Enter" && addLevel()}
                    placeholder="e.g. 4"
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
                  />
                </div>
                <button
                  type="button"
                  onClick={addLevel}
                  disabled={!newLevel}
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
