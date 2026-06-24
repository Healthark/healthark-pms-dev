/**
 * Tests for the Management Review grid's Year filter.
 *
 * The grid's data/query hooks and the settings/confirm/debounce hooks are
 * mocked so we can assert just the year behavior: the dropdown defaults to the
 * active cycle's FY, exposes an "All" option, drives the server query's `year`
 * param, and the table renders a Year column.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalibrationQuery } from "../../../services/annual-review.service";

const gridCalls: CalibrationQuery[] = [];

const filterOptions = {
  employees: ["Current Emp"],
  departments: ["RWE"],
  designations: ["Consultant"],
  mentors: ["Manager"],
  years: ["FY26-27", "FY25-26"],
  active_year: "FY26-27",
};

const gridData = {
  items: [
    {
      review_id: 1,
      user_id: 1,
      cycle_name: "FY26-27",
      employee_name: "Current Emp",
      employee_email: "current@example.com",
      mentor_name: "Manager",
      department: "RWE",
      designation: "Consultant",
      self_performance_rating: 2,
      mentor_performance_rating: 2,
      management_performance_rating: null,
      final_performance_rating: null,
      status: "pending_management",
      final_rating_enabled: false,
    },
  ],
  total: 1,
  page: 1,
  per_page: 25,
};

vi.mock("../../../queries/annualReviews", () => ({
  useCalibrationGrid: (params: CalibrationQuery) => {
    gridCalls.push(params);
    return { data: gridData, isLoading: false, isFetching: false, error: null };
  },
  useCalibrationFilterOptions: () => ({ data: filterOptions }),
  useSetManagementRating: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAnnualReviewDetail: () => ({ data: null, error: null }),
}));
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({
    settings: { active_cycle_name: "H1 FY26-27", management_review_enabled: true },
    isLoading: false,
  }),
}));
vi.mock("../../../hooks/useConfirm", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../hooks/useDebounce", () => ({
  useDebounce: (fn: (v: string) => void) => [fn],
}));

import { ManagementReviewTab } from "../ManagementReviewTab";

void React;

describe("ManagementReviewTab — Year filter", () => {
  beforeEach(() => {
    gridCalls.length = 0;
  });

  it("defaults the Year dropdown to the active cycle's FY", () => {
    render(<ManagementReviewTab />);
    const yearSelect = screen.getByLabelText("Year") as HTMLSelectElement;
    expect(yearSelect.value).toBe("FY26-27");
    // The active year renders as a human label and an "All" option exists.
    expect(within(yearSelect).getByRole("option", { name: "FY 2026-27" })).toBeInTheDocument();
    expect(within(yearSelect).getByRole("option", { name: "All" })).toBeInTheDocument();
    // The grid was queried for the active year by default.
    expect(gridCalls.at(-1)?.year).toBe("FY26-27");
  });

  it("renders a Year column with the row's fiscal year", () => {
    render(<ManagementReviewTab />);
    expect(screen.getByRole("columnheader", { name: "Year" })).toBeInTheDocument();
    // The row's cycle_name shows formatted in the table body.
    const table = screen.getByRole("table");
    expect(within(table).getByText("FY 2026-27")).toBeInTheDocument();
  });

  it("queries year='all' when All is selected", async () => {
    const user = userEvent.setup();
    render(<ManagementReviewTab />);
    await user.selectOptions(screen.getByLabelText("Year"), "all");
    expect(gridCalls.at(-1)?.year).toBe("all");
  });

  it("queries a past year when selected", async () => {
    const user = userEvent.setup();
    render(<ManagementReviewTab />);
    await user.selectOptions(screen.getByLabelText("Year"), "FY25-26");
    expect(gridCalls.at(-1)?.year).toBe("FY25-26");
  });
});
