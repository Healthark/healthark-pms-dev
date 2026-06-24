/**
 * Tests for the Annual Goals self-review modal — focused on the "Save Draft"
 * gate: the action stays disabled until the user types the first character
 * in the reflection field, then becomes clickable and fires onSaveDraft.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Goal } from "../../../services/goal.service";

// The modal reads org cycle settings and fetches role expectations on open;
// stub both so it renders in isolation (panels are non-fatal when absent).
vi.mock("../../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({ settings: { cycle_type: "half_yearly" } }),
}));
vi.mock("../../../services/profile.service", () => ({
  profileService: { getMyExpectations: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../../services/project-review.service", () => ({
  projectReviewService: { getRoleExpectations: vi.fn().mockResolvedValue([]) },
}));

import { GoalSelfReviewModal } from "../GoalSelfReviewModal";

void React;

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    org_id: 1,
    user_id: 1,
    manager_id: null,
    manager_name: null,
    title: "Ship the new dashboard",
    description: null,
    attachment_url: null,
    goal_type: "individual",
    cycle_name: "FY26-27",
    fy_year: 2026,
    approval_status: "approved",
    manager_feedback: null,
    progress_notes: null,
    start_date: null,
    due_date: null,
    approved_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    criteria: [],
    progress_percent: 0,
    self_reviews: [],
    mentor_reviews: [],
    ...overrides,
  } as unknown as Goal;
}

function renderModal(goalOverrides: Partial<Goal> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onSaveDraft = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <GoalSelfReviewModal
      isOpen
      goal={makeGoal(goalOverrides)}
      cycleHalf="H1"
      onClose={onClose}
      onSubmit={onSubmit}
      onSaveDraft={onSaveDraft}
      isSaving={false}
      isDraftSaving={false}
      error=""
    />,
  );
  return { onSubmit, onSaveDraft, onClose };
}

const draftBtn = () => screen.getByRole("button", { name: /save draft/i });
const reviewField = () =>
  screen.getByPlaceholderText(/reflect on your delivery this half/i);

describe("GoalSelfReviewModal — Save Draft gate", () => {
  it("disables Save Draft on open when the reflection is empty", () => {
    renderModal();
    expect(draftBtn()).toBeDisabled();
  });

  it("keeps Save Draft disabled for whitespace-only input", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(reviewField(), "   ");
    expect(draftBtn()).toBeDisabled();
  });

  it("enables Save Draft once the first character is typed", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(draftBtn()).toBeDisabled();
    await user.type(reviewField(), "D");
    expect(draftBtn()).toBeEnabled();
  });

  it("fires onSaveDraft with the half and typed content when clicked", async () => {
    const user = userEvent.setup();
    const { onSaveDraft } = renderModal();
    await user.type(reviewField(), "Delivered on time.");
    await user.click(draftBtn());
    expect(onSaveDraft).toHaveBeenCalledWith("H1", {
      self_overall_review: "Delivered on time.",
    });
  });

  it("enables Save Draft immediately when an existing draft has content", () => {
    renderModal({
      self_reviews: [
        {
          cycle_half: "H1",
          self_overall_review: "Prior draft text",
          is_draft: true,
        },
      ] as unknown as Goal["self_reviews"],
    });
    expect(draftBtn()).toBeEnabled();
  });
});
