/**
 * Fiscal-year label helpers for the Annual Review surfaces.
 *
 * Annual reviews are strictly yearly — a mentee has one review per fiscal
 * year regardless of whether the org's active cycle is half-yearly or
 * quarterly. The stored cycle_name is a bare FY label like "FY26", but some
 * older rows or seed data may still carry "H1 FY26" / "Q2 FY26" forms, so
 * the parser tolerates both.
 */

/** "FY26" or "H1 FY26" → "FY26"; returns the original if no FY token. */
export function extractFyToken(cycleName: string): string {
  return (
    cycleName.split(" ").find((t) => t.toUpperCase().startsWith("FY")) ??
    cycleName
  );
}

/** "FY26" → "FY 2026". Falls back to the input when not parseable. */
export function formatFyLabel(cycleName: string): string {
  const token = extractFyToken(cycleName);
  const m = /^FY(\d{2,4})$/i.exec(token);
  if (!m) return cycleName;
  const digits = m[1];
  const year = digits.length === 2 ? `20${digits}` : digits;
  return `FY ${year}`;
}
