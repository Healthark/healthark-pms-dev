/**
 * projectCodeIndex — pairs a project's code with its name so a "Project Code"
 * filter can stay in lock-step with the existing "Project" (name) filter.
 *
 * The project-review filters key their row matching on `project_name`, so the
 * name filter stays the single source of truth. The Project Code dropdown is a
 * synced view onto it: selecting a code resolves to its project name (and the
 * code dropdown's displayed value is derived back from the selected name), so
 * the two can never diverge. Project codes are unique; names are treated as
 * unique too (matching the existing name-keyed filtering).
 */

export interface ProjectLite {
  readonly project_name: string;
  readonly project_code: string;
}

export interface ProjectCodeIndex {
  /** Sorted unique project codes — the Project Code dropdown options. */
  readonly codes: string[];
  /** code → project name (drives the synced name filter when a code is picked). */
  readonly codeToName: Map<string, string>;
  /** project name → code (drives the code dropdown's displayed value). */
  readonly nameToCode: Map<string, string>;
}

export function buildProjectCodeIndex(
  items: readonly ProjectLite[],
): ProjectCodeIndex {
  const codeToName = new Map<string, string>();
  const nameToCode = new Map<string, string>();
  for (const { project_name, project_code } of items) {
    if (project_code && !codeToName.has(project_code)) {
      codeToName.set(project_code, project_name);
    }
    if (project_name && !nameToCode.has(project_name)) {
      nameToCode.set(project_name, project_code);
    }
  }
  // Natural sort so "PR-2" precedes "PR-10" (matches the project_code table sort).
  const codes = Array.from(codeToName.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return { codes, codeToName, nameToCode };
}
