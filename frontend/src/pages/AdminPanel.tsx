import { useState, useEffect, useCallback } from "react";
import { UserPlus, Users, Settings, FolderOpen, BarChart2 } from "lucide-react";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type DepartmentBrief,
  type DesignationBrief,
  type SystemSettings,
  type AdminSettingsUpdatePayload,
  type PasswordResetResponse,
} from "../services/admin.service";
import type { CycleType } from "../services/system-settings.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { ProjectsTab } from "../components/admin/ProjectsTab";
import { UserModal } from "../components/admin/UserModal";
import { DeactivateModal } from "../components/admin/DeactivateModal";
import { ReactivateModal } from "../components/admin/ReactivateModal";
import { ResetPasswordModal } from "../components/admin/ResetPasswordModal";
import { ManagementTab } from "../components/project-reviews/ManagementTab";
import { useSystemSettings } from "../hooks/useSystemSettings";


type ActiveTab = "users" | "projects" | "reviews" | "settings";

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
  const [reactivateTarget, setReactivateTarget] = useState<UserResponse | null>(
    null,
  );
  const [resetTarget, setResetTarget] = useState<UserResponse | null>(null);
  const [resetResult, setResetResult] = useState<PasswordResetResponse | null>(
    null,
  );
  const [resetError, setResetError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState("");

  // Settings form state
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const [annualReviewsEnabled, setAnnualReviewsEnabled] = useState(false);
  const [yearlyGoalsEditEnabled, setYearlyGoalsEditEnabled] = useState(false);
  const [finalRatingVisible, setFinalRatingVisible] = useState(false);
  const [projectRatingsVisible, setProjectRatingsVisible] = useState(false);
  const [annualReviewFinalRatingVisible, setAnnualReviewFinalRatingVisible] = useState(false);

  const { refreshSettings } = useSystemSettings();
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
      setCycleType((settingsData.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(settingsData.fiscal_start_month ?? 4);
      setAnnualReviewsEnabled(settingsData.annual_reviews_enabled ?? false);
      setYearlyGoalsEditEnabled(settingsData.yearly_goals_edit_enabled ?? false);
      setFinalRatingVisible(settingsData.yearly_goals_final_rating_visible ?? false);
      setProjectRatingsVisible(settingsData.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(settingsData.annual_review_final_rating_visible ?? false);
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

  const openResetModal = (u: UserResponse) => {
    setResetTarget(u);
    setResetResult(null);
    setResetError("");
  };
  const closeResetModal = () => {
    setResetTarget(null);
    setResetResult(null);
    setResetError("");
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setIsSaving(true);
    setResetError("");
    try {
      const result = await adminService.resetUserPassword(resetTarget.id);
      setResetResult(result);
    } catch (err) {
      setResetError(getErrorMessage(err));
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

  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setIsSaving(true);
    try {
      const updated = await adminService.reactivateUser(reactivateTarget.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setReactivateTarget(null);
    } catch {
      // Modal stays open — user can retry
    } finally {
      setIsSaving(false);
    }
  };

  // ── Settings handler ──────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSettingsSaveError("");
    try {
      const payload: AdminSettingsUpdatePayload = {
        cycle_type: cycleType,
        fiscal_start_month: fiscalStartMonth,
        annual_reviews_enabled: annualReviewsEnabled,
        yearly_goals_edit_enabled: yearlyGoalsEditEnabled,
        yearly_goals_final_rating_visible: finalRatingVisible,
        project_ratings_visible: projectRatingsVisible,
        annual_review_final_rating_visible: annualReviewFinalRatingVisible,
      };
      await adminService.updateSettings(payload);
      // Re-fetch from DB so local state always reflects what was actually persisted.
      const fresh = await adminService.getSettings();
      setSettings(fresh);
      setCycleType((fresh.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(fresh.fiscal_start_month ?? 4);
      setAnnualReviewsEnabled(fresh.annual_reviews_enabled ?? false);
      setYearlyGoalsEditEnabled(fresh.yearly_goals_edit_enabled ?? false);
      setFinalRatingVisible(fresh.yearly_goals_final_rating_visible ?? false);
      setProjectRatingsVisible(fresh.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(fresh.annual_review_final_rating_visible ?? false);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
      await refreshSettings();
    } catch (err) {
      setSettingsSaveError(getErrorMessage(err));
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
            Manage users, projects, and system configuration for your organization.
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
            className={tabCls("projects")}
            onClick={() => setActiveTab("projects")}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Projects
          </button>
          <button
            type="button"
            className={tabCls("reviews")}
            onClick={() => setActiveTab("reviews")}
          >
            <BarChart2 className="h-4 w-4" aria-hidden="true" />
            Reviews
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
            onReactivate={setReactivateTarget}
            onResetPassword={openResetModal}
          />
        )}

        {activeTab === "projects" && <ProjectsTab />}

        {activeTab === "reviews" && (
          <div className="p-5">
            <ManagementTab />
          </div>
        )}

        {activeTab === "settings" && (
          <SystemSettingsTab
            activeCycleName={settings?.active_cycle ?? ""}
            cycleType={cycleType}
            onCycleTypeChange={setCycleType}
            fiscalStartMonth={fiscalStartMonth}
            onFiscalStartMonthChange={setFiscalStartMonth}
            annualReviewsEnabled={annualReviewsEnabled}
            onAnnualReviewsEnabledChange={setAnnualReviewsEnabled}
            yearlyGoalsEditEnabled={yearlyGoalsEditEnabled}
            onYearlyGoalsEditEnabledChange={setYearlyGoalsEditEnabled}
            finalRatingVisible={finalRatingVisible}
            onFinalRatingVisibleChange={setFinalRatingVisible}
            projectRatingsVisible={projectRatingsVisible}
            onProjectRatingsVisibleChange={setProjectRatingsVisible}
            annualReviewFinalRatingVisible={annualReviewFinalRatingVisible}
            onAnnualReviewFinalRatingVisibleChange={setAnnualReviewFinalRatingVisible}
            onSave={handleSaveSettings}
            isSaving={isSaving}
            settingsSaved={settingsSaved}
            saveError={settingsSaveError}
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

      {reactivateTarget && (
        <ReactivateModal
          user={reactivateTarget}
          onConfirm={handleReactivate}
          onClose={() => setReactivateTarget(null)}
          isSaving={isSaving}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onConfirm={handleResetPassword}
          onClose={closeResetModal}
          isSaving={isSaving}
          error={resetError}
          result={resetResult}
        />
      )}
    </div>
  );
}