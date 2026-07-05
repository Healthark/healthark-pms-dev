import { createContext } from "react";
import type { StoredNotificationItem } from "../services/notification.service";

export interface NotificationToastContextValue {
  /** Pop a transient toast for a freshly-arrived notification/announcement. */
  notify: (item: StoredNotificationItem) => void;
}

// Undefined sentinel forces consumers through the useNotificationToast hook,
// which throws a clear dev-time error if used outside the Provider.
export const NotificationToastContext = createContext<
  NotificationToastContextValue | undefined
>(undefined);
