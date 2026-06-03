/**
 * NotifyTab — Admin "Notify" surface.
 *
 * Sends a manual org-wide announcement (in-app + optional email) that lands in
 * the Announcements tab of everyone's bell. This is the manual channel for
 * calendar-transition reminders (half started / new FY) since there's no
 * scheduler. Quick presets pre-fill subject/body; both stay fully editable.
 */
import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { useSendNotify } from "../../queries/adminSettings";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";

type Audience = "all" | "mentors";

const PRESETS: {
  key: string;
  label: string;
  subject: string;
  body: string;
  audience: Audience;
}[] = [
  {
    key: "second_half",
    label: "Second half has started",
    subject: "The second half of the year has started",
    body:
      "The second half of the performance cycle has begun. Mentees: please " +
      "complete your self-reviews. Mentors: review your mentees' goals and " +
      "submit your evaluations.",
    audience: "all",
  },
  {
    key: "new_fy",
    label: "New financial year",
    subject: "A new financial year has started",
    body:
      "A new financial year has begun. Please create your annual goals for " +
      "the new cycle from the Annual Goals page.",
    audience: "all",
  },
];

export function NotifyTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const sendNotify = useSendNotify();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [sendEmail, setSendEmail] = useState(true);

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSubject(preset.subject);
    setBody(preset.body);
    setAudience(preset.audience);
  };

  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  const handleSend = async () => {
    if (!canSend) return;
    const ok = await confirm({
      title: "Send announcement?",
      message: `This will notify ${
        audience === "all" ? "all users" : "mentors only"
      }${sendEmail ? " and send an email" : ""}.`,
      variant: "warning",
      confirmText: "Send",
    });
    if (!ok) return;
    try {
      const result = await sendNotify.mutateAsync({
        subject,
        body,
        audience,
        send_email: sendEmail,
      });
      toast.success(
        `Announcement sent to ${result.recipients} ${
          result.recipients === 1 ? "person" : "people"
        }.`,
      );
      setSubject("");
      setBody("");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";

  return (
    <div className="p-5 space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Send an announcement
          </h2>
          <p className="text-xs text-text-muted">
            Broadcast an in-app notice (and optional email) to your team. It
            lands in the Announcements tab of the notification bell.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">
          Quick presets
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-main hover:bg-surface-muted transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="notify-subject" className="block text-xs font-semibold text-text-main mb-1">
          Subject *
        </label>
        <input
          id="notify-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="e.g. The second half of the year has started"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="notify-body" className="block text-xs font-semibold text-text-main mb-1">
          Message *
        </label>
        <textarea
          id="notify-body"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          placeholder="What do you want to tell the team?"
          className={`${inputCls} resize-none`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2">
          <label htmlFor="notify-audience" className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Audience
          </label>
          <select
            id="notify-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as Audience)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
          >
            <option value="all">All users</option>
            <option value="mentors">Mentors only</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="rounded border-border"
          />
          Also send email
        </label>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend || sendNotify.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {sendNotify.isPending ? "Sending…" : "Send announcement"}
        </button>
      </div>
    </div>
  );
}
