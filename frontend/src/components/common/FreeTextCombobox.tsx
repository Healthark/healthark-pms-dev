/**
 * FreeTextCombobox.tsx — a single-select picker that ALSO accepts free text.
 *
 * Like `StringCombobox`, it offers a type-to-filter dropdown of suggestions;
 * unlike it, the input is bound directly to `value`, so whatever the user
 * types IS the value — they're never forced to pick a listed option. Picking
 * a suggestion just fills the value for them. Used by the Support form where
 * a user may report an issue on a page/tab that isn't in the predefined list.
 *
 * Vanilla React + Tailwind, no library. Clearing (X) emits `""`.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown, X } from "lucide-react";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-sm text-text-main placeholder:text-text-muted outline-none focus:border-brand";

interface FreeTextComboboxProps {
  readonly id: string;
  readonly options: readonly string[];
  /** The current text (free-form). Empty string means "no value". */
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly minWidth?: string;
}

export function FreeTextCombobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Select or type…",
  minWidth = "100%",
}: FreeTextComboboxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  // -1 = nothing highlighted; only Enter-selects when a row is highlighted so
  // custom typed text isn't clobbered by an accidental Enter.
  const [activeIdx, setActiveIdx] = useState(-1);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setActiveIdx(-1);
  };

  const clear = () => {
    onChange("");
    setActiveIdx(-1);
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      // Only hijack Enter when the user has highlighted a suggestion —
      // otherwise let their typed text stand (and not submit the form here).
      if (open && activeIdx >= 0 && filtered[activeIdx] !== undefined) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={wrapRef} className="relative" style={{ minWidth }}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        className={INPUT_CLS}
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          setOpen(true);
          setActiveIdx(-1);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onKeyDown={handleKey}
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-surface-muted"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
          aria-hidden="true"
        />
      )}

      {open && filtered.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {filtered.map((opt, idx) => {
            const isActive = idx === activeIdx;
            const isSelected = opt === value;
            return (
              <li
                key={opt}
                role="option"
                aria-selected={isSelected}
                className={`cursor-pointer truncate px-3 py-1.5 text-sm ${
                  isActive
                    ? "bg-brand/10 text-brand"
                    : isSelected
                      ? "text-brand"
                      : "text-text-main"
                }`}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
              >
                {opt}
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && value.trim() !== "" && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <li
            role="option"
            aria-selected
            className="cursor-pointer truncate px-3 py-1.5 text-sm text-text-main"
            onMouseDown={(e) => {
              e.preventDefault();
              commit(value.trim());
            }}
          >
            Use “{value.trim()}”
          </li>
        </ul>
      )}
    </div>
  );
}
