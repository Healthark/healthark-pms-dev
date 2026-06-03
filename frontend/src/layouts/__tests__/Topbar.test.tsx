/**
 * Tests for the Topbar bell's unread count badge.
 *
 * Topbar pulls in auth / settings / notifications hooks and the panel; all are
 * mocked so we can assert just the badge: it shows the total unread count
 * (computed alerts + personal + announcements), caps at "9+", and disappears
 * when there's nothing unread.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const summaryRef: { current: unknown } = { current: undefined };

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { full_name: "Test User" } }),
}));
vi.mock("../../hooks/useSystemSettings", () => ({
  useSystemSettings: () => ({ settings: { active_cycle_name: "H1 FY26-27" }, isLoading: false }),
}));
vi.mock("../../components/layout/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));
vi.mock("../../components/layout/NotificationPanel", () => ({
  NotificationPanel: () => <div data-testid="panel" />,
}));
vi.mock("../../queries/notifications", () => ({
  useNotificationsSummary: () => ({ data: summaryRef.current }),
  useMarkAllRead: () => ({ mutateAsync: vi.fn() }),
  useMarkRead: () => ({ mutateAsync: vi.fn() }),
}));

import { Topbar } from "../Topbar";

void React;

function renderTopbar(summary: unknown) {
  summaryRef.current = summary;
  render(
    <MemoryRouter>
      <Topbar />
    </MemoryRouter>,
  );
}

const stored = (id: number, read: boolean) => ({
  id,
  category: "personal",
  type: "t",
  title: "T",
  body: "b",
  link: null,
  created_at: "2026-06-01T00:00:00Z",
  is_read: read,
});

describe("Topbar bell badge", () => {
  it("shows the total unread count", () => {
    renderTopbar({
      active_cycle: "H1 FY26-27",
      notifications: [{ type: "x", message: "m", count: 1, severity: "info" }],
      personal: [stored(1, false), stored(2, false)],
      announcements: [stored(3, false)],
    });
    // 1 computed + 2 personal unread + 1 announcement unread = 4
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("caps the badge at 9+", () => {
    renderTopbar({
      active_cycle: null,
      notifications: Array.from({ length: 12 }, (_, i) => ({
        type: `x${i}`,
        message: "m",
        count: 1,
        severity: "info" as const,
      })),
      personal: [],
      announcements: [],
    });
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("shows no badge when nothing is unread", () => {
    renderTopbar({ active_cycle: null, notifications: [], personal: [], announcements: [] });
    // Read rows don't count; no numeric badge rendered.
    expect(screen.queryByText(/^\d+\+?$/)).not.toBeInTheDocument();
  });
});
