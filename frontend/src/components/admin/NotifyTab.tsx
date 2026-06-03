/**
 * NotifyTab — Admin "Notify" surface.
 *
 * Sends a manual, targeted announcement (in-app + optional email) that lands in
 * the Announcements tab of each recipient's bell. Recipients are narrowed by
 * AND-combined filters — mentors-only, departments, and designations — with a
 * live recipient count; no filter set means everyone. Quick presets pre-fill
 * subject/body; both stay fully editable.
 */
import { useMemo, useState } from "react";
import { Megaphone, Send, Building2, Briefcase, Users2 } from "lucide-react";
import { useSendNotify } from "../../queries/adminSettings";
import { useDepartments, useDesignations } from "../../queries/adminReferenceData";
import { useUsers } from "../../queries/users";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { getErrorMessage } from "../../utils/errors";

const PRESETS: {
  key: string;
  label: string;
  subject: string;
  body: string;
}[] = [
  {
    key: "second_half",
    label: "Second half has started",
    subject: "The second half of the year has started",
    body:
      "The second half of the performance cycle has begun. Mentees: please " +
      "complete your self-reviews. Mentors: review your mentees' goals and " +
      "submit your evaluations.",
  },
  {
    key: "new_fy",
    label: "New financial year",
    subject: "A new financial year has started",
    body:
      "A new financial year has begun. Please create your annual goals for " +
      "the new cycle from the Annual Goals page.",
  },
];

/** Add/remove an id from a number[] selection (immutable). */
function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function NotifyTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const sendNotify = useSendNotify();

  const { data: departments = [] } = useDepartments();
  const { data: designations = [] } = useDesignations();
  const { data: users = [], isLoading: usersLoading } = useUsers();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mentorsOnly, setMentorsOnly] = useState(false);
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [designationIds, setDesignationIds] = useState<number[]>([]);
  const [sendEmail, setSendEmail] = useState(true);

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSubject(preset.subject);
    setBody(preset.body);
  };

  // Live recipient preview — mirrors the backend notify_audience() filter
  // (active users, AND-combined mentors-only / department / designation).
  const recipientCount = useMemo(() => {
    const active = users.filter((u) => !u.is_deleted);
    const mentorIds = new Set(
      active.map((u) => u.mentor_id).filter((id): id is number => id != null),
    );
    return active.filter((u) => {
      if (mentorsOnly && !mentorIds.has(u.id)) return false;
      if (departmentIds.length > 0 && !(u.department_id != null && departmentIds.includes(u.department_id))) {
        return false;
      }
      if (designationIds.length > 0 && !(u.designation_id != null && designationIds.includes(u.designation_id))) {
        return false;
      }
      return true;
    }).length;
  }, [users, mentorsOnly, departmentIds, designationIds]);

  const hasContent = subject.trim().length > 0 && body.trim().length > 0;
  const canSend = hasContent && recipientCount > 0;

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (mentorsOnly) parts.push("mentors");
    if (departmentIds.length > 0) {
      parts.push(`${departmentIds.length} dept${departmentIds.length === 1 ? "" : "s"}`);
    }
    if (designationIds.length > 0) {
      parts.push(`${designationIds.length} designation${designationIds.length === 1 ? "" : "s"}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "everyone";
  }, [mentorsOnly, departmentIds, designationIds]);

  const handleSend = async () => {
    if (!canSend) return;
    const ok = await confirm({
      title: "Send announcement?",
      message:
        `This will notify ${recipientCount} ` +
        `${recipientCount === 1 ? "person" : "people"} (${filterSummary})` +
        `${sendEmail ? " and send an email" : ""}.`,
      variant: "warning",
      confirmText: "Send",
    });
    if (!ok) return;
    try {
      const result = await sendNotify.mutateAsync({
        subject,
        body,
        mentors_only: mentorsOnly,
        department_ids: departmentIds,
        designation_ids: designationIds,
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

  const chipCls = (selected: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      selected
        ? "border-brand bg-brand text-white"
        : "border-border text-text-main hover:bg-surface-muted"
    }`;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Send an announcement
          </h2>
          <p className="text-xs text-text-muted">
            Broadcast an in-app notice (and optional email) to a targeted group.
            It lands in the Announcements tab of the notification bell.
          </p>
        </div>
      </div>

      {/* Full-width two-column layout: message composer + recipients */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Message composer (spans 2/3) ── */}
        <div className="space-y-5 lg:col-span-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-muted">
              Quick presets
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-surface-muted"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="notify-subject" className="mb-1 block text-xs font-semibold text-text-main">
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
            <label htmlFor="notify-body" className="mb-1 block text-xs font-semibold text-text-main">
              Message *
            </label>
            <textarea
              id="notify-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              placeholder="What do you want to tell the team?"
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>

        {/* ── Recipients panel (1/3) ── */}
        <div className="lg:col-span-1">
          <div className="space-y-4 rounded-xl border border-border bg-surface-muted/40 p-4">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-brand" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-text-main">Recipients</h3>
            </div>

            {/* Mentors-only quick toggle */}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={mentorsOnly}
                onChange={(e) => setMentorsOnly(e.target.checked)}
                className="rounded border-border"
              />
              Mentors only
            </label>

            {/* Departments */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                Departments
              </div>
              <div className="flex flex-wrap gap-1.5">
                {departments.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={departmentIds.includes(d.id)}
                    onClick={() => setDepartmentIds((prev) => toggleId(prev, d.id))}
                    className={chipCls(departmentIds.includes(d.id))}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Designations */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                Designations
              </div>
              <div className="flex flex-wrap gap-1.5">
                {designations.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={designationIds.includes(d.id)}
                    onClick={() => setDesignationIds((prev) => toggleId(prev, d.id))}
                    className={chipCls(designationIds.includes(d.id))}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  className="rounded border-border"
                />
                Also send email
              </label>
            </div>

            {/* Live recipient count */}
            <div className="rounded-lg bg-surface px-3 py-2 text-xs text-text-muted">
              {usersLoading ? (
                "Counting recipients…"
              ) : (
                <>
                  Sending to{" "}
                  <span className="font-semibold text-text-main">
                    {recipientCount} {recipientCount === 1 ? "person" : "people"}
                  </span>{" "}
                  ({filterSummary})
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend || sendNotify.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {sendNotify.isPending ? "Sending…" : "Send announcement"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
