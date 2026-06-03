import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, CheckCircle, BellDot, Check } from "lucide-react";
import type {
  NotificationItem,
  StoredNotificationItem,
} from "../../services/notification.service";
import { timeAgo } from "../../utils/timeAgo";

interface NotificationPanelProps {
  /** Computed standing counts — Notifications tab. */
  readonly notifications: NotificationItem[];
  /** Persisted personal events — Notifications tab. */
  readonly personal: StoredNotificationItem[];
  /** Persisted org-wide announcements — Announcements tab. */
  readonly announcements: StoredNotificationItem[];
  /** DOMRect of the bell button — used to position the panel below it. */
  readonly anchorRect: DOMRect;
  readonly onClose: () => void;
  /** Mark a single stored row (personal or announcement) read, by id. */
  readonly onMarkRead: (id: number) => void;
  /** Mark all stored personal rows read (Notifications tab). */
  readonly onMarkAllPersonal: () => void;
  /** Clear the Announcements tab. */
  readonly onMarkAllAnnouncements: () => void;
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

type Tab = "notifications" | "announcements";

function EmptyState({ label }: { readonly label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
      <CheckCircle className="h-8 w-8 text-green-400" aria-hidden="true" />
      <p className="text-sm font-medium text-text-main">You're all caught up!</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

export function NotificationPanel({
  notifications,
  personal,
  announcements,
  anchorRect,
  onClose,
  onMarkRead,
  onMarkAllPersonal,
  onMarkAllAnnouncements,
}: NotificationPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("notifications");

  // Navigate to a row's target page, then dismiss the panel.
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

  const personalUnread = personal.filter((p) => !p.is_read).length;
  const announcementsUnread = announcements.filter((a) => !a.is_read).length;
  // Computed rows reaching this component are always undismissed → "active".
  const notificationsCount = notifications.length + personalUnread;

  const tabCls = (t: Tab) =>
    `flex-1 px-3 py-2.5 text-center text-xs font-semibold border-b-2 transition-colors ${
      tab === t
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // A small unread dot beside a tab label — mirrors the bell-icon dot rather
  // than showing a number (the count now lives on the bell badge).
  const unreadDot = (show: boolean) =>
    show ? (
      <span
        className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
        aria-hidden="true"
      />
    ) : null;

  // Shared renderer for a stored row (personal or announcement). The whole row
  // is a single button: it shows heading + short description + a relative
  // timestamp, and navigates to the row's deep-link on click (when one is set).
  // The ✓ affordance (unread rows only) marks read without navigating.
  const renderStored = (item: StoredNotificationItem) => {
    const hasLink = Boolean(item.link);
    return (
      <li
        key={item.id}
        className={item.is_read ? "bg-surface" : "bg-blue-50 dark:bg-blue-950/40"}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => hasLink && item.link && handleNavigate(item.link)}
            disabled={!hasLink}
            className="flex flex-1 items-start gap-3 px-4 pt-3 text-left transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <BellDot
              className={`mt-0.5 h-4 w-4 shrink-0 ${item.is_read ? "text-text-muted" : "text-blue-500 dark:text-blue-400 dark:text-blue-300"}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium text-text-main">
                  {item.title}
                </p>
                <span className="shrink-0 text-[11px] text-text-muted">
                  {timeAgo(item.created_at)}
                </span>
              </div>
            </div>
          </button>
          {!item.is_read && (
            <button
              type="button"
              onClick={() => onMarkRead(item.id)}
              aria-label="Mark as read"
              title="Mark as read"
              className="flex shrink-0 items-start px-3 pt-3 text-text-muted hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {/* Body sits outside the (possibly disabled) nav button so a long
            announcement can scroll on its own. The scrollbar is hidden; the
            box caps height and scrolls to hold ~100 words without inflating
            the row. */}
        {item.body && (
          <div className="scrollbar-hide max-h-24 overflow-y-auto whitespace-pre-wrap px-4 pb-3 pl-11 text-xs text-text-muted">
            {item.body}
          </div>
        )}
      </li>
    );
  };

  const notificationsEmpty = notifications.length === 0 && personal.length === 0;
  // "Mark all as read" applies to whichever tab is active. Computed standing
  // alerts aren't dismissable (they clear when resolved), so the Notifications
  // tab's mark-all is gated only on unread stored personal rows.
  const activeClearable =
    tab === "notifications" ? personalUnread > 0 : announcementsUnread > 0;
  const activeMarkAll =
    tab === "notifications" ? onMarkAllPersonal : onMarkAllAnnouncements;

  // Half-height vertical drawer anchored under the bell, scrollable. Capped so
  // it never spills past the viewport bottom on short screens.
  const maxHeight = Math.max(240, window.innerHeight - anchorRect.bottom - 16);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Notifications"
      className="flex w-96 flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        // Slightly taller than half-height so one more row/line is visible.
        height: "calc(50svh + 3rem)",
        maxHeight,
        zIndex: 50,
      }}
    >
      {/* Tab bar — two equal, centered halves */}
      <div className="flex shrink-0 border-b border-border">
        <button type="button" className={tabCls("notifications")} onClick={() => setTab("notifications")}>
          Notifications{unreadDot(notificationsCount > 0)}
        </button>
        <button type="button" className={tabCls("announcements")} onClick={() => setTab("announcements")}>
          Announcements{unreadDot(announcementsUnread > 0)}
        </button>
      </div>

      {/* "Mark all as read" — its own thin row so the tabs stay equal halves */}
      {activeClearable && (
        <div className="flex shrink-0 justify-end border-b border-border px-3 py-1.5">
          <button
            type="button"
            onClick={activeMarkAll}
            className="text-[11px] font-medium text-brand hover:underline whitespace-nowrap"
          >
            Mark all as read
          </button>
        </div>
      )}

      {/* ── Notifications tab ── */}
      {tab === "notifications" &&
        (notificationsEmpty ? (
          <EmptyState label="No pending actions right now." />
        ) : (
          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {/* Computed standing alerts — live to-dos, not dismissable. They
                clear themselves when the underlying work is resolved, so there
                is no ✓ tick and no timestamp; the whole row deep-links to the
                action. */}
            {notifications.map((n) => {
              const { icon: Icon, iconClass, bgClass } = SEVERITY_STYLES[n.severity];
              return (
                <li key={n.type} className={bgClass}>
                  <button
                    type="button"
                    onClick={() => handleNavigate(routeForNotification(n.type))}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
                    <p className="text-sm text-text-main">{n.message}</p>
                  </button>
                </li>
              );
            })}
            {/* Persisted personal events */}
            {personal.map(renderStored)}
          </ul>
        ))}

      {/* ── Announcements tab ── */}
      {tab === "announcements" &&
        (announcements.length === 0 ? (
          <EmptyState label="No announcements right now." />
        ) : (
          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {announcements.map(renderStored)}
          </ul>
        ))}
    </div>,
    document.body,
  );
}
