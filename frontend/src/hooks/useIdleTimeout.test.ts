import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authService } from "../services/auth.service";
import {
  IDLE_LIMIT_MS,
  REFRESH_THROTTLE_MS,
  useIdleTimeout,
} from "./useIdleTimeout";

// jsdom's localStorage is non-functional under vitest's opaque-origin default,
// so back it with a simple in-memory Storage for these tests.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", makeMemoryStorage());
    vi.spyOn(authService, "refresh").mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("seeds the window and refreshes once on mount", () => {
    renderHook(() => useIdleTimeout(true, vi.fn()));
    expect(authService.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    renderHook(() => useIdleTimeout(false, vi.fn()));
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it("fires onExpire after the idle limit with no activity", () => {
    const onExpire = vi.fn();
    renderHook(() => useIdleTimeout(true, onExpire));

    // Just before the limit: still alive.
    vi.advanceTimersByTime(IDLE_LIMIT_MS - 1_000);
    expect(onExpire).not.toHaveBeenCalled();

    // Cross the limit; the watchdog tick catches it.
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("throttles refresh on bursts of activity but renews after the window", () => {
    renderHook(() => useIdleTimeout(true, vi.fn()));
    expect(authService.refresh).toHaveBeenCalledTimes(1); // mount seed

    // Activity within the throttle window does NOT trigger another refresh.
    globalThis.dispatchEvent(new Event("mousedown"));
    expect(authService.refresh).toHaveBeenCalledTimes(1);

    // After the throttle window, fresh activity slides the window again.
    vi.advanceTimersByTime(REFRESH_THROTTLE_MS + 1_000);
    globalThis.dispatchEvent(new Event("keydown"));
    expect(authService.refresh).toHaveBeenCalledTimes(2);
  });

  it("activity defers expiry past the original deadline", () => {
    const onExpire = vi.fn();
    renderHook(() => useIdleTimeout(true, onExpire));

    // Stay active until just shy of the limit, then act again.
    vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000);
    globalThis.dispatchEvent(new Event("mousemove"));

    // Past the *original* deadline — but activity reset the clock, so alive.
    vi.advanceTimersByTime(120_000);
    expect(onExpire).not.toHaveBeenCalled();

    // Now go idle for the full window → expires.
    vi.advanceTimersByTime(IDLE_LIMIT_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const onExpire = vi.fn();
    const { unmount } = renderHook(() => useIdleTimeout(true, onExpire));
    unmount();

    vi.advanceTimersByTime(IDLE_LIMIT_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
