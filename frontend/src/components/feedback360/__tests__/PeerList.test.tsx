/**
 * Tests for the Give Feedback peer-list filter defaults. The toolbar
 * should land on "All" (not "Worked with") on first render, and the
 * Clear-filters control should treat "All" as the no-filter baseline.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeedbackPeer } from "../../../services/feedback360.service";

vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const useFeedbackPeers = vi.fn();
vi.mock("../../../queries/feedback360", () => ({
  useFeedbackPeers: () => useFeedbackPeers(),
}));

import { PeerList } from "../PeerList";

void React;

const peer = (over: Partial<FeedbackPeer>): FeedbackPeer => ({
  user_id: 1,
  full_name: "Jordan Lee",
  designation_name: "Engineer",
  department_name: "Platform",
  has_submitted: false,
  worked_with: true,
  received_count: 0,
  ...over,
});

const PEERS: FeedbackPeer[] = [
  peer({ user_id: 1, full_name: "A", worked_with: true }),
  peer({ user_id: 2, full_name: "B", worked_with: false }),
];

beforeEach(() => {
  useFeedbackPeers.mockReturnValue({ data: PEERS, isPending: false, error: null });
});

// The active chip is the only one styled with the solid brand fill.
const isActive = (btn: HTMLElement) => btn.className.includes("bg-brand");

describe("PeerList — default filter", () => {
  it('defaults to the "All" chip, not "Worked with"', () => {
    render(<PeerList />);

    const allChip = screen.getByRole("button", { name: /^All \(/ });
    const workedChip = screen.getByRole("button", { name: "Worked with" });

    expect(isActive(allChip)).toBe(true);
    expect(isActive(workedChip)).toBe(false);
  });

  it('resets back to "All" when filters are cleared', async () => {
    const user = userEvent.setup();
    render(<PeerList />);

    // Switch to a non-default filter so Clear becomes meaningful.
    await user.click(screen.getByRole("button", { name: "Not worked with" }));
    expect(isActive(screen.getByRole("button", { name: "Not worked with" }))).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: /clear/i }));

    expect(isActive(screen.getByRole("button", { name: /^All \(/ }))).toBe(true);
    expect(
      isActive(screen.getByRole("button", { name: "Not worked with" })),
    ).toBe(false);
  });
});
