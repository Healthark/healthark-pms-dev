/**
 * Tests for the Goal Mentor Review modal — focused on the role-expectation
 * reference. It must render the shared RoleExpectationsCard (same card as the
 * Annual Goals page), scoped to the *mentee* (goal owner's) department ×
 * designation, titled "Mentee Role Expectations".
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamGoal } from "../../../services/goal.service";

// Heavy deps — stub the detail fetch, settings, and the org-expectations fetch.
vi.mock("../../../queries/goals", () => ({
  useGoalDetail: () => ({ data: undefined, isPending: false, fetchStatus: "idle" }),
}));
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({
    settings: { cycle_type: "half_yearly", active_cycle_name: "FY26-27" },
  }),
}));
vi.mock("../../../services/project-review.service", () => ({
  projectReviewService: {
    getRoleExpectations: vi.fn().mockResolvedValue([
      {
        id: 1,
        department_name: "Engineering",
        designation_name: "Senior Analyst",
        exp_firm_growth: "Own a workstream | Mentor one junior",
        exp_competency_skills: "Deepen SQL | Learn React",
      },
      {
        id: 2,
        department_name: "Design",
        designation_name: "Lead",
        exp_firm_growth: "WRONG ROLE — should not show",
        exp_competency_skills: "WRONG ROLE — should not show",
      },
    ]),
  },
}));

import { GoalMentorReviewModal } from "../GoalMentorReviewModal";

void React;

const goal = {
  id: 1,
  title: "Ship the new dashboard",
  fy_year: 2026,
  owner_name: "Asha Mentee",
  owner_department_name: "Engineering",
  owner_designation_name: "Senior Analyst",
  self_reviews: [],
  mentor_reviews: [],
} as unknown as TeamGoal;

function renderModal() {
  render(
    <GoalMentorReviewModal
      isOpen
      goal={goal}
      cycleHalf="H1"
      onClose={vi.fn()}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onSaveDraft={vi.fn().mockResolvedValue(undefined)}
      isSaving={false}
      isDraftSaving={false}
      error=""
    />,
  );
}

describe("GoalMentorReviewModal — role expectations card", () => {
  it("renders the shared card titled 'Mentee Role Expectations'", async () => {
    renderModal();
    // The org-expectations fetch resolves async, then the card appears.
    expect(
      await screen.findByRole("button", { name: /mentee role expectations/i }),
    ).toBeInTheDocument();
  });

  it("labels the mentor's panel 'Mentor Review' (not 'Your Review')", () => {
    renderModal();
    // The right-hand panel header reads "Mentor Review" exactly.
    expect(screen.getByText("Mentor Review")).toBeInTheDocument();
    // The old heading/label wording is gone (exact match, so it ignores the
    // "…draft your review now…" helper sentence, which is intentionally kept).
    expect(screen.queryByText("Your Review")).not.toBeInTheDocument();
  });

  it("expands to show the mentee's (goal owner's) expectations, bullet-formatted", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(
      await screen.findByRole("button", { name: /mentee role expectations/i }),
    );

    expect(screen.getByText("Firm Growth")).toBeInTheDocument();
    expect(screen.getByText("Competency & Skills")).toBeInTheDocument();
    // " | " is rendered as a bullet line.
    expect(
      screen.getByText(/Own a workstream\s*•\s*Mentor one junior/),
    ).toBeInTheDocument();
    // Scoped to the mentee's role, not some other row.
    expect(screen.getByText("Engineering · Senior Analyst")).toBeInTheDocument();
    expect(screen.queryByText(/WRONG ROLE/)).not.toBeInTheDocument();
  });
});
