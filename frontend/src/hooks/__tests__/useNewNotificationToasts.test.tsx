/**
 * Tests for the new-notification watcher's dedup logic.
 *
 * Dedup is a per-user high-water mark persisted to localStorage, so a
 * notification pops exactly once per browser — whether it's discovered by a
 * live poll or is already present on a page refresh — and never re-pops. The
 * summary query, toast context, and auth are mocked so we can drive successive
 * "polls" and simulate a reload (fresh hook mount, same localStorage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { StoredNotificationItem } from "../../services/notification.service";

// Map-backed localStorage stub — jsdom's isn't reliably present here, and this
// lets a single test keep its store across simulated reloads (unmount+remount).
function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

const summaryRef: { current: unknown } = { current: undefined };
const userRef: { current: { user_id: number } | null } = {
  current: { user_id: 1 },
};
const notify = vi.fn();

vi.mock("../../queries/notifications", () => ({
  useNotificationsSummary: () => ({ data: summaryRef.current }),
}));
vi.mock("../useNotificationToast", () => ({
  useNotificationToast: () => ({ notify }),
}));
vi.mock("../useAuth", () => ({
  useAuth: () => ({ user: userRef.current }),
}));

import { useNewNotificationToasts } from "../useNewNotificationToasts";

const item = (
  id: number,
  is_read = false,
  category: "personal" | "announcement" = "personal",
): StoredNotificationItem => ({
  id,
  category,
  type: "t",
  title: `T${id}`,
  body: "b",
  link: null,
  created_at: "2026-06-01T00:00:00Z",
  is_read,
});

const summary = (
  personal: StoredNotificationItem[] = [],
  announcements: StoredNotificationItem[] = [],
) => ({ active_cycle: null, personal, announcements });

describe("useNewNotificationToasts", () => {
  beforeEach(() => {
    installLocalStorage();
    notify.mockClear();
    summaryRef.current = undefined;
    userRef.current = { user_id: 1 };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pops unread rows present on first load (no mark yet)", () => {
    summaryRef.current = summary([item(1), item(2)]);
    renderHook(() => useNewNotificationToasts());
    // The exact fix for the bug report: a notification already present on a
    // fresh load must pop, not be silently baselined.
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not re-pop the same rows on a later identical poll", () => {
    summaryRef.current = summary([item(1)]);
    const { rerender } = renderHook(() => useNewNotificationToasts());
    expect(notify).toHaveBeenCalledTimes(1);

    summaryRef.current = summary([item(1)]);
    rerender();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not re-pop across a reload (fresh mount, same localStorage)", () => {
    summaryRef.current = summary([item(1), item(2)]);
    const first = renderHook(() => useNewNotificationToasts());
    expect(notify).toHaveBeenCalledTimes(2);
    first.unmount();

    // Simulate a page refresh: hook remounts, summary still has the same rows.
    notify.mockClear();
    summaryRef.current = summary([item(1), item(2)]);
    renderHook(() => useNewNotificationToasts());
    expect(notify).not.toHaveBeenCalled();
  });

  it("pops a genuinely-new arrival that appears only on refresh", () => {
    // First session sees rows 1-2 and records the mark.
    summaryRef.current = summary([item(1), item(2)]);
    renderHook(() => useNewNotificationToasts()).unmount();
    notify.mockClear();

    // Row 3 arrived while the tab was closed; it's present on the next load.
    summaryRef.current = summary([item(1), item(2), item(3)]);
    renderHook(() => useNewNotificationToasts());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("pops a new arrival discovered by a live poll", () => {
    summaryRef.current = summary([item(1)]);
    const { rerender } = renderHook(() => useNewNotificationToasts());
    notify.mockClear();

    summaryRef.current = summary([item(1), item(2, false, "announcement")]);
    rerender();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, category: "announcement" }),
    );
  });

  it("skips rows that are already read", () => {
    summaryRef.current = summary([item(1, true), item(2, true)]);
    renderHook(() => useNewNotificationToasts());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not leak one user's mark onto another on a shared browser", () => {
    // User 1 sees rows up to id 5.
    summaryRef.current = summary([item(5)]);
    renderHook(() => useNewNotificationToasts()).unmount();
    notify.mockClear();

    // User 2 logs in on the same browser; their unread row id 3 must still pop
    // even though it's below user 1's mark.
    userRef.current = { user_id: 2 };
    summaryRef.current = summary([item(3)]);
    renderHook(() => useNewNotificationToasts());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });
});
