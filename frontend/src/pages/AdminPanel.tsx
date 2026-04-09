import { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, Settings } from "lucide-react";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type DepartmentBrief,
  type DesignationBrief,
  type SystemSettings,
} from "../services/admin.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { UserModal } from "../components/admin/UserModal";
import { DeactivateModal } from "../components/admin/DeactivateModal";

type ActiveTab = "users" | "settings";

export default function AdminPanel() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentBrief[]>([]);
  const [designations, setDesignations] = useState<DesignationBrief[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserResponse | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [cycleInput, setCycleInput] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersData, deptData, desigData, settingsData] = await Promise.all([
        adminService.getUsers(),
        adminService.getDepartments(),
        adminService.getDesignations(),
        adminService.getSettings(),
      ]);
      setUsers(usersData);
      setDepartments(deptData);
      setDesignations(desigData);
      setSettings(settingsData);
      setCycleInput(settingsData.active_cycle ?? "");
    } catch {
      // Errors handled per-operation below
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const mentorOptions = users.filter(
    (u) => !u.is_deleted && ["Admin", "Manager", "Principal"].includes(u.role),
  );

  // ── User handlers ─────────────────────────────────────────────────────────
  const openAddModal = () => {
    setEditingUser(null);
    setModalError("");
    setShowUserModal(true);
  };
  const openEditModal = (u: UserResponse) => {
    setEditingUser(u);
    setModalError("");
    setShowUserModal(true);
  };
  const closeUserModal = () => {
    setShowUserModal(false);
    setEditingUser(null);
    setModalError("");
  };

  const handleSaveUser = async (
    payload: UserCreatePayload | UserUpdatePayload,
  ) => {
    setIsSaving(true);
    setModalError("");
    try {
      if (editingUser) {
        const updated = await adminService.updateUser(
          editingUser.id,
          payload as UserUpdatePayload,
        );
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? updated : u)),
        );
      } else {
        const created = await adminService.createUser(
          payload as UserCreatePayload,
        );
        setUsers((prev) => [created, ...prev]);
      }
      closeUserModal();
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setIsSaving(true);
    try {
      await adminService.deactivateUser(deactivateTarget.id);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === deactivateTarget.id ? { ...u, is_deleted: true } : u,
        ),
      );
      setDeactivateTarget(null);
    } catch {
      // Modal stays open — user can retry
    } finally {
      setIsSaving(false);
    }
  };

  // ── Settings handler ──────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const updated = await adminService.updateSettings(cycleInput);
      setSettings(updated);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch {
      // no-op — button re-enables
    } finally {
      setIsSaving(false);
    }
  };

  // ── Tab style helper ──────────────────────────────────────────────────────
  const tabCls = (tab: ActiveTab) =>
    `flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Admin Panel
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Manage users and system configuration for your organization.
          </p>
        </div>
        {activeTab === "users" && (
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add User
          </button>
        )}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("users")}
            onClick={() => setActiveTab("users")}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Users
          </button>
          <button
            type="button"
            className={tabCls("settings")}
            onClick={() => setActiveTab("settings")}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            System Settings
          </button>
        </div>

        {activeTab === "users" && (
          <UsersTab
            users={users}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onEdit={openEditModal}
            onDeactivate={setDeactivateTarget}
          />
        )}

        {activeTab === "settings" && (
          <SystemSettingsTab
            cycleInput={cycleInput}
            onCycleInputChange={setCycleInput}
            onSave={handleSaveSettings}
            isSaving={isSaving}
            settingsSaved={settingsSaved}
            savedCycleName={settings?.active_cycle ?? null}
          />
        )}
      </div>

      {/* Modals — rendered outside the card so they overlay the full page */}
      <UserModal
        isOpen={showUserModal}
        onClose={closeUserModal}
        onSave={handleSaveUser}
        editingUser={editingUser}
        departments={departments}
        designations={designations}
        managers={mentorOptions}
        isSaving={isSaving}
        error={modalError}
      />

      {deactivateTarget && (
        <DeactivateModal
          user={deactivateTarget}
          onConfirm={handleDeactivate}
          onClose={() => setDeactivateTarget(null)}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
