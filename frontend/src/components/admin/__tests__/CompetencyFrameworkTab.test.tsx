/**
 * CompetencyFrameworkTab — renders the per-department matrix (competencies ×
 * levels) + role→level panel. This is a staged editor: edits accumulate in a
 * local draft and only hit the API (one bulk save) on Save. Query/mutation and
 * toast/snackbar/confirm hooks are mocked so no QueryClient/providers needed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { saveMutate } = vi.hoisted(() => ({ saveMutate: vi.fn() }));

const FW = {
  is_default: false,
  department_id: 1,
  levels: [2, 3],
  competencies: [
    {
      key: "task_execution",
      label: "Task Execution",
      is_reviewable: true,
      display_order: 1,
      cells: {
        "2": { competency_id: 10, expectation: "Level 2 expectation" },
        "3": { competency_id: 11, expectation: null },
      },
    },
  ],
  designations: [{ id: 5, name: "Analyst", level: 2, department_id: 1 }],
};

vi.mock("../../../queries/competencyFramework", () => ({
  frameworkQueryKey: () => ["fw"],
  useFramework: () => ({ data: FW, isLoading: false }),
  useBulkSaveFramework: () => ({ mutate: saveMutate, isPending: false }),
}));

vi.mock("../../../queries/adminReferenceData", () => ({
  useDepartments: () => ({ data: [{ id: 1, name: "IDT" }] }),
}));

vi.mock("../../../hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn() }),
}));
vi.mock("../../../hooks/useSnackbar", () => ({
  useSnackbar: () => ({ error: vi.fn() }),
}));
vi.mock("../../../hooks/useConfirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

import { CompetencyFrameworkTab } from "../CompetencyFrameworkTab";

void React;

beforeEach(() => saveMutate.mockReset());

describe("CompetencyFrameworkTab", () => {
  it("renders the matrix: competency, level columns, cells, and roles", () => {
    render(<CompetencyFrameworkTab />);
    expect(screen.getByDisplayValue("Task Execution")).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Level 2 expectation")).toBeInTheDocument();
    // role→level panel + the level-2 column subtitle both show the role
    expect(screen.getByText("Roles → Levels")).toBeInTheDocument();
    expect(screen.getAllByText("Analyst").length).toBeGreaterThan(0);
  });

  it("stages edits locally — nothing saves until Save", async () => {
    const user = userEvent.setup();
    render(<CompetencyFrameworkTab />);

    // Save starts disabled (no changes yet).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Adding a competency stages it — no API call.
    await user.type(
      screen.getByPlaceholderText(/Task Execution & Problem Solving/),
      "Ownership",
    );
    await user.click(screen.getByRole("button", { name: /Add competency/ }));
    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("saves the whole draft in one bulk call on Save", async () => {
    const user = userEvent.setup();
    render(<CompetencyFrameworkTab />);

    await user.type(
      screen.getByPlaceholderText(/Task Execution & Problem Solving/),
      "Ownership",
    );
    await user.click(screen.getByRole("button", { name: /Add competency/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveMutate).toHaveBeenCalledTimes(1);
    const payload = saveMutate.mock.calls[0][0];
    expect(payload.department_id).toBe(1);
    const labels = payload.competencies.map((c: { label: string }) => c.label);
    expect(labels).toContain("Task Execution");
    expect(labels).toContain("Ownership");
    // The new competency carries a null key (server assigns the slug); the
    // existing one keeps its key.
    const own = payload.competencies.find(
      (c: { label: string }) => c.label === "Ownership",
    );
    expect(own.key).toBeNull();
    const te = payload.competencies.find(
      (c: { label: string }) => c.label === "Task Execution",
    );
    expect(te.key).toBe("task_execution");
    // Each competency carries a cell per level column.
    expect(te.cells.map((c: { level: number }) => c.level).sort()).toEqual([2, 3]);
  });
});
