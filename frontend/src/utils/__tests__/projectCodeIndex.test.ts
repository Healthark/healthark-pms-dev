import { describe, it, expect } from "vitest";

import { buildProjectCodeIndex } from "../projectCodeIndex";

const rows = [
  { project_name: "Acme Migration", project_code: "PR-2" },
  { project_name: "Beta Rollout", project_code: "PR-10" },
  { project_name: "Acme Migration", project_code: "PR-2" }, // duplicate row
];

describe("buildProjectCodeIndex", () => {
  it("lists unique codes in natural (numeric-aware) order", () => {
    const { codes } = buildProjectCodeIndex(rows);
    expect(codes).toEqual(["PR-2", "PR-10"]); // not lexicographic "PR-10" < "PR-2"
  });

  it("maps code → name and name → code both ways", () => {
    const { codeToName, nameToCode } = buildProjectCodeIndex(rows);
    expect(codeToName.get("PR-2")).toBe("Acme Migration");
    expect(codeToName.get("PR-10")).toBe("Beta Rollout");
    expect(nameToCode.get("Beta Rollout")).toBe("PR-10");
  });

  it("ignores blank codes/names and is empty for no input", () => {
    const idx = buildProjectCodeIndex([
      { project_name: "", project_code: "" },
      { project_name: "X", project_code: "" },
    ]);
    expect(idx.codes).toEqual([]);
    expect(idx.nameToCode.get("X")).toBe("");
  });
});
