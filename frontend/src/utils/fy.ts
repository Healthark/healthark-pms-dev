/**
 * Fiscal-year label helpers for the Annual Review surfaces.
 *
 * Annual reviews are strictly yearly — a mentee has one review per fiscal
 * year regardless of whether the org's active cycle is half-yearly or
 * quarterly. The canonical stored token is the spanning form like "FY26-27"
 * (FY 2026 starts April 2026 and runs through March 2027). Older rows and
 * seed data may still carry the bare "FY26" or composite "H1 FY26" forms,
 * so the parser tolerates all three.
 */

/** "FY26-27", "H1 FY26-27", or "FY26" → "FY26-27" / "FY26"; falls back to the input. */
export function extractFyToken(cycleName: string): string {
  return (
    cycleName.split(" ").find((t) => t.toUpperCase().startsWith("FY")) ??
    cycleName
  );
}

/**
 * Render a cycle name as a human-readable FY label.
 *   "FY26-27"     → "FY 2026-27"
 *   "H1 FY26-27"  → "FY 2026-27"
 *   "FY26"        → "FY 2026"     (legacy 2-digit form)
 *   "FY2026"      → "FY 2026"     (legacy 4-digit form)
 * Falls back to the input when no FY token is parseable.
 */
export function formatFyLabel(cycleName: string): string {
  const token = extractFyToken(cycleName);
  // New spanning form: "FY26-27"
  const span = /^FY(\d{2})-(\d{2})$/i.exec(token);
  if (span) {
    return `FY 20${span[1]}-${span[2]}`;
  }
  // Legacy bare form: "FY26" or "FY2026"
  const m = /^FY(\d{2,4})$/i.exec(token);
  if (!m) return cycleName;
  const digits = m[1];
  const year = digits.length === 2 ? `20${digits}` : digits;
  return `FY ${year}`;
}
