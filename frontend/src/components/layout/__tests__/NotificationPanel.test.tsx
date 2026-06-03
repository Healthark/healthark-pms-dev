/**
 * Component tests for the NotificationPanel (half-height drawer).
 *
 * Renders via createPortal to document.body — RTL's `screen` queries the whole
 * document, so portal content is found. Wrapped in MemoryRouter because the
 * component uses useNavigate for deep-links. Key behaviors vs. the old
 * dropdown: heading + description + timestamp show without a click, the whole
 * row navigates (no separate "Open →" button), and there is no expand step.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationPanel } from "../NotificationPanel";
import type {
  NotificationItem,
  StoredNotificationItem,
} from "../../../services/notification.service";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

void React;

const computed: NotificationItem[] = [
  { type: "goals_pending_approval", message: "2 goals await your approval.", count: 2, severity: "warning" },
];

const personal: StoredNotificationItem[] = [
  {
    id: 11,
    category: "personal",
    type: "goal_approved",
    title: "Goal approved",
    body: "Your goal was approved.",
    link: "/annual-goals?tab=my",
    created_at: "2026-06-01T00:00:00Z",
    is_read: false,
  },
];

const announcements: StoredNotificationItem[] = [
  {
    id: 21,
    category: "announcement",
    type: "admin_broadcast",
    title: "Second half has started",
    body: "Review mentee goals.",
    link: null,
    created_at: "2026-06-01T00:00:00Z",
    is_read: false,
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof NotificationPanel>> = {}) {
  const props = {
    notifications: computed,
    personal,
    announcements,
    anchorRect: { bottom: 10, right: 10 } as DOMRect,
    onClose: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllPersonal: vi.fn(),
    onMarkAllAnnouncements: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <NotificationPanel {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("NotificationPanel", () => {
  beforeEach(() => mockNavigate.mockClear());

  it("renders both tabs and the Notifications tab by default", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /Notifications/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Announcements/ })).toBeInTheDocument();
    expect(screen.getByText("2 goals await your approval.")).toBeInTheDocument();
    expect(screen.getByText("Goal approved")).toBeInTheDocument();
    expect(screen.queryByText("Second half has started")).not.toBeInTheDocument();
  });

  it("shows heading, description and timestamp without any click", () => {
    renderPanel();
    // Description is visible immediately (no expand step).
    expect(screen.getByText("Your goal was approved.")).toBeInTheDocument();
    // A relative timestamp is rendered next to the row.
    expect(screen.getByText(/ago|^\d+ \w+ \d{4}$/)).toBeInTheDocument();
  });

  it("navigates on row click and has no 'Open' button", async () => {
    const user = userEvent.setup();
    renderPanel();
    // No separate Open affordance — the row itself is the navigation target.
    expect(screen.queryByRole("button", { name: /open/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Goal approved/ }));
    expect(mockNavigate).toHaveBeenCalledWith("/annual-goals?tab=my");
  });

  it("switches to the Announcements tab", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Announcements/ }));
    expect(screen.getByText("Second half has started")).toBeInTheDocument();
    expect(screen.queryByText("2 goals await your approval.")).not.toBeInTheDocument();
  });

  it("marks a personal row read by id; computed alerts have no tick", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    const ticks = screen.getAllByLabelText("Mark as read");
    expect(ticks).toHaveLength(1);
    await user.click(ticks[0]);
    expect(props.onMarkRead).toHaveBeenCalledWith(11);
  });

  it("'Mark all as read' clears the active tab", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(props.onMarkAllPersonal).toHaveBeenCalledTimes(1);
    expect(props.onMarkAllAnnouncements).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Announcements/ }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(props.onMarkAllAnnouncements).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state and hides 'Mark all' when nothing is actionable", () => {
    renderPanel({ notifications: [], personal: [] });
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });

  it("renders a long body in a scroll area with the scrollbar hidden", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Announcements/ }));
    const bodyEl = screen.getByText("Review mentee goals.");
    // The body is a self-contained, scrollbar-hidden scroll area so a ~100-word
    // announcement scrolls instead of inflating the row.
    expect(bodyEl).toHaveClass("overflow-y-auto");
    expect(bodyEl).toHaveClass("scrollbar-hide");
  });
});
