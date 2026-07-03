/**
 * Tests for the Admin "Projects" tab after the server-side pagination port.
 *
 * The data hooks (useAdminProjects, useProjectsFilterOptions, the lifecycle
 * mutations), useUsers, the query client and the toast/snackbar/confirm/
 * system-settings hooks are mocked so we can assert the wiring in isolation:
 * the tab renders the server page's `items`, fills the Year/PM dropdowns from
 * filter-options, drives TablePagination off the server `total`, and pushes a
 * debounced `search` into the query object.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectQuery } from "../../../services/project.service";

const useAdminProjectsMock = vi.fn();
// Mutable page state so individual tests can swap in their own project rows
// (reset to PAGE in beforeEach).
const projectsState = vi.hoisted(() => ({ data: null as unknown }));

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    org_id: 1,
    project_code: "P-0001",
    name: "Apollo",
    description: null,
    start_date: "2026-01-01",
    expected_end_date: null,
    reports_to_id: null,
    reports_to_name: "Dana Lead",
    pm_id: 5,
    pm_name: "Alice",
    secondary_evaluator_id: null,
    secondary_evaluator_name: null,
    status: "active",
    completed_at: null,
    completed_by_name: null,
    is_deleted: false,
    multi_pm_enabled: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    member_count: 3,
    ...overrides,
  };
}

const PAGE = {
  items: [
    makeProject({ id: 1, name: "Apollo", project_code: "P-0001" }),
    makeProject({ id: 2, name: "Borealis", project_code: "P-0002", pm_name: "Bob" }),
  ],
  total: 42,
  page: 1,
  per_page: 25,
};

vi.mock("../../../queries/adminProjects", () => ({
  adminProjectsQueryKey: ["admin", "projects"],
  useAdminProjects: (q: ProjectQuery) => {
    useAdminProjectsMock(q);
    return { data: projectsState.data, isLoading: false, isFetching: false };
  },
  useProjectsFilterOptions: () => ({
    data: { years: [2026, 2025], pms: ["Alice", "Bob"] },
  }),
  useDeleteProject: () => ({ mutateAsync: vi.fn() }),
  useMarkProjectComplete: () => ({ mutateAsync: vi.fn() }),
  useReopenProject: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
const coverageState = vi.hoisted(() => ({
  data: { orphaned_mentees: [] as { id: number; name: string }[], pm_less_projects: [] as { id: number; name: string }[] },
}));
vi.mock("../../../queries/adminSettings", () => ({
  coverageGapsQueryKey: ["admin", "coverage-gaps"],
  useCoverageGaps: () => ({ data: coverageState.data }),
}));
vi.mock("../../../queries/users", () => ({
  useUsers: () => ({ data: [], isLoading: false }),
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
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({ settings: undefined }),
}));
vi.mock("../../../services/export.service", () => ({
  exportService: { downloadProjects: vi.fn() },
}));
// ExportExcelButton pulls in useAuth (needs AuthProvider); stub it — the
// export flow isn't under test here.
vi.mock("../../exports/ExportExcelButton", () => ({
  ExportExcelButton: () => null,
}));

import { ProjectsTab } from "../ProjectsTab";

void React;

beforeEach(() => {
  vi.clearAllMocks();
  coverageState.data = { orphaned_mentees: [], pm_less_projects: [] };
  projectsState.data = PAGE;
});

describe("ProjectsTab — server-side pagination", () => {
  it("renders the rows from the server page's items", () => {
    render(<ProjectsTab />);
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("Borealis")).toBeInTheDocument();
    expect(screen.getByText("P-0001")).toBeInTheDocument();
  });

  it("fills the Year and PM dropdowns from filter-options", () => {
    render(<ProjectsTab />);
    const yearSelect = screen.getByLabelText(/start year/i);
    expect(within(yearSelect).getByRole("option", { name: "2026" })).toBeInTheDocument();
    expect(within(yearSelect).getByRole("option", { name: "2025" })).toBeInTheDocument();

    const pmSelect = screen.getByLabelText("PM");
    expect(within(pmSelect).getByRole("option", { name: "Alice" })).toBeInTheDocument();
    expect(within(pmSelect).getByRole("option", { name: "Bob" })).toBeInTheDocument();
  });

  it("drives the pagination bar off the server total, not the page length", () => {
    render(<ProjectsTab />);
    // total=42, per_page=25 → 2 pages, even though only 2 rows are present.
    expect(screen.getByText("42 Records")).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it("requests page 1 with a 25-row default and the 'all' status", () => {
    render(<ProjectsTab />);
    expect(useAdminProjectsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 25, status: "all" }),
    );
  });

  it("pushes a debounced search term into the query object", async () => {
    const user = userEvent.setup();
    render(<ProjectsTab />);

    await user.type(screen.getByLabelText(/search projects/i), "apollo");

    await waitFor(
      () =>
        expect(useAdminProjectsMock).toHaveBeenCalledWith(
          expect.objectContaining({ search: "apollo", page: 1 }),
        ),
      { timeout: 1000 },
    );
  });

  it("highlights a PM-less project row amber, leaving covered rows plain", () => {
    coverageState.data = {
      orphaned_mentees: [],
      pm_less_projects: [{ id: 2, name: "Borealis" }], // Borealis is PM-less
    };
    render(<ProjectsTab />);

    // The affected row carries the warning title + amber background.
    const flagged = screen.getByTitle(/no PM/i);
    expect(flagged).toHaveTextContent("Borealis");
    expect(flagged.className).toMatch(/bg-red/);

    // Apollo (id 1) is covered → no warning title on its row.
    const apolloRow = screen.getByText("Apollo").closest("tr");
    expect(apolloRow?.getAttribute("title")).toBeFalsy();
    expect(apolloRow?.className).not.toMatch(/bg-red/);
  });

  it("shows an italic '(Multiple PM)' note in the PM column for multi-PM projects", () => {
    projectsState.data = {
      items: [
        makeProject({ id: 1, name: "Apollo", pm_name: "Alice" }),
        makeProject({
          id: 2,
          name: "Borealis",
          multi_pm_enabled: true,
          pm_name: "Ignored", // a single pm_name is meaningless in multi-PM
        }),
      ],
      total: 2,
      page: 1,
      per_page: 25,
    };
    render(<ProjectsTab />);

    // Single-PM project shows the resolved PM name in its row… ("Alice" also
    // appears as a PM-filter option, so scope the assertion to the row).
    const apolloRow = screen.getByText("Apollo").closest("tr") as HTMLElement;
    expect(within(apolloRow).getByText("Alice")).toBeInTheDocument();
    // …the multi-PM project shows the note instead of its (meaningless) pm_name.
    const borealisRow = screen.getByText("Borealis").closest("tr") as HTMLElement;
    const note = within(borealisRow).getByText("(Multiple PM)");
    expect(note).toBeInTheDocument();
    expect(note.className).toMatch(/italic/);
    expect(within(borealisRow).queryByText("Ignored")).not.toBeInTheDocument();
  });
});
