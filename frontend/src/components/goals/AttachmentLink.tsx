import { Link as LinkIcon } from "lucide-react";

import { isSafeHttpUrl } from "../../utils/url";

interface AttachmentLinkProps {
  url: string | null | undefined;
  className?: string;
}

/**
 * Renders a goal's attachment_url as a clickable "Attachment" link ONLY when it
 * is a safe http(s) URL. Any other value — e.g. a legacy `javascript:` payload
 * stored before backend validation existed — is shown as inert, non-clickable
 * text so the reviewer still sees that a reference was provided, but no script
 * can execute in their session. Renders nothing when the URL is empty.
 *
 * This is the single render-time guard for attachment links; all goal views
 * should use it rather than emitting `<a href={goal.attachment_url}>` inline.
 */
export default function AttachmentLink({ url, className }: AttachmentLinkProps) {
  if (!url) return null;

  const extra = className ?? "";

  if (!isSafeHttpUrl(url)) {
    return (
      <span
        className={`flex items-center gap-1.5 text-xs text-text-muted w-fit ${extra}`}
        title="This reference link was hidden because it is not a valid http(s) URL."
      >
        <LinkIcon className="h-3 w-3 shrink-0" />
        Attachment (link hidden — invalid URL)
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-1.5 text-xs text-brand hover:underline w-fit ${extra}`}
    >
      <LinkIcon className="h-3 w-3 shrink-0" />
      Attachment
    </a>
  );
}
