/**
 * Frontend-side mirror of the backend export gate. Returns true when the
 * user is allowed to see/use Excel export affordances. The backend re-
 * enforces this on every route — this helper only controls visibility.
 *
 * Eligibility = is_management OR department.name === "HR" (case-insensitive).
 */
export function canExport(
  user: {
    is_management?: boolean | null;
    department_name?: string | null;
  } | null,
): boolean {
  if (!user) return false;
  if (user.is_management) return true;
  return (user.department_name ?? "").trim().toLowerCase() === "hr";
}
