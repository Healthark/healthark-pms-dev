import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  NotificationToastContext,
  type NotificationToastContextValue,
} from "./NotificationToastContext";
import { NotificationToast } from "../components/feedback/NotificationToast";
import type { StoredNotificationItem } from "../services/notification.service";

// Each pop lives ~3.5s then auto-dismisses (spec: "visible for 3 seconds then
// disappear on its own"). The stack is capped so a burst of arrivals (e.g. on
// tab refocus after being away) can't flood the corner.
const AUTO_DISMISS_MS = 3500;
const MAX_VISIBLE = 4;

interface ToastEntry {
  id: number;
  title: string;
  body: string;
  category: StoredNotificationItem["category"];
}

interface NotificationToastProviderProps {
  readonly children: ReactNode;
}

/**
 * Manages a top-right stack of transient notification pops, each with its own
 * auto-dismiss timer. Modeled on SnackbarProvider's stacking machinery but
 * scoped to notifications: shorter dwell, capped depth, notification styling.
 * Anchored just below the Topbar and right-aligned to the topbar padding, so a
 * pop reads as coming from the bell — same width (w-96) as the bell's
 * Notification panel.
 */
export function NotificationToastProvider({
  children,
}: NotificationToastProviderProps) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());
  const seqRef = useRef(0);

  const removeEntry = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const timerId = timersRef.current.get(id);
      if (timerId !== undefined) {
        globalThis.clearTimeout(timerId);
        timersRef.current.delete(id);
      }
      removeEntry(id);
    },
    [removeEntry],
  );

  const notify = useCallback(
    (item: StoredNotificationItem) => {
      seqRef.current += 1;
      const id = seqRef.current;
      // slice(-MAX_VISIBLE) drops the oldest when over cap. Its timer is left to
      // fire harmlessly (removeEntry is a no-op once the entry is already gone),
      // keeping this updater pure — no side effects under StrictMode double-invoke.
      setEntries((prev) =>
        [
          ...prev,
          { id, title: item.title, body: item.body, category: item.category },
        ].slice(-MAX_VISIBLE),
      );
      const timerId = globalThis.setTimeout(() => {
        timersRef.current.delete(id);
        removeEntry(id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timerId);
    },
    [removeEntry],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => globalThis.clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo<NotificationToastContextValue>(
    () => ({ notify }),
    [notify],
  );

  return (
    <NotificationToastContext.Provider value={value}>
      {children}
      {entries.length > 0 &&
        createPortal(
          <div
            className="pointer-events-none fixed right-8 top-20 z-[60] flex flex-col gap-2"
            aria-live="polite"
          >
            {entries.map((e) => (
              <NotificationToast
                key={e.id}
                title={e.title}
                body={e.body}
                category={e.category}
                onDismiss={() => dismiss(e.id)}
              />
            ))}
          </div>,
          document.body,
        )}
    </NotificationToastContext.Provider>
  );
}
