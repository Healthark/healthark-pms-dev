import { useEffect, useRef } from "react";
import { authService } from "../services/auth.service";

/**
 * Idle-session timeout (30-minute sliding window).
 *
 * While the user is active we slide the server-side window forward by calling
 * POST /auth/refresh (throttled — at most once per REFRESH_THROTTLE_MS of
 * activity, never on every mouse move). After IDLE_LIMIT_MS with no activity
 * the watchdog fires `onExpire()`, which logs the user out and surfaces the
 * "session expired" notice on the login screen.
 *
 * The backend JWT `exp` is the real backstop: even if this hook is bypassed,
 * the cookie dies IDLE_LIMIT_MS after the last refresh and the next request
 * 401s. This hook just makes the logout prompt and well-labelled.
 *
 * Cross-tab: the last-activity timestamp lives in localStorage, so activity in
 * ANY tab keeps EVERY tab alive (the auth cookie is shared across tabs of the
 * same origin, so one tab's refresh slides the window for all of them).
 */

// Must stay in sync with backend ACCESS_TOKEN_EXPIRE_MINUTES (config.py).
export const IDLE_LIMIT_MS = 30 * 60_000;
// At most one /auth/refresh per minute of continuous activity.
export const REFRESH_THROTTLE_MS = 60_000;
// How often the watchdog checks the elapsed-idle time.
const WATCHDOG_INTERVAL_MS = 30_000;
// Shared across tabs so any tab's activity keeps the whole browser alive.
export const LAST_ACTIVITY_KEY = "lastActivityAt";
// sessionStorage marker set on idle logout and read by the Login page to show
// the "session expired" notice. sessionStorage (not localStorage) so it never
// leaks into a fresh, intentional sign-in in another tab.
export const SESSION_EXPIRED_KEY = "sessionExpiredReason";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

function readLastActivity(): number {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * @param enabled  Only arm the timers while a user is authenticated.
 * @param onExpire Called once when the idle limit is reached (logs out).
 */
export function useIdleTimeout(enabled: boolean, onExpire: () => void): void {
  // Keep the latest onExpire without re-arming listeners every render.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!enabled) return;

    let lastRefresh = 0;
    let expired = false;

    const markActivity = () => {
      if (expired) return;
      const now = Date.now();
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      if (now - lastRefresh >= REFRESH_THROTTLE_MS) {
        lastRefresh = now;
        // Fire-and-forget. A 401 here means the cookie already expired; the
        // axios interceptor handles the logout, so we swallow the rejection.
        void authService.refresh().catch(() => {});
      }
    };

    const watchdog = () => {
      if (expired) return;
      if (Date.now() - readLastActivity() >= IDLE_LIMIT_MS) {
        expired = true;
        onExpireRef.current();
      }
    };

    // Seed the window so a freshly-loaded session starts the clock now.
    markActivity();

    for (const evt of ACTIVITY_EVENTS) {
      globalThis.addEventListener(evt, markActivity, { passive: true });
    }
    const intervalId = globalThis.setInterval(watchdog, WATCHDOG_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        globalThis.removeEventListener(evt, markActivity);
      }
      globalThis.clearInterval(intervalId);
    };
  }, [enabled]);
}
