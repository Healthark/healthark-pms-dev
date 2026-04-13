/**
 * StarRating.tsx — Reusable 1–5 Star Rating Component.
 *
 * Two modes:
 *   - Interactive: onClick fires onChange(value) — used in forms
 *   - Read-only:   Displays filled/empty stars with no interaction
 *
 * Supports two sizes: default (h-5) and "lg" (h-7) for the final rating display.
 *
 * Placement: src/components/reviews/StarRating.tsx
 */

import { useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  /** Current rating value (1–5, or 0 for unset). */
  readonly value: number;
  /** If provided, the component becomes interactive. */
  readonly onChange?: (value: number) => void;
  /** If true, no interaction — display only. */
  readonly readonly?: boolean;
  /** Size variant: default or "lg" for emphasis. */
  readonly size?: "default" | "lg";
}

const STARS = [1, 2, 3, 4, 5] as const;

const LABELS = [
  "Needs Improvement",
  "Below Expectations",
  "Meets Expectations",
  "Exceeds Expectations",
  "Exceptional",
] as const;

export function StarRating({
  value,
  onChange,
  readonly: isReadonly = false,
  size = "default",
}: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const isInteractive = !isReadonly && onChange !== undefined;

  const starSize = size === "lg" ? "h-7 w-7" : "h-5 w-5";

  const displayValue = hovered > 0 ? hovered : value;

  return (
    <div className="flex items-center gap-1">
      {STARS.map((star) => {
        const filled = star <= displayValue;
        return isInteractive ? (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className="p-0.5 transition-transform hover:scale-110"
            aria-label={`Rate ${star} out of 5: ${LABELS[star - 1]}`}
          >
            <Star
              className={`${starSize} transition-colors ${
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-slate-300"
              }`}
            />
          </button>
        ) : (
          <Star
            key={star}
            className={`${starSize} ${
              filled
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-slate-300"
            }`}
            aria-hidden="true"
          />
        );
      })}

      {/* Label text */}
      {displayValue > 0 && (
        <span
          className={`ml-1.5 font-medium ${
            size === "lg" ? "text-sm" : "text-xs"
          } text-text-muted`}
        >
          {LABELS[displayValue - 1]}
        </span>
      )}
    </div>
  );
}
