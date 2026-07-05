import { useContext } from "react";
import {
  NotificationToastContext,
  type NotificationToastContextValue,
} from "../contexts/NotificationToastContext";

/**
 * Consumer hook for the notification-toast context. Throws if used outside
 * `<NotificationToastProvider>` so misuse fails fast at dev time.
 */
export function useNotificationToast(): NotificationToastContextValue {
  const ctx = useContext(NotificationToastContext);
  if (ctx === undefined) {
    throw new Error(
      "useNotificationToast must be used inside <NotificationToastProvider>.",
    );
  }
  return ctx;
}
