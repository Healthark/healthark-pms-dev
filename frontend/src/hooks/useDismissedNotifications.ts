import { useCallback, useState } from "react";

/**
 * Client-side "read" state for the system-computed notifications (goals
 * pending approval, drafts, changes-requested).
 *
 * Those rows are recomputed from goal data on every `/notifications/summary`
 * load and carry no server-side read flag — so there is nothing to PATCH.
 * Instead we persist the user's dismissals in localStorage, scoped per user.
 *
 * Dismissal keys embed the notification's current count (e.g. "goals_draft:3"),
 * so a dismissed alert RE-SURFACES when its magnitude changes: if a mentee
 * submits a new goal and "1 awaiting approval" becomes "2 awaiting approval",
 * the new key isn't dismissed and the bell lights up again. This keeps the
 * dismissal from silently hiding genuinely new work.
 *
 * Stored user notifications (mentor → mentee "Notify") are NOT handled here —
 * they have a real `is_read` column and go through the backend mark-read
 * routes (useMarkRead / useMarkAllRead).
 */
const STORAGE_PREFIX = "pms.dismissedNotifications";

function storageKeyFor(userId: number): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

function loadDismissed(userId: number): Set<string> {
  try {
    const raw = localStorage.getItem(storageKeyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    /* corrupt or unavailable storage — start from an empty set */
  }
  return new Set();
}

export interface DismissedNotifications {
  /** True when the given key has been dismissed by this user. */
  isDismissed: (key: string) => boolean;
  /** Dismiss one key or a batch; persists immediately. */
  dismiss: (keys: string | readonly string[]) => void;
}

export function useDismissedNotifications(userId: number): DismissedNotifications {
  // Lazy init is safe here: the Topbar only mounts behind ProtectedRoute,
  // where `user` (hence userId) is already resolved, so we never read the
  // wrong per-user bucket on the first render.
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    loadDismissed(userId),
  );

  const isDismissed = useCallback(
    (key: string) => dismissed.has(key),
    [dismissed],
  );

  const dismiss = useCallback(
    (keys: string | readonly string[]) => {
      const toAdd = typeof keys === "string" ? [keys] : keys;
      if (toAdd.length === 0) return;
      setDismissed((prev) => {
        const next = new Set(prev);
        toAdd.forEach((k) => next.add(k));
        try {
          localStorage.setItem(storageKeyFor(userId), JSON.stringify([...next]));
        } catch {
          /* best-effort persistence — quota/disabled storage is non-fatal */
        }
        return next;
      });
    },
    [userId],
  );

  return { isDismissed, dismiss };
}
