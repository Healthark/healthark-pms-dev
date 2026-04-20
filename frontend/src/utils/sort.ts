/**
 * sort.ts — Type-aware comparators for table column sorting.
 *
 * Kinds:
 *   - "alpha"    → case-insensitive string compare. Use for pure alpha labels
 *                  (Project, PM, Employee, Department).
 *   - "natural"  → Intl.Collator with numeric=true, so "PRJ-9" < "PRJ-10" and
 *                  "H1 FY25" < "H1 FY26". Use for mixed alphanumeric keys
 *                  (project codes, cycle labels, version strings).
 *   - "numeric"  → parseFloat then numeric compare. Use for Rating columns
 *                  (values are "1".."5" strings from the API but sort as ints).
 *
 * Nulls always sort to the end of the list regardless of direction, so a column
 * with missing values never breaks the rhythm of the sorted region.
 */

export type SortDirection = "asc" | "desc";
export type SortKind = "alpha" | "natural" | "numeric";

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Compare two values for a given column kind + direction.
 * Null / undefined / "" values always sort to the bottom (independent of direction).
 */
export function compareValues(
  a: unknown,
  b: unknown,
  kind: SortKind,
  direction: SortDirection,
): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let cmp: number;
  if (kind === "numeric") {
    const na = Number(a);
    const nb = Number(b);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (!aNum && !bNum) cmp = 0;
    else if (!aNum) cmp = 1;
    else if (!bNum) cmp = -1;
    else cmp = na - nb;
  } else if (kind === "natural") {
    cmp = NATURAL_COLLATOR.compare(String(a), String(b));
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  }

  return direction === "asc" ? cmp : -cmp;
}

/**
 * Toggle sort state. If the clicked column matches the current key, flip direction;
 * otherwise switch to the new column with ascending direction.
 */
export function toggleSort<K extends string>(
  current: SortState<K> | null,
  key: K,
): SortState<K> {
  if (current && current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}
