import { AlertCircle, AlertTriangle, X } from "lucide-react";
import type { SnackbarVariant } from "../../contexts/SnackbarContext";

interface SnackbarProps {
  readonly message: string;
  readonly variant: SnackbarVariant;
  readonly onDismiss: () => void;
}

const VARIANT_STYLES: Record<
  SnackbarVariant,
  { icon: typeof AlertCircle; bg: string; border: string; text: string }
> = {
  error: {
    icon: AlertCircle,
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
  },
  warn: {
    icon: AlertTriangle,
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
  },
};

/**
 * Single snackbar entry. Visual concerns only — lifecycle (auto-dismiss) and
 * stacking are owned by SnackbarProvider so multiple entries can coexist.
 */
export function Snackbar({ message, variant, onDismiss }: SnackbarProps) {
  const style = VARIANT_STYLES[variant];
  const Icon = style.icon;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border ${style.bg} ${style.border} px-4 py-3 shadow-lg min-w-[280px] max-w-sm animate-[fadeIn_0.2s_ease-out]`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 mt-0.5 ${style.text}`}
        aria-hidden="true"
      />
      <p className={`flex-1 text-sm ${style.text}`}>{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className={`${style.text} opacity-60 hover:opacity-100 transition-opacity shrink-0`}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
