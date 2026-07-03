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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserResponse } from "../../../services/admin.service";

vi.mock("../../../queries/adminReferenceData", () => ({
  useDepartments: () => ({ data: [{ id: 1, name: "IDT" }] }),
  useDesignations: () => ({ data: [{ id: 10, name: "Consultant", level: 1 }] }),
}));
vi.mock("../../../services/project.service", () => ({
  projectService: {
    createProject: vi.fn(),
    getProjectDetail: vi.fn(),
    removeAssignment: vi.fn(),
    restoreAssignment: vi.fn(),
  },
}));
vi.mock("../../../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("../../../hooks/useSnackbar", () => ({ useSnackbar: () => ({ error: vi.fn() }) }));
vi.mock("../../common/UserCombobox", () => ({
  UserCombobox: ({ label }: { label: string }) => <div>{label}</div>,
}));

import { ProjectModal } from "../ProjectModal";
import { projectService } from "../../../services/project.service";

void React;

const mockProjectService = vi.mocked(projectService);

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
    await user.selectOptions(screen.getByLabelText("Practitioner"), "1");

    // Add a second card — it should be prepended (empty, on top).
    await user.click(screen.getByRole("button", { name: /add member/i }));

    const practitionerSelects = screen.getAllByLabelText("Practitioner") as HTMLSelectElement[];
    expect(practitionerSelects).toHaveLength(2);
    expect(practitionerSelects[0].value).toBe(""); // new empty card on top
    expect(practitionerSelects[1].value).toBe("1"); // previously filled card below
  });

  it("allows ticking two PMs but blocks save with an inline error", async () => {
    const user = userEvent.setup();
    renderModal();

    // Card 1 → User A as PM.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getByLabelText("Practitioner"), "1");
    await user.click(screen.getByLabelText(/is PM/i));

    // Card 2 (prepended) → User B as PM.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    const practitionerSelects = screen.getAllByLabelText("Practitioner") as HTMLSelectElement[];
    await user.selectOptions(practitionerSelects[0], "2");
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

describe("ProjectModal — multiple PM support", () => {
  it("swaps the member form to per-member PM + Secondary when enabled", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole("switch", { name: /enable multiple pm support/i }),
    );
    await user.click(screen.getByRole("button", { name: /add member/i }));

    // The per-row "is PM" checkbox is gone; per-member PM + Secondary pickers
    // take its place.
    expect(screen.queryByLabelText(/is PM/i)).toBeNull();
    expect(screen.getByLabelText("Project Manager")).toBeInTheDocument();
    expect(screen.getByLabelText("Secondary Evaluator")).toBeInTheDocument();
  });

  it("offers every user (except the picked practitioner) as the Project Manager", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole("switch", { name: /enable multiple pm support/i }),
    );
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getByLabelText("Practitioner"), "1");

    // Top PM dropdown lists all users, not just project members — User B is
    // offered even though they aren't on the team, while the practitioner
    // themselves (User A) is excluded.
    const pmSelect = screen.getByLabelText("Project Manager") as HTMLSelectElement;
    const optionValues = Array.from(pmSelect.options).map((o) => o.value);
    expect(optionValues).toContain("2");
    expect(optionValues).not.toContain("1");
  });

  it("keeps the is-PM checkbox in single-PM (default) mode", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: /add member/i }));
    expect(screen.getByLabelText(/is PM/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Project Manager")).toBeNull();
  });
});

describe("ProjectModal — removed members (edit flow)", () => {
  const assignment = (over: Record<string, unknown>) => ({
    id: 0,
    project_id: 5,
    user_id: 0,
    user_name: "",
    assignment_role: null,
    department_id: null,
    department_name: null,
    evaluator_type: null,
    assigned_date: null,
    created_at: "2026-01-01T00:00:00Z",
    is_deleted: false,
    removed_at: null,
    removed_by_name: null,
    ...over,
  });

  const detail = {
    id: 5,
    org_id: 1,
    project_code: "P-1",
    name: "Proj",
    description: "",
    start_date: null,
    expected_end_date: null,
    reports_to_id: null,
    reports_to_name: null,
    secondary_evaluator_id: null,
    secondary_evaluator_name: null,
    status: "active",
    completed_at: null,
    completed_by_id: null,
    completed_by_name: null,
    pm_id: null,
    pm_name: null,
    member_count: 1,
    is_deleted: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    assignments: [
      assignment({ id: 11, user_id: 1, user_name: "User A" }),
      assignment({
        id: 12,
        user_id: 2,
        user_name: "User B",
        is_deleted: true,
        removed_at: "2026-03-12T00:00:00Z",
        removed_by_name: "Amol",
      }),
    ],
  };

  function renderEdit() {
    render(
      <ProjectModal projectId={5} users={users} onClose={vi.fn()} onSave={vi.fn()} />,
    );
  }

  it("renders removed members greyed at the bottom with audit + Re-add", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProjectService.getProjectDetail.mockResolvedValue(detail as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProjectService.restoreAssignment.mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderEdit();

    expect(await screen.findByText("Removed members")).toBeInTheDocument();
    expect(screen.getByText("User B")).toBeInTheDocument();
    expect(screen.getByText(/Removed by Amol on/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /re-add/i }));
    expect(mockProjectService.restoreAssignment).toHaveBeenCalledWith(12);
    // Re-add refetches the detail (initial load + after restore).
    await waitFor(() => expect(mockProjectService.getProjectDetail).toHaveBeenCalledTimes(2));
  });

  it("makes a removed member selectable again in a new card", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProjectService.getProjectDetail.mockResolvedValue(detail as any);
    const user = userEvent.setup();
    renderEdit();
    await screen.findByText("Removed members");

    await user.click(screen.getByRole("button", { name: /add member/i }));
    const select = screen.getByLabelText("Practitioner") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // User B (removed) is re-addable; User A (active) is not offered.
    expect(optionValues).toContain("2");
    expect(optionValues).not.toContain("1");
  });
});
