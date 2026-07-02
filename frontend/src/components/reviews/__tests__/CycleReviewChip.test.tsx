/**
 * CycleReviewChip clickability. A `pending` chip is clickable whether or not a
 * DB row backs it — a no-row pending opens a read-only placeholder in the
 * parent — while an `upcoming` chip stays a non-interactive label.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CycleReviewChip } from "../CycleReviewChip";
import type { CycleSlot } from "../../../utils/groupProjectReviews";
import type { ProjectReviewResponse } from "../../../services/project-review.service";

void React;

const pendingNoRow: CycleSlot = {
  period: "H1",
  cycleName: "H1 FY26-27",
  review: null,
  state: "pending",
};

const reviewed: CycleSlot = {
  period: "H2",
  cycleName: "H2 FY26-27",
  review: {
    performance_group: "A",
    reviewer_name: "Jane PM",
  } as ProjectReviewResponse,
  state: "reviewed",
};

const upcoming: CycleSlot = {
  period: "H2",
  cycleName: "H2 FY26-27",
  review: null,
  state: "upcoming",
};

describe("CycleReviewChip", () => {
  it("makes a pending chip with no backing row clickable and passes the slot", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<CycleReviewChip slot={pendingNoRow} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "H1" }));
    expect(onClick).toHaveBeenCalledWith(pendingNoRow);
  });

  it("keeps a reviewed chip clickable", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<CycleReviewChip slot={reviewed} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "H2" }));
    expect(onClick).toHaveBeenCalledWith(reviewed);
  });

  it("renders an upcoming chip as a non-interactive label", () => {
    const onClick = vi.fn();
    render(<CycleReviewChip slot={upcoming} onClick={onClick} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
