import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useSnackbar } from "../../hooks/useSnackbar";
import { canExport } from "../../utils/exportEligibility";
import { getErrorMessage } from "../../utils/errors";

interface ExportExcelButtonProps {
  readonly label?: string;
  readonly onDownload: () => Promise<void>;
  readonly disabled?: boolean;
  readonly size?: "sm" | "md";
}

/**
 * Reusable Excel export button. Renders `null` when the current user is
 * not eligible (no HR department, not management) so toolbars collapse
 * cleanly without an empty slot. The backend independently enforces the
 * same gate.
 */
export function ExportExcelButton({
  label = "Export",
  onDownload,
  disabled = false,
  size = "md",
}: ExportExcelButtonProps) {
  const { user } = useAuth();
  const snackbar = useSnackbar();
  const [isDownloading, setIsDownloading] = useState(false);

  if (!canExport(user)) return null;

  const handleClick = async () => {
    if (isDownloading || disabled) return;
    setIsDownloading(true);
    try {
      await onDownload();
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const padding = size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isDownloading}
      className={
        `inline-flex items-center gap-2 rounded-lg border border-border bg-surface ${padding} ` +
        "font-medium text-text-main transition-colors hover:bg-surface " +
        "disabled:cursor-not-allowed disabled:opacity-60"
      }
      aria-label={label}
    >
      {isDownloading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{isDownloading ? "Preparing…" : label}</span>
    </button>
  );
}
