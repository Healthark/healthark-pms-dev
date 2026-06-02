/**
 * Tests for the PR 2 "Remind" button on an approved team goal.
 *
 * SelfReviewCycleMenu pulls in useSystemSettings / useToday (which need
 * context providers) and is irrelevant here, so it's stubbed — the card then
 * renders standalone and we can assert the Remind affordance.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamGoal } from "../../../services/goal.service";

vi.mock("../SelfReviewCycleMenu", () => ({
  SelfReviewCycleMenu: () => <div data-testid="cycle-menu" />,
}));
// ApprovalStatusBadge reads useSystemSettings (needs a provider) — stub it.
vi.mock("../ApprovalStatusBadge", () => ({
  ApprovalStatusBadge: () => <div data-testid="status-badge" />,
}));

import { TeamGoalCard } from "../TeamGoalCard";

void React;

const approvedGoal = {
  id: 7,
  owner_name: "Mentee E",
  title: "Improve X",
  approval_status: "approved",
  fy_year: 2026,
} as unknown as TeamGoal;

function baseProps() {
  return {
    goal: approvedGoal,
    onApprove: vi.fn(),
    onRequestChanges: vi.fn(),
    onSelectHalf: vi.fn(),
    isActing: false,
    statusViewerRole: "mentor" as const,
  };
}

describe("TeamGoalCard — Remind button", () => {
  it("shows Remind for an approved goal and calls onRemind on click", async () => {
    const user = userEvent.setup();
    const onRemind = vi.fn();
    render(<TeamGoalCard {...baseProps()} onRemind={onRemind} />);
    await user.click(screen.getByRole("button", { name: /self-review reminder/i }));
    expect(onRemind).toHaveBeenCalledWith(approvedGoal);
  });

  it("omits Remind when onRemind is not provided", () => {
    render(<TeamGoalCard {...baseProps()} />);
    expect(screen.queryByRole("button", { name: /self-review reminder/i })).not.toBeInTheDocument();
  });
});
