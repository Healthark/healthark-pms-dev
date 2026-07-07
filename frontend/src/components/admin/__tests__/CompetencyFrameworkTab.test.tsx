/**
 * CompetencyFrameworkTab — renders the per-department matrix (competencies ×
 * levels) + role→level panel, and adds a competency. Query/mutation and
 * toast/snackbar/confirm hooks are mocked so no QueryClient/providers needed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { createMutate } = vi.hoisted(() => ({ createMutate: vi.fn() }));

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
  useCreateCompetency: () => ({ mutate: createMutate, isPending: false }),
  useUpdateCompetency: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteCompetency: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCell: () => ({ mutate: vi.fn(), isPending: false }),
  useAddLevel: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDesignationLevel: () => ({ mutate: vi.fn(), isPending: false }),
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

beforeEach(() => createMutate.mockReset());

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

  it("adds a competency via the create mutation", async () => {
    const user = userEvent.setup();
    render(<CompetencyFrameworkTab />);
    await user.type(
      screen.getByPlaceholderText(/Task Execution & Problem Solving/),
      "Ownership",
    );
    await user.click(screen.getByRole("button", { name: /Add competency/ }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      departmentId: 1,
      label: "Ownership",
      isReviewable: true,
    });
  });
});
