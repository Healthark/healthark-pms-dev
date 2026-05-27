/**
 * useToday.ts — Reactive "today" honoring the Date Simulation feature.
 *
 * When Admin + management has pinned a simulated date via System Settings,
 * every client-side relative-time calculation (countdowns, "X days left",
 * cycle-math driven UI) should reference that simulated date instead of
 * the real wall clock. This hook is the canonical entry point.
 *
 * Use this WHEREVER you currently call `new Date()` for cycle math, review
 * countdowns, or default values of "today" in date pickers.
 *
 * Do NOT use this for:
 *   - `created_at` / `updated_at` displays (those are real server timestamps)
 *   - "X minutes ago" labels on notifications backed by server times
 *   - Anywhere a real wall-clock instant is what you actually want
 */
import { useSystemSettings } from "./useSystemSettings";

/**
 * Returns a `Date` representing the resolved "today" for the current user.
 *
 * - When `settings.simulated_today` is set, returns midnight of that date
 *   (parsed as `YYYY-MM-DD` so it's interpreted in the local timezone the
 *   way most "today" UI logic expects).
 * - Otherwise returns the real current `Date`.
 *
 * The returned value is a NEW `Date` each render so callers can mutate it
 * with `setHours` etc. without affecting other consumers.
 */
export function useToday(): Date {
  const { settings } = useSystemSettings();
  if (settings?.simulated_today) {
    return new Date(`${settings.simulated_today}T00:00:00`);
  }
  return new Date();
}
