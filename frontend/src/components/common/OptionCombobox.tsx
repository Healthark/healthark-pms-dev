/**
 * OptionCombobox.tsx — type-to-filter single-select picker keyed by a numeric
 * value with a separate display label.
 *
 * Same UX + styling as StringCombobox, but the stored value (e.g. a
 * department_id / designation_id) is decoupled from the label (e.g.
 * "Consultant — IDT"), so labels may repeat across options without ambiguity —
 * needed for department-scoped roles where a title appears under many depts.
 *
 * Clearing (the X / emptying the input) emits `null` so callers can map that to
 * "all" / "no filter".
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
  "w-full rounded-lg border border-border bg-surface py-1.5 pl-3 pr-8 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand";

export interface ComboOption {
  readonly value: number;
  readonly label: string;
}

interface OptionComboboxProps {
  readonly id: string;
  readonly options: readonly ComboOption[];
  /** null means "no selection". */
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
  readonly placeholder?: string;
  readonly minWidth?: string;
}

export function OptionCombobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  minWidth = "180px",
}: OptionComboboxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value],
  );

  // Sync the displayed text with the selected label when the parent changes it
  // or the dropdown closes (drop uncommitted typing). Compared during render
  // (avoids the extra pass an effect would cause), mirroring StringCombobox.
  const [lastSeen, setLastSeen] = useState({ label: selectedLabel, open });
  if (lastSeen.label !== selectedLabel || lastSeen.open !== open) {
    setLastSeen({ label: selectedLabel, open });
    if (!open) setQuery(selectedLabel);
  }

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
    const q = query.trim().toLowerCase();
    // No filter when empty OR when the input still shows the selected label
    // (reopened without typing). Typing something different filters.
    if (!q || q === selectedLabel.trim().toLowerCase()) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, selectedLabel]);

  const commit = (opt: ComboOption) => {
    onChange(opt.value);
    setQuery(opt.label);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx] !== undefined) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(selectedLabel);
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
        className={INPUT_CLS}
        placeholder={placeholder}
        value={query}
        onFocus={() => {
          setOpen(true);
          setActiveIdx(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
          if (e.target.value === "") onChange(null);
        }}
        onKeyDown={handleKey}
      />
      {value !== null ? (
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
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`cursor-pointer truncate px-3 py-1.5 text-[13px] ${
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
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-muted shadow-lg">
          No matches.
        </div>
      )}
    </div>
  );
}
