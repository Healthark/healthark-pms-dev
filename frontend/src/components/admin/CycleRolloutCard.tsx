/**
 * CycleRolloutCard — the manual active-cycle control for System Settings.
 *
 * The active cycle is admin-advanced (not date-derived). This card shows the
 * current cycle and the cycle a roll-out would advance to, and drives the two
 * mutations: a one-click "Roll out next cycle" and a manual "Set cycle"
 * (corrections / first-time setup). The FY-rollover is irreversible, so it
 * requires a typed confirmation.
 */
import { useState } from "react";
import { CalendarClock, ArrowRight, Loader2, X, Undo2 } from "lucide-react";
import {
  useCycleStatus,
  useRolloutCycle,
  useSetCycle,
} from "../../queries/adminSettings";
import type { CycleEffects } from "../../services/admin.service";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { getErrorMessage } from "../../utils/errors";

export function CycleRolloutCard() {
  const { data: status, isPending, error } = useCycleStatus();
  const rollout = useRolloutCycle();
  const setCycle = useSetCycle();
  const toast = useToast();
  const snackbar = useSnackbar();

  const [showRollout, setShowRollout] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [setInitial, setSetInitial] = useState("");

  if (isPending) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-5 text-sm text-text-muted shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading cycle…
      </div>
    );
  }
  if (error || !status) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-5 py-4 text-sm text-red-700 dark:text-red-300">
        Could not load the active cycle.
      </div>
    );
  }

  const handleRollout = async () => {
    try {
      const next = await rollout.mutateAsync();
      setShowRollout(false);
      toast.success(`Active cycle is now ${next.active_cycle}.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleSet = async (target: string) => {
    try {
      const next = await setCycle.mutateAsync({ target_cycle: target });
      setShowSet(false);
      toast.success(`Active cycle is now ${next.active_cycle}.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-light">
            <CalendarClock className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Active Cycle
            </p>
            <p className="font-display text-xl font-semibold text-text-main tabular-nums">
              {status.active_cycle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.previous_cycle && (
            <button
              type="button"
              onClick={() => {
                setSetInitial(status.previous_cycle ?? "");
                setShowSet(true);
              }}
              title={`Roll back to ${status.previous_cycle}`}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Roll back
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSetInitial("");
              setShowSet(true);
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-main hover:bg-surface-muted"
          >
            Set manually
          </button>
          <button
            type="button"
            onClick={() => setShowRollout(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Roll out next cycle
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            <span className="tabular-nums">{status.next_cycle}</span>
          </button>
        </div>
      </div>

      {showRollout && (
        <RolloutModal
          effects={status.effects}
          isSaving={rollout.isPending}
          onConfirm={handleRollout}
          onCancel={() => setShowRollout(false)}
        />
      )}
      {showSet && (
        <SetCycleModal
          current={status.active_cycle}
          initialTarget={setInitial}
          isSaving={setCycle.isPending}
          onConfirm={handleSet}
          onCancel={() => setShowSet(false)}
        />
      )}
    </div>
  );
}

function ModalShell({
  title,
  onCancel,
  children,
}: {
  readonly title: string;
  readonly onCancel: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-sm font-semibold text-text-main">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-text-muted hover:bg-surface-hover"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bulleted "what will / won't change" list, specific to the transition type. */
function EffectsSummary({ effects }: { readonly effects: CycleEffects }) {
  const will = effects.fy_rollover
    ? [
        `The fiscal year advances — ${effects.to_cycle} begins a new annual-review and annual-goal cycle.`,
        "A fresh configuration is created for the new fiscal year with every window closed (open them when ready).",
        "New reviews and goals are stamped with the new cycle.",
      ]
    : [
        `The active cycle label becomes ${effects.to_cycle} everywhere.`,
        "New project reviews are stamped with the new half; the earlier half stays open for backfill.",
      ];
  const wont = effects.fy_rollover
    ? [
        "The previous fiscal year stays fully readable and editable as history.",
        "Published ratings and submitted reviews/goals are preserved.",
      ]
    : [
        "The fiscal year is unchanged — annual reviews and goals are untouched.",
        "Per-fiscal-year access windows are unchanged; nothing is deleted.",
      ];
  return (
    <div className="space-y-3 text-[13px]">
      <div>
        <p className="font-semibold text-text-main">What will change</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-text-muted">
          {will.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-semibold text-text-main">What won't change</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-text-muted">
          {wont.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RolloutModal({
  effects,
  isSaving,
  onConfirm,
  onCancel,
}: {
  readonly effects: CycleEffects;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needsTyped = effects.requires_typed_confirmation;
  const canConfirm = !needsTyped || typed.trim() === effects.to_cycle;

  return (
    <ModalShell title="Roll out next cycle" onCancel={onCancel}>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm text-text-main">
          Advance from <span className="font-semibold">{effects.from_cycle}</span>{" "}
          to <span className="font-semibold">{effects.to_cycle}</span>.
        </p>
        <EffectsSummary effects={effects} />
        {needsTyped && (
          <div>
            <label
              htmlFor="rollout-typed-confirm"
              className="block text-xs font-medium text-text-muted mb-1"
            >
              This crosses into a new fiscal year and can't be undone. Type{" "}
              <span className="font-semibold tabular-nums">{effects.to_cycle}</span>{" "}
              to confirm.
            </label>
            <input
              id="rollout-typed-confirm"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={effects.to_cycle}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-surface-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || !canConfirm}
          className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? "Rolling out…" : `Roll out → ${effects.to_cycle}`}
        </button>
      </div>
    </ModalShell>
  );
}

function SetCycleModal({
  current,
  initialTarget,
  isSaving,
  onConfirm,
  onCancel,
}: {
  readonly current: string;
  readonly initialTarget: string;
  readonly isSaving: boolean;
  readonly onConfirm: (target: string) => void;
  readonly onCancel: () => void;
}) {
  const [target, setTarget] = useState(initialTarget);
  const canConfirm = target.trim().length > 0;

  return (
    <ModalShell title="Set cycle manually" onCancel={onCancel}>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-text-main">
          Current cycle: <span className="font-semibold">{current}</span>.
        </p>
        <div>
          <label
            htmlFor="set-cycle-target"
            className="block text-xs font-medium text-text-muted mb-1"
          >
            New cycle (strict format, e.g. H1 FY26-27)
          </label>
          <input
            id="set-cycle-target"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="H1 FY26-27"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-brand"
          />
        </div>
        <p className="rounded-md border border-amber-200 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Manual set applies the same changes as a roll-out. A brand-new fiscal
          year starts all-closed; rolling back to an existing year keeps its
          saved window configuration. Use it for corrections or first-time setup.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-surface-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(target.trim())}
          disabled={isSaving || !canConfirm}
          className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Set cycle"}
        </button>
      </div>
    </ModalShell>
  );
}
