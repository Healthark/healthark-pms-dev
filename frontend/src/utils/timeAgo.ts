/**
 * Relative-time formatter for notification timestamps.
 *
 * Renders a compact "… ago" label ("just now", "5 min ago", "2 hours ago",
 * "2 days ago", "3 weeks ago"). Past ~30 days it falls back to an absolute
 * short date ("12 Mar 2026") since "47 days ago" reads worse than the date.
 *
 * Hand-rolled because the repo carries no date library. `now` is injectable
 * so the behavior is deterministic to unit-test.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY; // fallback boundary, not a calendar month

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return "";

  const diffSec = Math.floor((now.getTime() - ms) / 1000);

  // Clock skew / future timestamps → treat as just now rather than "-3s ago".
  if (diffSec < 45) return "just now";
  if (diffSec < HOUR) return plural(Math.floor(diffSec / MINUTE), "min");
  if (diffSec < DAY) return plural(Math.floor(diffSec / HOUR), "hour");
  if (diffSec < WEEK) return plural(Math.floor(diffSec / DAY), "day");
  if (diffSec < MONTH) return plural(Math.floor(diffSec / WEEK), "week");

  // Older than the fallback boundary → absolute short date.
  return then.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
