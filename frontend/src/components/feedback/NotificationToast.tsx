import { Bell, Megaphone, X } from "lucide-react";
import type { NotificationCategory } from "../../services/notification.service";

interface NotificationToastProps {
  readonly title: string;
  readonly body: string;
  readonly category: NotificationCategory;
  readonly onDismiss: () => void;
}

const CATEGORY_META: Record<
  NotificationCategory,
  { icon: typeof Bell; label: string }
> = {
  personal: { icon: Bell, label: "Notification" },
  announcement: { icon: Megaphone, label: "Announcement" },
};

/**
 * Single notification pop. Visual concerns only — lifecycle (auto-dismiss,
 * stacking) is owned by NotificationToastProvider. Styled to read as a piece
 * of app chrome (surface + brand accent) rather than a status banner, so it's
 * distinct from the success Toast (top-center) and error Snackbar (top-right).
 */
export function NotificationToast({
  title,
  body,
  category,
  onDismiss,
}: NotificationToastProps) {
  const { icon: Icon, label } = CATEGORY_META[category];

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-96 items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg animate-[fadeIn_0.2s_ease-out]"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand dark:text-white">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </p>
        <p className="truncate text-sm font-semibold text-text-main">{title}</p>
        {body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{body}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-text-muted opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
