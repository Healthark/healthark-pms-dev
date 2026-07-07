import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type {
  UserResponse,
  UserCreatePayload,
  UserUpdatePayload,
  DepartmentBrief,
  DesignationBrief,
} from "../../services/admin.service";
import { UserCombobox } from "../common/UserCombobox";

// UPDATE 1: Restrict available roles to only Admin and Staff
const ROLES = ["Admin", "Staff"] as const;

interface UserModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (
    payload: UserCreatePayload | UserUpdatePayload,
  ) => Promise<void>;
  readonly editingUser: UserResponse | null;
  readonly departments: DepartmentBrief[];
  readonly designations: DesignationBrief[];
  readonly isSaving: boolean;
  readonly error: string;
}

const isActiveUser = (u: UserResponse) => !u.is_deleted;

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

export function UserModal({
  isOpen,
  onClose,
  onSave,
  editingUser,
  departments,
  designations,
  isSaving,
  error,
}: UserModalProps) {
  const isEditing = editingUser !== null;

  const [form, setForm] = useState({
    employee_code: "",
    full_name: "",
    email: "",
    phone: "",
    role: "Staff",
    department_id: "",
    designation_id: "",
    mentor_id: "",
    password: "",
  });

  useEffect(() => {
    if (editingUser) {
      setForm({
        employee_code: editingUser.employee_code,
        full_name: editingUser.full_name,
        email: editingUser.email,
        phone: editingUser.phone ?? "",
        // Ensure legacy roles default back to Staff when editing
        role: ["Admin", "Staff"].includes(editingUser.role) ? editingUser.role : "Staff",
        department_id: editingUser.department_id?.toString() ?? "",
        designation_id: editingUser.designation_id?.toString() ?? "",
        mentor_id: editingUser.mentor_id?.toString() ?? "",
        password: "",
      });
    } else {
      setForm({
        employee_code: "",
        full_name: "",
        email: "",
        phone: "",
        role: "Staff",
        department_id: "",
        designation_id: "",
        mentor_id: "",
        password: "",
      });
    }
  }, [editingUser]);

  // Roles are department-scoped: the designation list narrows to the selected
  // department's roles. With no department chosen yet, all roles are offered
  // (labelled with their department) so the admin can pick role-first; the
  // currently-selected role is always kept in the list so editing never drops
  // it silently. (useMemo must precede the early return — rules of hooks.)
  const selectedDeptId = form.department_id ? Number(form.department_id) : null;
  const availableDesignations = useMemo(() => {
    const currentId = form.designation_id ? Number(form.designation_id) : null;
    const pool = designations.filter(
      (d) =>
        (selectedDeptId != null ? d.department_id === selectedDeptId : true) ||
        d.id === currentId,
    );
    return [...pool].sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name),
    );
  }, [designations, selectedDeptId, form.designation_id]);

  if (!isOpen) return null;

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const deptNameById = (id: number | null | undefined) =>
    departments.find((d) => d.id === id)?.name ?? null;

  // Changing the department drops a now-mismatched role (or any role when the
  // department is cleared) so the saved (department, role) pair stays valid.
  const onDepartmentChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, department_id: value };
      if (prev.designation_id) {
        const desig = designations.find(
          (d) => d.id === Number(prev.designation_id),
        );
        if (!value || (desig && desig.department_id !== Number(value))) {
          next.designation_id = "";
        }
      }
      return next;
    });
  };

  // Picking a role back-fills its department (role → department).
  const onDesignationChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, designation_id: value };
      if (value) {
        const desig = designations.find((d) => d.id === Number(value));
        if (desig?.department_id != null) {
          next.department_id = String(desig.department_id);
        }
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (isEditing) {
      await onSave({
        full_name: form.full_name || undefined,
        phone: form.phone || undefined,
        role: form.role || undefined,
        employee_code: form.employee_code || undefined,
        department_id: form.department_id ? Number(form.department_id) : null,
        designation_id: form.designation_id
          ? Number(form.designation_id)
          : null,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null,
      } satisfies UserUpdatePayload);
    } else {
      await onSave({
        employee_code: form.employee_code,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        department_id: form.department_id ? Number(form.department_id) : null,
        designation_id: form.designation_id
          ? Number(form.designation_id)
          : null,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null,
        password: form.password,
      } satisfies UserCreatePayload);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="user-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit User" : "Add New User"}
          </h2>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="emp-code" className={LABEL_CLS}>
                Employee Code *
              </label>
              <input
                id="emp-code"
                className={INPUT_CLS}
                value={form.employee_code}
                onChange={(e) => set("employee_code", e.target.value)}
                placeholder="EMP-003"
              />
            </div>
            <div>
              <label htmlFor="full-name" className={LABEL_CLS}>
                Full Name *
              </label>
              <input
                id="full-name"
                className={INPUT_CLS}
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className={LABEL_CLS}>
              Email Address *
            </label>
            <input
              id="email"
              type="email"
              className={`${INPUT_CLS} ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@healthark.com"
              readOnly={isEditing}
            />
            {isEditing && (
              <p className="mt-1 text-xs text-text-muted">
                Email cannot be changed after creation.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className={LABEL_CLS}>
                Phone
              </label>
              <input
                id="phone"
                className={INPUT_CLS}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label htmlFor="role" className={LABEL_CLS}>
                System Role *
              </label>
              <select
                id="role"
                className={INPUT_CLS}
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dept" className={LABEL_CLS}>
                Department
              </label>
              <select
                id="dept"
                className={INPUT_CLS}
                value={form.department_id}
                onChange={(e) => onDepartmentChange(e.target.value)}
              >
                <option value="">— None —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="desig" className={LABEL_CLS}>
                Designation
              </label>
              <select
                id="desig"
                className={INPUT_CLS}
                value={form.designation_id}
                onChange={(e) => onDesignationChange(e.target.value)}
              >
                <option value="">— None —</option>
                {availableDesignations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {selectedDeptId == null && d.department_id != null
                      ? ` — ${deptNameById(d.department_id)}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <UserCombobox
            value={form.mentor_id ? Number(form.mentor_id) : null}
            onChange={(id) => set("mentor_id", id !== null ? String(id) : "")}
            label="Assigned Mentor"
            excludeIds={editingUser ? [editingUser.id] : undefined}
            filter={isActiveUser}
          />

          {!isEditing && (
            <div>
              <label htmlFor="password" className={LABEL_CLS}>
                Temporary Password *
              </label>
              <input
                id="password"
                type="password"
                className={INPUT_CLS}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Min. 8 characters"
              />
              <p className="mt-1 text-xs text-text-muted">
                The user should change this after first login.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Add User"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}