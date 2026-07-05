/**
 * Tests for the notification-toast stack lifecycle: a pop renders, auto-
 * dismisses after the dwell window, can be dismissed manually, and the stack
 * is capped so a burst of arrivals drops the oldest.
 */
import React, { useRef } from "react";
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

// A "Pop next" button pops items from the provided list, one per click. Driving
// notify() through a real interaction (rather than capturing it into an outer
// variable) keeps the harness pure — no reassigning module-scope from render.
function Harness({ items }: { readonly items: StoredNotificationItem[] }) {
  const { notify } = useNotificationToast();
  const nextRef = useRef(0);
  return (
    <button
      type="button"
      onClick={() => {
        const next = items[nextRef.current];
        nextRef.current += 1;
        if (next) notify(next);
      }}
    >
      pop-next
    </button>
  );
}

function renderProvider(items: StoredNotificationItem[]) {
  render(
    <NotificationToastProvider>
      <Harness items={items} />
    </NotificationToastProvider>,
  );
}

const popNext = () => fireEvent.click(screen.getByText("pop-next"));

describe("NotificationToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a pop with the notification title and category label", () => {
    renderProvider([item(1)]);
    popNext();

    expect(screen.getByText("Title 1")).toBeInTheDocument();
    expect(screen.getByText("Notification")).toBeInTheDocument();
  });

  it("labels an announcement distinctly", () => {
    renderProvider([item(7, "announcement")]);
    popNext();

    expect(screen.getByText("Announcement")).toBeInTheDocument();
  });

  it("auto-dismisses after ~3.5s", () => {
    renderProvider([item(1)]);
    popNext();
    expect(screen.getByText("Title 1")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
  });

  it("can be dismissed manually before the timer fires", () => {
    renderProvider([item(1)]);
    popNext();

    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
  });

  it("caps the visible stack, dropping the oldest", () => {
    renderProvider([item(1), item(2), item(3), item(4), item(5)]);
    for (let i = 0; i < 5; i++) popNext();

    // Oldest (Title 1) dropped; newest four remain.
    expect(screen.queryByText("Title 1")).not.toBeInTheDocument();
    expect(screen.getByText("Title 2")).toBeInTheDocument();
    expect(screen.getByText("Title 5")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });
});
