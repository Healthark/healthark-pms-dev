import { lazy, Suspense, useState, useEffect, useRef } from "react";
import {
  UserPlus, Users, Settings, FolderOpen, Plus, Download,
} from "lucide-react";

import {
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type AdminSettingsUpdatePayload,
} from "../services/admin.service";
import type { CycleType } from "../services/system-settings.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { ProjectsTab, type ProjectsTabHandle } from "../components/admin/ProjectsTab";
// UserModal lazy-loaded (F3) — admin-only form, opens on "Add User"
// or per-row pencil click. Split into its own chunk so the AdminPanel
// initial download skips it for non-modal sessions.
const UserModal = lazy(() =>
  import("../components/admin/UserModal").then((m) => ({ default: m.UserModal })),
);
import { ExportsTab } from "../components/admin/ExportsTab";
import { canExport } from "../utils/exportEligibility";
import { useToast } from "../hooks/useToast";
import { useSnackbar } from "../hooks/useSnackbar";
import { useAuth } from "../hooks/useAuth";
import { useCreateUser, useUpdateUser } from "../queries/users";
import { useAdminSettings, useUpdateAdminSettings } from "../queries/adminSettings";
import { useDepartments, useDesignations } from "../queries/adminReferenceData";


type ActiveTab =
  | "users"
  | "projects"
  | "export"
  | "settings";

export default function AdminPanel() {
  // ── Reference data (shared cache via ['admin', 'departments|designations']) ─
  const { data: departments = [] } = useDepartments();
  const { data: designations = [] } = useDesignations();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [modalError, setModalError] = useState("");

  // Settings form state — local because users edit these; hydrated from
  // the ['admin-settings'] query whenever fresh data arrives.
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const [annualReviewsEnabled, setAnnualReviewsEnabled] = useState(false);
  const [annualGoalsEditEnabled, setAnnualGoalsEditEnabled] = useState(false);
  const [projectRatingsVisible, setProjectRatingsVisible] = useState(false);
  const [annualReviewFinalRatingVisible, setAnnualReviewFinalRatingVisible] = useState(false);
  // Dev/QA date simulation. simulatedToday is an ISO date string (or empty
  // when unset). simulationAllowed mirrors the backend's env flag so the
  // field hides itself outside dev/staging.
  const [simulatedToday, setSimulatedToday] = useState<string>("");
  // Tracks whether the next save should send `clear_simulated_today` —
  // set when the admin clicks Clear so the PATCH explicitly drops the
  // stored value (PATCH semantics treat omission as "leave unchanged").
  const [clearSimulatedTodayPending, setClearSimulatedTodayPending] = useState(false);

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

  // ── Admin settings (shared cache via ['admin-settings']) ──────────────────
  const { data: adminSettings } = useAdminSettings();
  const updateAdminSettingsMutation = useUpdateAdminSettings();
  const isSavingSettings = updateAdminSettingsMutation.isPending;

  // Hydrate form fields whenever the query produces a new snapshot — both
  // on initial load and after a mutation refetch.
  useEffect(() => {
    if (!adminSettings) return;
    setCycleType((adminSettings.cycle_type as CycleType) ?? "half_yearly");
    setFiscalStartMonth(adminSettings.fiscal_start_month ?? 4);
    setAnnualReviewsEnabled(adminSettings.annual_reviews_enabled ?? false);
    setAnnualGoalsEditEnabled(adminSettings.annual_goals_edit_enabled ?? false);
    setProjectRatingsVisible(adminSettings.project_ratings_visible ?? false);
    setAnnualReviewFinalRatingVisible(adminSettings.annual_review_final_rating_visible ?? false);
    setSimulatedToday(adminSettings.simulated_today ?? "");
    setClearSimulatedTodayPending(false);
  }, [adminSettings]);

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
  // The mutation invalidates both ['admin-settings'] and ['system-settings'],
  // so the form re-hydrates via the useEffect above and every consumer of
  // useSystemSettings() picks up the new value on its next render.
  const handleSaveSettings = async () => {
    const payload: AdminSettingsUpdatePayload = {
      cycle_type: cycleType,
      fiscal_start_month: fiscalStartMonth,
      annual_reviews_enabled: annualReviewsEnabled,
      annual_goals_edit_enabled: annualGoalsEditEnabled,
      project_ratings_visible: projectRatingsVisible,
      annual_review_final_rating_visible: annualReviewFinalRatingVisible,
    };
    // Date simulation: clear wins, otherwise set if a value is present.
    // Omitting both leaves the column untouched on the backend.
    if (clearSimulatedTodayPending) {
      payload.clear_simulated_today = true;
    } else if (simulatedToday) {
      payload.simulated_today = simulatedToday;
    }
    try {
      await updateAdminSettingsMutation.mutateAsync(payload);
      toast.success("Configuration saved.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleClearSimulatedToday = () => {
    setSimulatedToday("");
    setClearSimulatedTodayPending(true);
  };

  const handleSimulatedTodayChange = (value: string) => {
    setSimulatedToday(value);
    setClearSimulatedTodayPending(false);
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
            activeCycleName={adminSettings?.active_cycle ?? ""}
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
            simulatedToday={simulatedToday}
            simulationAllowed={adminSettings?.simulation_allowed ?? false}
            onSimulatedTodayChange={handleSimulatedTodayChange}
            onClearSimulatedToday={handleClearSimulatedToday}
            onSave={handleSaveSettings}
            isSaving={isSavingSettings}
          />
        )}
      </div>

      {/* Modals — rendered outside the card so they overlay the full page.
          Lazy-wrapped so the modal chunk only downloads on first open. */}
      <Suspense fallback={null}>
        {showUserModal && (
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
        )}
      </Suspense>

    </div>
  );
}