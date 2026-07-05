import { useNewNotificationToasts } from "../hooks/useNewNotificationToasts";

/**
 * Headless bridge — runs the new-notification watcher and renders nothing.
 * Mounted once inside the authenticated AppShell so pops only fire for
 * logged-in users (and stop firing on logout when AppShell unmounts).
 */
export function NotificationToaster() {
  useNewNotificationToasts();
  return null;
}
