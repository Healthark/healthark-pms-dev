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

/**
 * Render a 4-digit fiscal start year as the spanning span label.
 *   2026 → "FY 2026-27"
 *   1999 → "FY 1999-00"
 * Used for goal cards/tables that store the FY as a number rather than a token.
 */
export function formatFyYearSpan(year: number): string {
  const next = (year + 1) % 100;
  return `FY ${year}-${next.toString().padStart(2, "0")}`;
}

/**
 * Resolve a cycle/FY token to the 4-digit fiscal start year so it can be
 * compared against `Goal.fy_year` (which is stored as a number).
 *   "FY26-27"   → 2026
 *   "FY26"      → 2026
 *   "FY2026"    → 2026
 *   "H1 FY26-27"→ 2026
 * Returns null when the input has no parseable FY token.
 */
export function fyTokenToStartYear(token: string): number | null {
  const t = extractFyToken(token);
  const span = /^FY(\d{2})-(\d{2})$/i.exec(t);
  if (span) return 2000 + Number(span[1]);
  const single = /^FY(\d{2,4})$/i.exec(t);
  if (!single) return null;
  const digits = single[1];
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}

/**
 * Extract the cadence period prefix from a composite cycle name.
 *   "H1 FY26-27" → "H1"
 *   "Q3 FY26-27" → "Q3"
 *   "FY26-27"    → null   (annual cadence — no period prefix)
 * Returns null when no Q#/H# token is present.
 */
export function extractCyclePeriod(cycleName: string): string | null {
  const tok = cycleName.split(" ").find((t) => /^(Q[1-4]|H[12])$/i.test(t));
  return tok ? tok.toUpperCase() : null;
}

/**
 * Convert a goal's stored cycle stamp ("H1 2026" / "H2 2026" — a half code plus
 * a bare 4-digit fiscal start year) into the canonical HALF label the backend
 * keys per-half settings and goal-access grants on ("H1 FY26-27"). Quarterly
 * stamps fold into halves (Q1-2 → H1, Q3-4 → H2). Returns null when no half or
 * year can be parsed (e.g. a regular goal's null cycle).
 */
export function goalCycleToHalfLabel(cycleName: string | null): string | null {
  if (!cycleName) return null;
  const period = extractCyclePeriod(cycleName);
  if (!period) return null;
  const half = period.startsWith("H")
    ? period
    : period === "Q1" || period === "Q2"
      ? "H1"
      : "H2";
  // The year token is a bare 4-digit fiscal start year ("2026"), not an FY token.
  const yearTok = cycleName.split(" ").find((t) => /^\d{4}$/.test(t));
  if (!yearTok) return null;
  const y = Number(yearTok);
  const a = (y % 100).toString().padStart(2, "0");
  const b = ((y + 1) % 100).toString().padStart(2, "0");
  return `${half} FY${a}-${b}`;
}

/**
 * Order cycle labels newest-first (timeline descending): by fiscal start year
 * desc, then period desc (so H2/Q4 sort before H1/Q1 within the same FY).
 *   ["H1 FY25-26", "H1 FY26-27", "H2 FY25-26"]
 *     → ["H1 FY26-27", "H2 FY25-26", "H1 FY25-26"]
 * Period-less (annual) cycles get period index 0.
 */
export function sortCyclesDesc(cycles: readonly string[]): string[] {
  const key = (c: string): [number, number] => {
    const year = fyTokenToStartYear(c) ?? 0;
    const period = extractCyclePeriod(c);
    const periodIdx = period ? Number(period.slice(1)) || 0 : 0;
    return [year, periodIdx];
  };
  return [...cycles].sort((a, b) => {
    const [ya, pa] = key(a);
    const [yb, pb] = key(b);
    return yb - ya || pb - pa;
  });
}
