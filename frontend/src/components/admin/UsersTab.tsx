import { Search, Pencil, UserX } from "lucide-react";
import type { UserResponse } from "../../services/admin.service";
import { RoleBadge } from "./RoleBadge";
import { StatusBadge } from "./StatusBadge";

interface UsersTabProps {
  readonly users: UserResponse[];
  readonly isLoading: boolean;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onEdit: (user: UserResponse) => void;
  readonly onDeactivate: (user: UserResponse) => void;
}

const TABLE_HEADERS = [
  "Employee",
  "Email",
  "Role",
  "Department",
  "Designation",
  "Status",
  "Actions",
];

export function UsersTab({
  users,
  isLoading,
  searchQuery,
  onSearchChange,
  onEdit,
  onDeactivate,
}: UsersTabProps) {
  const filtered = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.employee_code.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {/* Search bar */}
      <div className="border-b border-border px-5 py-4">
        <div className="relative max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by name, email or code…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search users"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading users…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                {TABLE_HEADERS.map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-text-muted"
                  >
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr
                    key={user.id}
                    className={`transition-colors hover:bg-slate-50 ${user.is_deleted ? "opacity-60" : ""}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-text-main">
                        {user.full_name}
                      </div>
                      <div className="text-xs text-text-muted">
                        {user.employee_code}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.email}
                    </td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.department?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.designation?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge isDeleted={user.is_deleted} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(user)}
                          title="Edit user"
                          className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {!user.is_deleted && (
                          <button
                            type="button"
                            onClick={() => onDeactivate(user)}
                            title="Deactivate user"
                            className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <UserX className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
