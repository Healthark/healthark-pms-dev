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
  // Interactive stub: clicking sets the value to user 99 (an off-team senior),
  // so tests can satisfy the required "PM Reports To" field.
  UserCombobox: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (v: number | null) => void;
  }) => (
    <button type="button" onClick={() => onChange(99)}>
      {label}
    </button>
  ),
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

  it("keeps Create clickable in multi-PM mode and shows inline guidance until a member is added", async () => {
    const user = userEvent.setup();
    renderModal();

    // Satisfy the universal required fields so the ONLY outstanding issue is
    // the multi-PM team.
    await user.type(screen.getByLabelText(/project code/i), "PRJ-9");
    await user.type(screen.getByLabelText(/project name/i), "Multi Proj");
    await user.click(screen.getByRole("button", { name: "PM Reports To" }));

    await user.click(
      screen.getByRole("switch", { name: /enable multiple pm support/i }),
    );

    // No members yet → inline guidance, but the button is NOT disabled — it
    // stays clickable (the fix for the silently-greyed button).
    expect(screen.getByText(/add at least one team member/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create project/i }),
    ).toBeEnabled();

    // Add a member → guidance clears, button still clickable.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getByLabelText("Practitioner"), "1");
    expect(
      screen.queryByText(/add at least one team member/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create project/i }),
    ).toBeEnabled();
  });

  it("allows multiple same-level top PMs (no single-Top-PM constraint)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProjectService.createProject.mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/project code/i), "PRJ-9");
    await user.type(screen.getByLabelText(/project name/i), "Multi Proj");
    await user.click(screen.getByRole("button", { name: "PM Reports To" }));
    await user.click(
      screen.getByRole("switch", { name: /enable multiple pm support/i }),
    );

    // Two members, BOTH left as top-level PMs (no Project Manager). This used
    // to be blocked by the "exactly one top PM" rule; it's now valid.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getAllByLabelText("Practitioner")[0], "1");
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getAllByLabelText("Practitioner")[0], "2");

    // No structural error, button enabled, and Create actually POSTs both
    // top-level PMs.
    expect(screen.queryByText(/top PM/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() =>
      expect(mockProjectService.createProject).toHaveBeenCalledTimes(1),
    );
    const payload = mockProjectService.createProject.mock.calls[0][0];
    // Both members submitted with no manager (manager_id null = top-level PM).
    expect(payload.assignments).toHaveLength(2);
    expect(payload.assignments.every((a) => a.manager_id == null)).toBe(true);
  });

  it("submits a valid multi-PM hierarchy (one top PM, the rest managed)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockProjectService.createProject.mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/project code/i), "PRJ-9");
    await user.type(screen.getByLabelText(/project name/i), "Multi Proj");
    await user.click(screen.getByRole("button", { name: "PM Reports To" }));
    await user.click(
      screen.getByRole("switch", { name: /enable multiple pm support/i }),
    );

    // User A = top PM (no manager); User B reports to User A.
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getAllByLabelText("Practitioner")[0], "1");
    await user.click(screen.getByRole("button", { name: /add member/i }));
    await user.selectOptions(screen.getAllByLabelText("Practitioner")[0], "2");
    await user.selectOptions(screen.getAllByLabelText("Project Manager")[0], "1");

    // No structural error, and Create actually POSTs.
    expect(screen.queryByText(/exactly one top PM/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() =>
      expect(mockProjectService.createProject).toHaveBeenCalledTimes(1),
    );
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
