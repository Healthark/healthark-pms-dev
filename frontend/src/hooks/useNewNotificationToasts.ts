import { useEffect } from "react";
import { useNotificationsSummary } from "../queries/notifications";
import { useNotificationToast } from "./useNotificationToast";
import { useAuth } from "./useAuth";

// Per-user "high-water mark" — the highest notification id this browser has
// already popped. Scoped by user so a shared browser doesn't leak one account's
// mark onto another (notification ids come from one global sequence).
const HWM_KEY_PREFIX = "pms:notif:hwm:";

function readHwm(key: string): number {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Storage disabled/unavailable (private mode, quota). Degrade to 0 — worst
    // case a pop repeats; never crash the app over a toast.
    return 0;
  }
}

function writeHwm(key: string, value: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Watches the (polled) notification summary and pops a transient toast for each
 * unread notification/announcement this browser hasn't popped before.
 *
 * Dedup is a persisted high-water mark, NOT an in-memory baseline: because
 * notification ids are monotonic (DB auto-increment), "id > hwm" means "arrived
 * since we last looked". So a notification pops exactly once per browser —
 * whether it's discovered by the live poll OR is already present on a page
 * refresh — and never re-pops on later refreshes. (The previous in-memory
 * baseline reset on every reload, so a notification that arrived while the tab
 * was closed silently seeded the baseline and never popped, even though the
 * bell's unread dot updated from the same summary.)
 */
export function useNewNotificationToasts(): void {
  const { data: summary } = useNotificationsSummary();
  const { notify } = useNotificationToast();
  const { user } = useAuth();
  const userKey =
    user?.user_id != null ? `${HWM_KEY_PREFIX}${user.user_id}` : null;

  useEffect(() => {
    if (!summary) return;
    if (!userKey) return;
    const items = [...summary.personal, ...summary.announcements];
    if (items.length === 0) return;

    const hwm = readHwm(userKey);
    const maxId = items.reduce((m, i) => Math.max(m, i.id), hwm);

    // Pop unread rows newer than the mark, oldest-first so the newest ends up
    // last (and stays visible under the provider's stack cap). Advancing the
    // mark first-thing — synchronously to localStorage — means a StrictMode
    // double-invoke (or an immediate re-render) re-reads the new mark and
    // pops nothing.
    if (maxId > hwm) writeHwm(userKey, maxId);
    items
      .filter((i) => i.id > hwm && !i.is_read)
      .sort((a, b) => a.id - b.id)
      .forEach((item) => notify(item));
  }, [summary, notify, userKey]);
}
