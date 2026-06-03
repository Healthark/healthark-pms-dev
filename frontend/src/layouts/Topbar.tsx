import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, CalendarDays } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { NotificationPanel } from "../components/layout/NotificationPanel";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsSummary,
} from "../queries/notifications";

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

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Computed standing alerts (Notifications tab). These are NOT dismissable —
  // they reflect live state and clear themselves when the underlying work is
  // resolved (e.g. approving a pending goal drops the count to 0). Stored rows
  // are split into personal (Notifications tab) + announcements (Announcements
  // tab). The bell dot lights if any of the three has something.
  const computedNotifications = summary?.notifications ?? [];
  const personal = summary?.personal ?? [];
  const announcements = summary?.announcements ?? [];
  const personalUnread = personal.filter((n) => !n.is_read).length;
  const announcementsUnread = announcements.filter((n) => !n.is_read).length;
  const hasNotifications =
    computedNotifications.length > 0 ||
    personalUnread > 0 ||
    announcementsUnread > 0;

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

  // Notifications tab "mark all": marks all stored personal rows read.
  // Computed standing alerts are not dismissable — they clear when resolved.
  const handleMarkAllPersonal = useCallback(async () => {
    if (personalUnread > 0) {
      await markAllReadMutation.mutateAsync("personal");
    }
  }, [personalUnread, markAllReadMutation]);

  // Announcements tab "mark all": mark all stored announcement rows read.
  const handleMarkAllAnnouncements = useCallback(async () => {
    if (announcementsUnread > 0) {
      await markAllReadMutation.mutateAsync("announcement");
    }
  }, [announcementsUnread, markAllReadMutation]);

  // Per-notification read: stored rows (personal + announcement) hit the
  // backend by id. The dropdown stays open and the row updates on next render.
  const handleMarkRead = useCallback(
    async (id: number) => {
      await markReadMutation.mutateAsync(id);
    },
    [markReadMutation],
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
              ? `Notifications (${computedNotifications.length + personalUnread + announcementsUnread} new)`
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

      {/* Notification panel — Portal so it escapes the header's layout */}
      {anchorRect && summary && (
        <NotificationPanel
          notifications={computedNotifications}
          personal={personal}
          announcements={announcements}
          anchorRect={anchorRect}
          onClose={handleClose}
          onMarkRead={handleMarkRead}
          onMarkAllPersonal={handleMarkAllPersonal}
          onMarkAllAnnouncements={handleMarkAllAnnouncements}
        />
      )}
    </header>
  );
}
