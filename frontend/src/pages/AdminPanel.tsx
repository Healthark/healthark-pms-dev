import { lazy, Suspense, useState, useEffect, useRef } from "react";
import {
  UserPlus, Users, Settings, FolderOpen, Plus, Download, Megaphone, KeyRound,
  ClipboardCheck,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
} from "../services/admin.service";
import type { CycleType } from "../services/system-settings.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { ProjectsTab, type ProjectsTabHandle } from "../components/admin/ProjectsTab";
import { CoverageGapBanner } from "../components/admin/CoverageGapBanner";
// UserModal lazy-loaded (F3) — admin-only form, opens on "Add User"
// or per-row pencil click. Split into its own chunk so the AdminPanel
// initial download skips it for non-modal sessions.
const UserModal = lazy(() =>
  import("../components/admin/UserModal").then((m) => ({ default: m.UserModal })),
);
import { ExportsTab } from "../components/admin/ExportsTab";
import { NotifyTab } from "../components/admin/NotifyTab";
import { GoalAccessTab } from "../components/admin/GoalAccessTab";
import { ReviewEligibilityTab } from "../components/admin/ReviewEligibilityTab";
import { canExport } from "../utils/exportEligibility";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../hooks/useAuth";
import { useCreateUser, useUpdateUser } from "../queries/users";
import {
  useAdminSettings,
  useCoverageGaps,
} from "../queries/adminSettings";
import { useDepartments, useDesignations } from "../queries/adminReferenceData";


type ActiveTab =
  | "users"
  | "projects"
  | "notify"
  | "export"
  | "settings"
  | "goal-access"
  | "review-eligibility";

export default function AdminPanel() {
  // ── Reference data (shared cache via ['admin', 'departments|designations']) ─
  const { data: departments = [] } = useDepartments();
  const { data: designations = [] } = useDesignations();

  // ── Coverage gaps (mentor/PM removal impact) — drives the warning banner ─
  const { data: coverageGaps } = useCoverageGaps();
  const orphanedMenteeCount = coverageGaps?.orphaned_mentees.length ?? 0;
  const pmLessProjectCount = coverageGaps?.pm_less_projects.length ?? 0;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [modalError, setModalError] = useState("");

  // Settings form state — local because users edit these; hydrated from
  // the ['admin-settings'] query whenever fresh data arrives.
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);

  const toast = useToast();

  const projectsTabRef = useRef<ProjectsTabHandle>(null);

  const { user } = useAuth();
  // HR-or-management gate for the Export tab + button (backend re-checks).
  const canSeeExport = canExport(user);

  // Active tab lives in the URL (?tab=) so it survives reloads, deep links,
  // and back/forward — matching the Annual Goals / Project Reviews pattern.
  // An unknown tab (or `export` without access) falls back to Users.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: ActiveTab =
    tabParam === "projects"
      ? "projects"
      : tabParam === "notify"
        ? "notify"
        : tabParam === "export" && canSeeExport
          ? "export"
          : tabParam === "settings"
            ? "settings"
            : tabParam === "goal-access"
              ? "goal-access"
              : tabParam === "review-eligibility"
                ? "review-eligibility"
                : "users";
  const setActiveTab = (tab: ActiveTab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };

  // ── User mutations (shared cache via ['users']) ───────────────────────────
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const isSavingUser = createUserMutation.isPending || updateUserMutation.isPending;

  // ── Admin settings (shared cache via ['admin-settings']) ──────────────────
  const { data: adminSettings } = useAdminSettings();

  // Hydrate form fields whenever the query produces a new snapshot — both
  // on initial load and after a mutation refetch.
  useEffect(() => {
    if (!adminSettings) return;
    setCycleType((adminSettings.cycle_type as CycleType) ?? "half_yearly");
    setFiscalStartMonth(adminSettings.fiscal_start_month ?? 4);
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

  // ── Tab style helper ──────────────────────────────────────────────────────
  const tabCls = (tab: ActiveTab) =>
    `flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header — stacks on mobile, row on sm+ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity sm:w-auto"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add User
          </button>
        )}
        {activeTab === "projects" && (
          <button
            type="button"
            onClick={() => projectsTabRef.current?.openCreate()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity sm:w-auto"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Project
          </button>
        )}
      </div>

      {/* Coverage-gap warning — persists while a removed/reassigned mentor or
          PM has left mentees orphaned or a project without a PM. Clears once
          the admin reassigns (the query is invalidated by user/project
          mutations). */}
      <CoverageGapBanner
        menteeCount={orphanedMenteeCount}
        projectCount={pmLessProjectCount}
        onFixMentees={() => setActiveTab("users")}
        onFixProjects={() => setActiveTab("projects")}
      />

      {/* Tab container */}
      {/* No `overflow-hidden` here: it would become the sticky table
          header's scroll container and unstick it on page scroll. The card
          relies on rounded children instead of clipping. */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex overflow-x-auto border-b border-border px-2">
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
            className={tabCls("notify")}
            onClick={() => setActiveTab("notify")}
          >
            <Megaphone className="h-4 w-4" aria-hidden="true" />
            Announcement
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
          <button
            type="button"
            className={tabCls("goal-access")}
            onClick={() => setActiveTab("goal-access")}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Goal Access
          </button>
          <button
            type="button"
            className={tabCls("review-eligibility")}
            onClick={() => setActiveTab("review-eligibility")}
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            Review Eligibility
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

        {activeTab === "notify" && <NotifyTab />}

        {activeTab === "export" && canSeeExport && <ExportsTab />}

        {activeTab === "settings" && (
          <SystemSettingsTab
            activeCycleName={adminSettings?.active_cycle ?? ""}
            cycleType={cycleType}
            fiscalStartMonth={fiscalStartMonth}
          />
        )}

        {activeTab === "goal-access" && <GoalAccessTab />}

        {activeTab === "review-eligibility" && <ReviewEligibilityTab />}
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