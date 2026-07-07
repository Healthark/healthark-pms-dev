import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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
  "w-full min-w-[220px] rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand resize-y";

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

  const onErr = (e: unknown) => snackbar.error(getErrorMessage(e));

  const saveCell = (cell: FrameworkCell, value: string) => {
    if ((cell.expectation ?? "") === value) return;
    updateCell.mutate(
      { competencyId: cell.competency_id, expectation: value === "" ? null : value },
      { onError: onErr },
    );
  };

  const saveLabel = (comp: FrameworkCompetency, value: string) => {
    const v = value.trim();
    if (!v || v === comp.label) return;
    updateComp.mutate(
      { department_id: deptId, key: comp.key, label: v },
      { onError: onErr },
    );
  };

  const toggleReviewable = (comp: FrameworkCompetency, value: boolean) =>
    updateComp.mutate(
      { department_id: deptId, key: comp.key, is_reviewable: value },
      { onError: onErr },
    );

  const move = async (index: number, dir: -1 | 1) => {
    const comps = fw?.competencies ?? [];
    const other = comps[index + dir];
    const cur = comps[index];
    if (!other || !cur) return;
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
      onErr(e);
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
    deleteComp.mutate({ departmentId: deptId, key: comp.key }, { onError: onErr });
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
        onError: onErr,
      },
    );
  };

  const doAddLevel = () => {
    const lvl = Number(newLevel);
    if (deptId == null || !Number.isInteger(lvl) || lvl < 1 || lvl > 20) return;
    addLevel.mutate(
      { departmentId: deptId, level: lvl },
      {
        onSuccess: () => {
          setNewLevel("");
          toast.success(`Added level ${lvl}.`);
        },
        onError: onErr,
      },
    );
  };

  return (
    <div className="space-y-5">
      {/* Department selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="fw-dept" className="text-sm font-medium text-text-main">
          Department
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
          <option value={DEFAULT_OPTION}>Default (other departments)</option>
        </select>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
      </div>

      <p className="text-xs text-text-muted max-w-3xl">
        Competencies + expectations per department and level. Departments without
        their own framework use the <strong>Default</strong> set. Removing a
        competency is a soft-delete — historical reviews keep the competencies they
        were written against.
      </p>

      {isLoading || !fw ? (
        <div className="flex items-center gap-2 py-10 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading framework…
        </div>
      ) : (
        <>
          {/* Role → level mapping (departments only) */}
          {!fw.is_default && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-3">
                Roles → Levels
              </h3>
              {fw.designations.length === 0 ? (
                <p className="text-sm italic text-text-muted">
                  No roles in this department yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
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
                        defaultValue={d.level}
                        onBlur={(e) => {
                          const lvl = Number(e.target.value);
                          if (Number.isInteger(lvl) && lvl >= 1 && lvl <= 20 && lvl !== d.level) {
                            setDesigLevel.mutate(
                              { designationId: d.id, level: lvl },
                              { onError: onErr },
                            );
                          }
                        }}
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
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted w-8">
                    #
                  </th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted min-w-[220px]">
                    Competency
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted align-bottom"
                    >
                      {fw.is_default ? "Expectation" : `Level ${col}`}
                      {!fw.is_default && rolesByLevel[col] && (
                        <div className="font-normal normal-case text-[10px] text-text-muted/80 mt-0.5">
                          {rolesByLevel[col].join(", ")}
                        </div>
                      )}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {fw.competencies.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 3}
                      className="px-3 py-6 text-center text-sm italic text-text-muted"
                    >
                      No competencies yet. Add one below.
                    </td>
                  </tr>
                ) : (
                  fw.competencies.map((comp, i) => (
                    <tr key={comp.key} className="border-t border-border align-top">
                      <td className="px-3 py-2 text-xs text-text-muted">
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            className="text-text-muted hover:text-text-main disabled:opacity-30"
                            aria-label="Move up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={i === fw.competencies.length - 1}
                            onClick={() => move(i, 1)}
                            className="text-text-muted hover:text-text-main disabled:opacity-30"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          key={`${comp.key}-label`}
                          defaultValue={comp.label}
                          onBlur={(e) => saveLabel(comp, e.target.value)}
                          className="w-full rounded-md border border-transparent hover:border-border focus:border-brand bg-transparent px-2 py-1 text-sm font-medium text-text-main outline-none"
                        />
                        <label className="mt-1 flex items-center gap-1.5 px-2 text-[11px] text-text-muted">
                          <input
                            type="checkbox"
                            defaultChecked={comp.is_reviewable}
                            onChange={(e) => toggleReviewable(comp, e.target.checked)}
                          />
                          Reviewable (has a comment box)
                        </label>
                      </td>
                      {columns.map((col) => {
                        const cell = comp.cells[col];
                        return (
                          <td key={col} className="px-3 py-2">
                            {cell ? (
                              <textarea
                                key={cell.competency_id}
                                rows={3}
                                defaultValue={cell.expectation ?? ""}
                                onBlur={(e) => saveCell(cell, e.target.value)}
                                placeholder="Expectation…"
                                className={TEXTAREA_CLS}
                              />
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
          <div className="flex flex-wrap items-end gap-4">
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
