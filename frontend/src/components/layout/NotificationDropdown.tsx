import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, CheckCircle, BellDot, Check, CheckCheck } from "lucide-react";
import type { NotificationItem, UserNotificationItem } from "../../services/notification.service";

interface NotificationDropdownProps {
  readonly notifications: NotificationItem[];
  readonly userNotifications: UserNotificationItem[];
  /** DOMRect of the bell button — used to position the dropdown below it. */
  readonly anchorRect: DOMRect;
  readonly onClose: () => void;
  /** Mark a single stored user notification as read (by id). */
  readonly onMarkRead: (id: number) => void;
  /** Dismiss a single computed system notification (no server read state). */
  readonly onMarkSystemRead: (notification: NotificationItem) => void;
  readonly onMarkAllRead: () => Promise<void>;
}

/**
 * Maps a computed (system) notification to the page where the user can act
 * on it. Goal-related notifications land on the Annual Goals page; the
 * `?tab=` param focuses the relevant tab (Team Goals for items awaiting the
 * mentor's approval, My Goals for the user's own goals).
 */
function routeForNotification(type: string): string {
  switch (type) {
    case "goals_pending_approval":
      return "/annual-goals?tab=team";
    case "goals_changes_requested":
    case "goals_draft":
    default:
      return "/annual-goals?tab=my";
  }
}

const SEVERITY_STYLES: Record<
  NotificationItem["severity"],
  { icon: typeof Info; iconClass: string; bgClass: string }
> = {
  info: {
    icon: Info,
    iconClass: "text-blue-500 dark:text-blue-400 dark:text-blue-300",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500 dark:text-amber-400 dark:text-amber-300",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
  },
  blocking: {
    icon: AlertTriangle,
    iconClass: "text-red-500 dark:text-red-400 dark:text-red-300",
    bgClass: "bg-red-50 dark:bg-red-950/40",
  },
};

export function NotificationDropdown({
  notifications,
  userNotifications,
  anchorRect,
  onClose,
  onMarkRead,
  onMarkSystemRead,
  onMarkAllRead,
}: NotificationDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Navigate to the notification's target page, then dismiss the dropdown.
  const handleNavigate = (to: string) => {
    onClose();
    navigate(to);
  };

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Notifications"
      className="w-80 rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 50,
      }}
    >
      <div className="px-4 py-3 border-b border-border">
        <p className="font-display text-sm font-semibold text-text-main">
          Notifications
        </p>
      </div>

      {notifications.length === 0 && userNotifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
          <CheckCircle className="h-8 w-8 text-green-400" aria-hidden="true" />
          <p className="text-sm font-medium text-text-main">
            You're all caught up!
          </p>
          <p className="text-xs text-text-muted">
            No pending actions right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {/* System-computed notifications. Two targets per row: the message
              navigates, the tick dismisses (client-side — no server read
              state). Undismissed rows are the only ones passed in, so the
              tick always shows. */}
          {notifications.map((n) => {
            const { icon: Icon, iconClass, bgClass } = SEVERITY_STYLES[n.severity];
            return (
              <li key={n.type} className={`flex items-stretch ${bgClass}`}>
                <button
                  type="button"
                  onClick={() => handleNavigate(routeForNotification(n.type))}
                  className="flex flex-1 items-start gap-3 px-4 py-3 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
                  <p className="text-sm text-text-main">{n.message}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onMarkSystemRead(n)}
                  aria-label="Mark as read"
                  title="Mark as read"
                  className="flex shrink-0 items-center px-3 text-text-muted hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {/* Direct user notifications from mentor Notify button. Two
              targets per row: the message navigates, the tick marks read. */}
          {userNotifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-stretch ${n.is_read ? "bg-surface" : "bg-blue-50 dark:bg-blue-950/40"}`}
            >
              <button
                type="button"
                onClick={() => handleNavigate("/annual-goals?tab=my")}
                className="flex flex-1 items-start gap-3 px-4 py-3 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <BellDot
                  className={`h-4 w-4 mt-0.5 shrink-0 ${n.is_read ? "text-text-muted" : "text-blue-500 dark:text-blue-400 dark:text-blue-300"}`}
                  aria-hidden="true"
                />
                <p className="text-sm text-text-main">{n.message}</p>
              </button>
              {!n.is_read && (
                <button
                  type="button"
                  onClick={() => onMarkRead(n.id)}
                  aria-label="Mark as read"
                  title="Mark as read"
                  className="flex shrink-0 items-center px-3 text-text-muted hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer — clear everything in one shot: dismiss every visible system
          alert and mark every stored user notification read. Shown whenever
          there is at least one actionable item of either kind. */}
      {(notifications.length > 0 || userNotifications.some((n) => !n.is_read)) && (
        <div className="border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium text-brand hover:bg-surface-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all as read
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
