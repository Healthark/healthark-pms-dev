import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, CalendarDays } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useDismissedNotifications } from "../hooks/useDismissedNotifications";
import { NotificationDropdown } from "../components/layout/NotificationDropdown";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import type { NotificationItem } from "../services/notification.service";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsSummary,
} from "../queries/notifications";

/**
 * Stable per-instance key for a computed system notification. Embeds the
 * count so a dismissed alert reappears once its magnitude changes — see
 * useDismissedNotifications for the rationale.
 */
function systemKey(n: NotificationItem): string {
  return `${n.type}:${n.count}`;
}

export function Topbar() {
  const { user } = useAuth();

  // ── Active Cycle — from the dedicated SystemSettings context ──────
  // This is the single source of truth for the cycle badge. When an Admin
  // updates the cycle in the Settings page, refreshSettings() fires and
  // the Topbar updates instantly without a full page reload.
  const { settings, isLoading: settingsLoading } = useSystemSettings();

  // ── Notifications — shared TanStack cache via ['notifications', 'summary']
  const { data: summary } = useNotificationsSummary();
  const markAllReadMutation = useMarkAllRead();
  const markReadMutation = useMarkRead();

  // Client-side read state for the computed system notifications — they have
  // no server-side `is_read`, so dismissals live in localStorage (per user).
  const { isDismissed, dismiss } = useDismissedNotifications(user?.user_id ?? 0);

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // System notifications the user hasn't dismissed yet — the single source
  // for the dropdown list, the unread dot, and "mark all".
  const visibleNotifications = (summary?.notifications ?? []).filter(
    (n) => !isDismissed(systemKey(n)),
  );
  const unreadUserCount =
    summary?.user_notifications.filter((n) => !n.is_read).length ?? 0;
  const hasNotifications =
    visibleNotifications.length > 0 || unreadUserCount > 0;

  const handleBellClick = useCallback(() => {
    if (anchorRect) {
      setAnchorRect(null);
      return;
    }
    if (bellRef.current) {
      setAnchorRect(bellRef.current.getBoundingClientRect());
    }
  }, [anchorRect]);

  const handleClose = useCallback(() => setAnchorRect(null), []);

  // "Mark all as read" — dismiss every visible system alert (client-side,
  // localStorage) AND mark every stored user notification read (server-side,
  // invalidation-only so the summary refetch clears the badge).
  const handleMarkAllRead = useCallback(async () => {
    if (visibleNotifications.length > 0) {
      dismiss(visibleNotifications.map(systemKey));
    }
    if (unreadUserCount > 0) {
      await markAllReadMutation.mutateAsync();
    }
  }, [visibleNotifications, dismiss, unreadUserCount, markAllReadMutation]);

  // Per-notification read: stored user notifications hit the backend; computed
  // system notifications are dismissed locally. The dropdown stays open and
  // the row disappears (system) or greys out (user) on the next render.
  const handleMarkRead = useCallback(
    async (id: number) => {
      await markReadMutation.mutateAsync(id);
    },
    [markReadMutation],
  );

  const handleMarkSystemRead = useCallback(
    (n: NotificationItem) => dismiss(systemKey(n)),
    [dismiss],
  );

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-8 shrink-0">
      {/* Left — active cycle badge */}
      <div className="flex items-center gap-3">
        {/* Active Cycle Badge — driven by SystemSettings context */}
        {settingsLoading ? (
          <span className="hidden sm:inline-flex items-center rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs text-text-muted animate-pulse">
            Loading...
          </span>
        ) : settings?.active_cycle_name ? (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand">
            <CalendarDays className="h-3 w-3 text-accent" aria-hidden="true" />
            {settings.active_cycle_name}
          </span>
        ) : null}
      </div>

      {/* Right — theme toggle + bell + avatar */}
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <button
          ref={bellRef}
          type="button"
          onClick={handleBellClick}
          className="relative p-2 text-text-muted hover:text-brand transition-colors rounded-full hover:bg-surface-muted"
          aria-label={
            hasNotifications
              ? `Notifications (${visibleNotifications.length} new)`
              : "Notifications"
          }
          aria-expanded={anchorRect !== null}
          aria-haspopup="dialog"
        >
          <Bell className="w-5 h-5" />
          {/* Red dot — only shown when there are real notifications */}
          {hasNotifications && (
            <span className="absolute top-1.5 right-2 w-2 h-2 bg-accent rounded-full border-2 border-surface" aria-hidden="true" />
          )}
        </button>

        <Link
          to="/profile"
          className="h-8 w-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-sm cursor-default focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 focus:ring-offset-surface"
          aria-label={user?.full_name ? `${user.full_name} — view profile` : "View profile"}
        >
          {initials}
        </Link>
      </div>

      {/* Notification dropdown — Portal so it escapes the header's layout */}
      {anchorRect && summary && (
        <NotificationDropdown
          notifications={visibleNotifications}
          userNotifications={summary.user_notifications}
          anchorRect={anchorRect}
          onClose={handleClose}
          onMarkRead={handleMarkRead}
          onMarkSystemRead={handleMarkSystemRead}
          onMarkAllRead={handleMarkAllRead}
        />
      )}
    </header>
  );
}
