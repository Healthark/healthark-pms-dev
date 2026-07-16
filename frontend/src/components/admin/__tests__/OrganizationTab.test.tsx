/**
 * OrganizationTab — renders the department/role accordion and performs staged
 * CRUD via mutation hooks. Query/mutation and toast/snackbar/confirm hooks are
 * mocked so no QueryClient/router/providers are needed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { createDept, deactivateDept } = vi.hoisted(() => ({
  createDept: vi.fn(),
  deactivateDept: vi.fn(),
}));

const STRUCT = {
  departments: [
    {
      id: 1,
      name: "Accounts",
      is_active: true,
      active_user_count: 2,
      designations: [
        { id: 10, name: "Executive", level: 1, department_id: 1, is_active: true, active_user_count: 2 },
        { id: 11, name: "Retired Role", level: 3, department_id: 1, is_active: false, active_user_count: 0 },
      ],
    },
  ],
  unscoped_designations: [],
};

vi.mock("../../../queries/orgStructure", () => ({
  useOrgStructure: () => ({ data: STRUCT, isLoading: false, isError: false }),
  useCreateDepartment: () => ({ mutate: createDept, isPending: false }),
  useRenameDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateDepartment: () => ({ mutate: deactivateDept, isPending: false }),
  useReactivateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateDesignation: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameDesignation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateDesignation: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateDesignation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("../../../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn(), info: vi.fn() }) }));
vi.mock("../../../hooks/useSnackbar", () => ({ useSnackbar: () => ({ error: vi.fn() }) }));
vi.mock("../../../hooks/useConfirm", () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

import { OrganizationTab } from "../OrganizationTab";

void React;

beforeEach(() => {
  createDept.mockReset();
  deactivateDept.mockReset();
});

describe("OrganizationTab", () => {
  it("renders departments and reveals roles (with a read-only level badge) on expand", async () => {
    const user = userEvent.setup();
    render(<OrganizationTab />);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    // Roles are collapsed until the department is expanded.
    expect(screen.queryByText("Executive")).not.toBeInTheDocument();
    await user.click(screen.getByText("Accounts"));
    expect(screen.getByText("Executive")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
  });

  it("stages a new department via the create mutation", async () => {
    const user = userEvent.setup();
    render(<OrganizationTab />);
    await user.type(screen.getByPlaceholderText(/New department name/), "Operations");
    await user.click(screen.getByRole("button", { name: /Add department/ }));
    expect(createDept).toHaveBeenCalledTimes(1);
    expect(createDept.mock.calls[0][0]).toBe("Operations");
  });

  it("confirms before deactivating a department, then calls the mutation", async () => {
    const user = userEvent.setup();
    render(<OrganizationTab />);
    await user.click(screen.getByLabelText("Deactivate department"));
    await waitFor(() => expect(deactivateDept).toHaveBeenCalledWith(1, expect.anything()));
  });

  it("keeps the header role count in sync with the visible list under Show inactive", async () => {
    const user = userEvent.setup();
    render(<OrganizationTab />);
    await user.click(screen.getByText("Accounts"));
    // Default: inactive roles hidden → count = active roles, list shows only them.
    expect(screen.getByText(/\(1 role\)/)).toBeInTheDocument();
    expect(screen.queryByText("Retired Role")).not.toBeInTheDocument();
    // Reveal inactive → count and list both grow to include it.
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText(/\(2 roles\)/)).toBeInTheDocument();
    expect(screen.getByText("Retired Role")).toBeInTheDocument();
  });
});
