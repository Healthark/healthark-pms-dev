const ROLE_STYLES: Record<string, string> = {
  Admin: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  Manager: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  Principal: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  Staff: "bg-surface-hover text-text-muted",
};

interface RoleBadgeProps {
  readonly role: string;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const cls = ROLE_STYLES[role] ?? "bg-surface-hover text-text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {role}
    </span>
  );
}
