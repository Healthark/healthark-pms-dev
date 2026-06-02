import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, CheckCircle, BellDot, Check, ChevronDown } from "lucide-react";
import type {
  NotificationItem,
  StoredNotificationItem,
} from "../../services/notification.service";

interface NotificationDropdownProps {
  /** Computed standing counts — Notifications tab. */
  readonly notifications: NotificationItem[];
  /** Persisted personal events — Notifications tab. */
  readonly personal: StoredNotificationItem[];
  /** Persisted org-wide announcements — Announcements tab. */
  readonly announcements: StoredNotificationItem[];
  /** DOMRect of the bell button — used to position the dropdown below it. */
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
    <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
      <CheckCircle className="h-8 w-8 text-green-400" aria-hidden="true" />
      <p className="text-sm font-medium text-text-main">You're all caught up!</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

export function NotificationDropdown({
  notifications,
  personal,
  announcements,
  anchorRect,
  onClose,
  onMarkRead,
  onMarkAllPersonal,
  onMarkAllAnnouncements,
}: NotificationDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("notifications");
  // Stored rows show title-only; clicking one reveals its description.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Navigate to a row's target page, then dismiss the dropdown.
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

  const countBadge = (n: number) =>
    n > 0 ? (
      <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-brand/10 px-1.5 text-[10px] font-bold text-brand">
        {n}
      </span>
    ) : null;

  // Shared renderer for a stored row (personal or announcement). Collapsed it
  // shows the title only; clicking the row reveals the description (and an
  // "Open" link when the notification deep-links somewhere).
  const renderStored = (item: StoredNotificationItem) => {
    const isExpanded = expandedId === item.id;
    return (
      <li
        key={item.id}
        className={item.is_read ? "bg-surface" : "bg-blue-50 dark:bg-blue-950/40"}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => setExpandedId(isExpanded ? null : item.id)}
            aria-expanded={isExpanded}
            className="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <BellDot
              className={`h-4 w-4 shrink-0 ${item.is_read ? "text-text-muted" : "text-blue-500 dark:text-blue-400 dark:text-blue-300"}`}
              aria-hidden="true"
            />
            <p className="flex-1 text-sm font-medium text-text-main">{item.title}</p>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          {!item.is_read && (
            <button
              type="button"
              onClick={() => onMarkRead(item.id)}
              aria-label="Mark as read"
              title="Mark as read"
              className="flex shrink-0 items-center px-3 text-text-muted hover:text-brand transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {isExpanded && (
          <div className="pl-11 pr-4 pb-3 -mt-1">
            {item.body && (
              <p className="text-xs text-text-muted whitespace-pre-wrap">{item.body}</p>
            )}
            {item.link && (
              <button
                type="button"
                onClick={() => item.link && handleNavigate(item.link)}
                className="mt-1.5 text-[11px] font-medium text-brand hover:underline"
              >
                Open →
              </button>
            )}
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
      {/* Tab bar — two equal, centered halves */}
      <div className="flex border-b border-border">
        <button type="button" className={tabCls("notifications")} onClick={() => setTab("notifications")}>
          Notifications{countBadge(notificationsCount)}
        </button>
        <button type="button" className={tabCls("announcements")} onClick={() => setTab("announcements")}>
          Announcements{countBadge(announcementsUnread)}
        </button>
      </div>

      {/* "Mark all as read" — its own thin row so the tabs stay equal halves */}
      {activeClearable && (
        <div className="flex justify-end border-b border-border px-3 py-1.5">
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
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {/* Computed standing alerts — live to-dos, not dismissable. They
                clear themselves when the underlying work is resolved, so there
                is no ✓ tick; the whole row just deep-links to the action. */}
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
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {announcements.map(renderStored)}
          </ul>
        ))}
    </div>,
    document.body,
  );
}
