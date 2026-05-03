/**
 * RatingTrack — 1–5 dotted slider used in two modes:
 *
 *   <RatingTrack value={4} onChange={setRating} />          // input
 *   <RatingTrack value={4} disabled />                       // read-only, integer
 *   <RatingTrack avg={4.2} cohort="worked" />                // aggregate plot
 *   <RatingTrack avg={null} placeholder="Need 3+ reviewers" /> // hidden cohort
 *
 * Visual: a thin horizontal track with five tick dots evenly spaced.
 * The "thumb" is rendered as a larger filled dot at either an integer
 * position (input mode) or an interpolated float position (aggregate
 * mode). Untouched input → no thumb rendered, only the ticks.
 */

interface RatingTrackProps {
  /** Integer rating 1–5 (input / read-only modes). `undefined` = not rated. */
  readonly value?: number;
  /** Float average 1.0–5.0 (aggregate mode). null = below threshold. */
  readonly avg?: number | null;
  /** Aggregate cohort — drives the thumb colour. */
  readonly cohort?: "worked" | "not_worked";
  /** Placeholder text when avg is null (below threshold). */
  readonly placeholder?: string;
  /** Click handler for input mode. Omit for read-only / aggregate. */
  readonly onChange?: (v: number) => void;
  /** Disable interaction (read-only). Doesn't affect aggregate mode. */
  readonly disabled?: boolean;
}

const TICK_VALUES = [1, 2, 3, 4, 5] as const;

function pctFor(rating: number): number {
  // Map 1..5 → 0%..100% with the four equal segments.
  return ((rating - 1) / 4) * 100;
}

export function RatingTrack({
  value,
  avg,
  cohort,
  placeholder,
  onChange,
  disabled,
}: RatingTrackProps) {
  const isAggregate = avg !== undefined;
  const isInteractive = !isAggregate && !disabled && !!onChange;

  // Resolve thumb position + colour.
  let thumbPct: number | null = null;
  let thumbColor = "bg-brand";
  if (isAggregate) {
    if (avg !== null) {
      thumbPct = pctFor(avg);
      thumbColor = cohort === "not_worked" ? "bg-amber-500" : "bg-brand";
    }
  } else if (typeof value === "number") {
    thumbPct = pctFor(value);
  }

  return (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 h-7 flex items-center select-none">
        {/* The track line */}
        <div className="absolute inset-x-1.5 h-px bg-border" />

        {/* Tick dots — also serve as click targets in input mode */}
        <div className="absolute inset-x-0 flex justify-between items-center">
          {TICK_VALUES.map((v) => {
            const selected = !isAggregate && value === v;
            const tickBase =
              "h-2 w-2 rounded-full transition-all";
            const tickColor = selected
              ? "bg-brand"
              : "bg-slate-300";
            if (isInteractive) {
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange?.(v)}
                  className={`${tickBase} ${tickColor} hover:scale-150 hover:bg-brand cursor-pointer`}
                  aria-label={`Rate ${v}`}
                  aria-pressed={selected}
                />
              );
            }
            return (
              <span
                key={v}
                className={`${tickBase} ${tickColor} ${
                  disabled ? "opacity-70" : ""
                }`}
                aria-hidden="true"
              />
            );
          })}
        </div>

        {/* Thumb — input/read-only show at integer; aggregate at float. */}
        {thumbPct !== null && (
          <div
            className={`absolute h-3.5 w-3.5 rounded-full ${thumbColor} ring-2 ring-surface shadow-sm pointer-events-none transition-all`}
            style={{
              left: `${thumbPct}%`,
              transform: "translateX(-50%)",
              opacity: disabled ? 0.7 : 1,
            }}
            aria-hidden="true"
          />
        )}

        {/* Aggregate-mode placeholder when below threshold */}
        {isAggregate && avg === null && placeholder && (
          <div className="absolute inset-0 flex items-center">
            <p className="text-[11px] italic text-text-muted">{placeholder}</p>
          </div>
        )}
      </div>

      {/* Right-hand value/label */}
      {isAggregate ? null : (
        <span className="w-14 shrink-0 text-right text-[11px] font-medium text-text-muted">
          {typeof value === "number" ? `${value} / 5` : "Not rated"}
        </span>
      )}
    </div>
  );
}
