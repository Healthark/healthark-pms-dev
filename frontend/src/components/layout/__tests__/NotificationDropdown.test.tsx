/**
 * Component tests for the two-tab NotificationDropdown (PR 1).
 *
 * Renders via createPortal to document.body — RTL's `screen` queries the
 * whole document, so portal content is found. Wrapped in MemoryRouter because
 * the component uses useNavigate for deep-links.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationDropdown } from "../NotificationDropdown";
import type {
  NotificationItem,
  StoredNotificationItem,
} from "../../../services/notification.service";

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

function renderDropdown(overrides: Partial<React.ComponentProps<typeof NotificationDropdown>> = {}) {
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
      <NotificationDropdown {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("NotificationDropdown", () => {
  it("renders both tabs and the Notifications tab by default", () => {
    renderDropdown();
    expect(screen.getByRole("button", { name: /Notifications/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Announcements/ })).toBeInTheDocument();
    // Notifications tab content: computed message + personal row.
    expect(screen.getByText("2 goals await your approval.")).toBeInTheDocument();
    expect(screen.getByText("Goal approved")).toBeInTheDocument();
    // Announcement content is on the other tab.
    expect(screen.queryByText("Second half has started")).not.toBeInTheDocument();
  });

  it("switches to the Announcements tab", async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole("button", { name: /Announcements/ }));
    expect(screen.getByText("Second half has started")).toBeInTheDocument();
    expect(screen.queryByText("2 goals await your approval.")).not.toBeInTheDocument();
  });

  it("marks a personal row read by id; computed alerts have no tick", async () => {
    const user = userEvent.setup();
    const props = renderDropdown();
    // Computed standing alerts aren't dismissable → only the personal row has
    // a ✓ tick. Clicking it marks that row read by id.
    const ticks = screen.getAllByLabelText("Mark as read");
    expect(ticks).toHaveLength(1);
    await user.click(ticks[0]);
    expect(props.onMarkRead).toHaveBeenCalledWith(11);
  });

  it("hides the description until the notification is clicked", async () => {
    const user = userEvent.setup();
    renderDropdown();
    // Collapsed: only the title is shown.
    expect(screen.getByText("Goal approved")).toBeInTheDocument();
    expect(screen.queryByText("Your goal was approved.")).not.toBeInTheDocument();
    // Clicking the row reveals its description.
    await user.click(screen.getByRole("button", { name: /Goal approved/ }));
    expect(screen.getByText("Your goal was approved.")).toBeInTheDocument();
  });

  it("'Mark all as read' clears the active tab", async () => {
    const user = userEvent.setup();
    const props = renderDropdown();
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(props.onMarkAllPersonal).toHaveBeenCalledTimes(1);
    expect(props.onMarkAllAnnouncements).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Announcements/ }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(props.onMarkAllAnnouncements).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state and hides 'Mark all' when nothing is actionable", () => {
    renderDropdown({ notifications: [], personal: [] });
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });
});
