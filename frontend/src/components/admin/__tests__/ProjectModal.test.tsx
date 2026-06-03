/**
 * Tests for the ProjectModal create flow:
 *   - a new member card is prepended (appears on top),
 *   - more than one PM can be ticked but saving is blocked with an inline error.
 *
 * The reference-data hooks, project service, toast/snackbar, and UserCombobox
 * are mocked so the test drives just the team-member card logic.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserResponse } from "../../../services/admin.service";

vi.mock("../../../queries/adminReferenceData", () => ({
  useDepartments: () => ({ data: [{ id: 1, name: "IDT" }] }),
  useDesignations: () => ({ data: [{ id: 10, name: "Consultant", level: 1 }] }),
}));
vi.mock("../../../services/project.service", () => ({
  projectService: { createProject: vi.fn(), getProjectDetail: vi.fn() },
}));
vi.mock("../../../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("../../../hooks/useSnackbar", () => ({ useSnackbar: () => ({ error: vi.fn() }) }));
vi.mock("../../common/UserCombobox", () => ({
  UserCombobox: ({ label }: { label: string }) => <div>{label}</div>,
}));

import { ProjectModal } from "../ProjectModal";

void React;

const users = [
  { id: 1, full_name: "User A", department_id: 1, designation: { id: 10, name: "Consultant", level: 1 }, is_deleted: false },
  { id: 2, full_name: "User B", department_id: 1, designation: { id: 10, name: "Consultant", level: 1 }, is_deleted: false },
] as unknown as UserResponse[];

function renderModal() {
  render(
    <ProjectModal projectId={null} users={users} onClose={vi.fn()} onSave={vi.fn()} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("ProjectModal — team members", () => {
  it("prepends a newly added member card to the top", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /add member/i }));
    // Fill the first card with User A.
    await user.selectOptions(screen.getByLabelText("Employee"), "1");

    // Add a second card — it should be prepended (empty, on top).
    await user.click(screen.getByRole("button", { name: /add member/i }));

    const employeeSelects = screen.getAllByLabelText("Employee") as HTMLSelectElement[];
    expect(employeeSelects).toHaveLength(2);
    expect(employeeSelects[0].value).toBe(""); // new empty card on top
    expect(employeeSelects[1].value).toBe("1"); // previously filled card below
  });

  it("allows ticking two PMs but blocks save with an inline error", async () => {
    const user = userEvent.setup();
    renderModal();

    // Card 1 → User A as PM.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getByLabelText("Employee"), "1");
    await user.click(screen.getByLabelText(/is PM/i));

    // Card 2 (prepended) → User B as PM.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    const employeeSelects = screen.getAllByLabelText("Employee") as HTMLSelectElement[];
    await user.selectOptions(employeeSelects[0], "2");
    const pmChecks = screen.getAllByLabelText(/is PM/i);
    await user.click(pmChecks[0]);

    // Two PMs → inline error + Create disabled.
    expect(screen.getByText(/more than 1 PM/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create project/i })).toBeDisabled();

    // Clear one PM → the inline error goes away.
    await user.click(screen.getAllByLabelText(/is PM/i)[0]);
    expect(screen.queryByText(/more than 1 PM/i)).not.toBeInTheDocument();
  });
});
