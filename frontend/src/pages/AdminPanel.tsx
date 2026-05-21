import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserPlus, Users, Settings, FolderOpen, Plus, Download,
} from "lucide-react";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type DepartmentBrief,
  type DesignationBrief,
  type SystemSettings,
  type AdminSettingsUpdatePayload,
} from "../services/admin.service";
import type { CycleType } from "../services/system-settings.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { ProjectsTab, type ProjectsTabHandle } from "../components/admin/ProjectsTab";
import { UserModal } from "../components/admin/UserModal";
import { ExportsTab } from "../components/admin/ExportsTab";
import { canExport } from "../utils/exportEligibility";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useToast } from "../hooks/useToast";
import { useSnackbar } from "../hooks/useSnackbar";
import { useAuth } from "../hooks/useAuth";
import { useCreateUser, useUpdateUser } from "../queries/users";


type ActiveTab =
  | "users"
  | "projects"
  | "export"
  | "settings";

export default function AdminPanel() {
  // ── Reference data + settings (still local — not shared cross-page) ───────
  const [departments, setDepartments] = useState<DepartmentBrief[]>([]);
  const [designations, setDesignations] = useState<DesignationBrief[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [modalError, setModalError] = useState("");

  // Settings form state
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const [annualReviewsEnabled, setAnnualReviewsEnabled] = useState(false);
  const [annualGoalsEditEnabled, setAnnualGoalsEditEnabled] = useState(false);
  const [projectRatingsVisible, setProjectRatingsVisible] = useState(false);
  const [annualReviewFinalRatingVisible, setAnnualReviewFinalRatingVisible] = useState(false);

  const { refreshSettings } = useSystemSettings();
  const toast = useToast();
  const snackbar = useSnackbar();

  const projectsTabRef = useRef<ProjectsTabHandle>(null);

  const { user } = useAuth();
  // HR-or-management gate for the Export tab + button (backend re-checks).
  const canSeeExport = canExport(user);

  // ── User mutations (shared cache via ['users']) ───────────────────────────
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const isSavingUser = createUserMutation.isPending || updateUserMutation.isPending;

  // ── Bootstrap (reference data + settings only — users come from useUsers) ─
  const loadData = useCallback(async () => {
    try {
      const [deptData, desigData, settingsData] = await Promise.all([
        adminService.getDepartments(),
        adminService.getDesignations(),
        adminService.getSettings(),
      ]);
      setDepartments(deptData);
      setDesignations(desigData);
      setSettings(settingsData);
      setCycleType((settingsData.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(settingsData.fiscal_start_month ?? 4);
      setAnnualReviewsEnabled(settingsData.annual_reviews_enabled ?? false);
      setAnnualGoalsEditEnabled(settingsData.annual_goals_edit_enabled ?? false);
      setProjectRatingsVisible(settingsData.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(settingsData.annual_review_final_rating_visible ?? false);
    } catch {
      // Errors handled per-operation below
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    setModalError("");
    try {
      if (editingUser) {
        const updated = await updateUserMutation.mutateAsync({
          userId: editingUser.id,
          payload: payload as UserUpdatePayload,
        });
        closeUserModal();
        toast.success(`${updated.full_name} updated.`);
      } else {
        const created = await createUserMutation.mutateAsync(
          payload as UserCreatePayload,
        );
        closeUserModal();
        toast.success(`${created.full_name} created.`);
      }
    } catch (err) {
      setModalError(getErrorMessage(err));
    }
  };

  // ── Settings handler ──────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const payload: AdminSettingsUpdatePayload = {
        cycle_type: cycleType,
        fiscal_start_month: fiscalStartMonth,
        annual_reviews_enabled: annualReviewsEnabled,
        annual_goals_edit_enabled: annualGoalsEditEnabled,
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
      setAnnualGoalsEditEnabled(fresh.annual_goals_edit_enabled ?? false);
      setProjectRatingsVisible(fresh.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(fresh.annual_review_final_rating_visible ?? false);
      await refreshSettings();
      toast.success("Configuration saved.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ── Tab style helper ──────────────────────────────────────────────────────
  const tabCls = (tab: ActiveTab) =>
    `flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
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
        {activeTab === "projects" && (
          <button
            type="button"
            onClick={() => projectsTabRef.current?.openCreate()}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Project
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
          {canSeeExport && (
            <button
              type="button"
              className={tabCls("export")}
              onClick={() => setActiveTab("export")}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export
            </button>
          )}
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
            departments={departments}
            designations={designations}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onEdit={openEditModal}
          />
        )}

        {activeTab === "projects" && <ProjectsTab ref={projectsTabRef} />}

        {activeTab === "export" && canSeeExport && <ExportsTab />}

        {activeTab === "settings" && (
          <SystemSettingsTab
            activeCycleName={settings?.active_cycle ?? ""}
            cycleType={cycleType}
            fiscalStartMonth={fiscalStartMonth}
            annualReviewsEnabled={annualReviewsEnabled}
            onAnnualReviewsEnabledChange={setAnnualReviewsEnabled}
            annualGoalsEditEnabled={annualGoalsEditEnabled}
            onAnnualGoalsEditEnabledChange={setAnnualGoalsEditEnabled}
            projectRatingsVisible={projectRatingsVisible}
            onProjectRatingsVisibleChange={setProjectRatingsVisible}
            annualReviewFinalRatingVisible={annualReviewFinalRatingVisible}
            onAnnualReviewFinalRatingVisibleChange={setAnnualReviewFinalRatingVisible}
            onSave={handleSaveSettings}
            isSaving={isSavingSettings}
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
        isSaving={isSavingUser}
        error={modalError}
      />

    </div>
  );
}