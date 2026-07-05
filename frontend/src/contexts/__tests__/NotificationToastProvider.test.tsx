/**
 * Tests for the notification-toast stack lifecycle: a pop renders, auto-
 * dismisses after the dwell window, can be dismissed manually, and the stack
 * is capped so a burst of arrivals drops the oldest.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationToastProvider } from "../NotificationToastProvider";
import { useNotificationToast } from "../../hooks/useNotificationToast";
import type { StoredNotificationItem } from "../../services/notification.service";

void React;

const item = (
  id: number,
  category: "personal" | "announcement" = "personal",
): StoredNotificationItem => ({
  id,
  category,
  type: "t",
  title: `Title ${id}`,
  body: "Body text",
  link: null,
  created_at: "2026-06-01T00:00:00Z",
  is_read: false,
});

// Capture the notify() fn from context so tests can pop toasts imperatively.
let notify: (i: StoredNotificationItem) => void;
function Capture() {
  notify = useNotificationToast().notify;
  return null;
}

function renderProvider() {
  render(
    <NotificationToastProvider>
      <Capture />
    </NotificationToastProvider>,
  );
}

describe("NotificationToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a pop with the notification title and category label", () => {
    renderProvider();
    act(() => notify(item(1)));

    expect(screen.getByText("Title 1")).toBeInTheDocument();
    expect(screen.getByText("Notification")).toBeInTheDocument();
  });

  it("labels an announcement distinctly", () => {
    renderProvider();
    act(() => notify(item(7, "announcement")));

    expect(screen.getByText("Announcement")).toBeInTheDocument();
  });

  it("auto-dismisses after ~3.5s", () => {
    renderProvider();
    act(() => notify(item(1)));
    expect(screen.getByText("Title 1")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
  });

  it("can be dismissed manually before the timer fires", () => {
    renderProvider();
    act(() => notify(item(1)));

    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
  });

  it("caps the visible stack, dropping the oldest", () => {
    renderProvider();
    act(() => {
      for (let i = 1; i <= 5; i++) notify(item(i));
    });

    // Oldest (Title 1) dropped; newest four remain.
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
    expect(screen.getByText("Title 2")).toBeInTheDocument();
    expect(screen.getByText("Title 5")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });
});
