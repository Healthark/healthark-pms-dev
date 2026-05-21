# Frontend Optimization Audit — Phase A Baseline

> Findings only. No recommendations. Generated 2026-05-15.

## 1. Stack baseline

- **Bundler:** Vite 8.0.4 ([frontend/package.json:33](../../frontend/package.json#L33))
- **Router:** react-router-dom 7.14.0 ([frontend/package.json:18](../../frontend/package.json#L18)) — uses the component-based `<BrowserRouter>` + `<Routes>` API, not `createBrowserRouter` ([frontend/src/App.tsx:87](../../frontend/src/App.tsx#L87))
- **React:** 19.2.4 ([frontend/package.json:16](../../frontend/package.json#L16))
- **HTTP:** axios 1.14.0 ([frontend/package.json:14](../../frontend/package.json#L14)) — single shared client at [frontend/src/services/api.client.ts:15](../../frontend/src/services/api.client.ts#L15) with CSRF + HttpOnly cookie handling and global 401/403 → `/login` interceptor.

**From the target dependency list, currently installed:** axios only. **Not installed:** `@tanstack/react-query`, `@tanstack/react-virtual`, `react-window`, `react-virtualized`, `swr`.

**QueryClientProvider:** None found anywhere in the codebase.

**Query-key conventions:** None — no shared key factory, no ad-hoc string keys, no central caching layer. Every fetch site stores results in local `useState` and refetches by re-running effects or by parent components calling refetch closures.

---

## 2. Build & bundle baseline

**Vite config** ([frontend/vite.config.ts](../../frontend/vite.config.ts)) is minimal:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

- `build.rollupOptions.output.manualChunks`: **not set**
- Bundle analyzer plugin (`rollup-plugin-visualizer` or similar): **not wired**
- `chunkSizeWarningLimit`: **default** (500 KB)
- No other build-relevant config.

**Route lazy-loading:** 0 of 15 routes lazy. All page components are eagerly imported at the top of [frontend/src/App.tsx:11-25](../../frontend/src/App.tsx#L11-L25). No `React.lazy`, no dynamic `import()` anywhere in `src/`.

**Bundle sizes (production `npm run build`, vite 8.0.8, 1904 modules):**

| Asset | Raw | Gzip |
|---|---|---|
| `dist/assets/index-*.js` | 677.78 kB | 168.48 kB |
| `dist/assets/index-*.css` | 55.29 kB | 10.23 kB |
| `dist/index.html` | 0.48 kB | 0.31 kB |
| **Total** | **~733.55 kB** | **~179.02 kB** |

There are only **3 emitted assets** — no chunking is happening. The entire app (every page, every modal, every admin tab, every service) lives in a single `index-*.js`. Build also emitted Vite's own warning:

> `(!) Some chunks are larger than 500 kB after minification. Consider: Using dynamic import() to code-split the application`

So "top 10 chunks" doesn't apply — there's effectively 1 JS chunk. Code-splitting will create that chunk hierarchy from scratch.

---

## 3. Server-state inventory

**Total fetch sites identified: ~65+** across pages, hooks, contexts, and components. Grouped below by route. See section 6 for cross-page domain ownership.

### 3a. `useEffect(() => { ... }, [])` (fetch-on-mount)

| File:line | What it fetches |
|---|---|
| [AuthProvider.tsx:108](../../frontend/src/contexts/AuthProvider.tsx#L108) | `authService.refreshSession()` — bootstrap |
| [SystemSettingsProvider.tsx:86](../../frontend/src/contexts/SystemSettingsProvider.tsx#L86) | `systemSettingsService.getSettings()` — bootstrap |
| [Dashboard.tsx:60](../../frontend/src/pages/Dashboard.tsx#L60) | `dashboardService.getSummary()` |
| [AnnualGoals.tsx:207](../../frontend/src/pages/AnnualGoals.tsx#L207) | `goalService.getMyGoals()` |
| [AnnualReviews.tsx:65](../../frontend/src/pages/AnnualReviews.tsx#L65) | annual review list |
| [ProjectReviews.tsx:122](../../frontend/src/pages/ProjectReviews.tsx#L122) | `projectReviewService.getMyProjects()` |
| [MyMentees.tsx:58](../../frontend/src/pages/MyMentees.tsx#L58) | `menteeService.getSummaries()` |
| [Feedback360.tsx:118](../../frontend/src/pages/Feedback360.tsx#L118) | `feedback360Service.getPeers()` |
| [AdminPanel.tsx:98](../../frontend/src/pages/AdminPanel.tsx#L98) | admin tab loads |
| [Profile.tsx:10](../../frontend/src/pages/Profile.tsx#L10) | `profileService.getProfile()` |
| [NotificationDropdown.tsx:42](../../frontend/src/components/layout/NotificationDropdown.tsx#L42) | notifications bootstrap |

### 3b. `useEffect(..., [deps])` (refetch on dependency change)

| File:line | Deps | What |
|---|---|---|
| [AuthProvider.tsx:142](../../frontend/src/contexts/AuthProvider.tsx#L142) | `[user?.org_id]` | theme setup on user load |
| [AnnualGoals.tsx:233](../../frontend/src/pages/AnnualGoals.tsx#L233) | `[activeTab, filters]` | goals tab/filter refetch |
| [Feedback360.tsx:206](../../frontend/src/pages/Feedback360.tsx#L206) | `[selectedPeerId]` | peer detail |
| [Feedback360.tsx:280](../../frontend/src/pages/Feedback360.tsx#L280) | `[selectedPeerId]` | aggregate data |
| [useReviewDetails.ts:59](../../frontend/src/hooks/useReviewDetails.ts#L59) | `[reviewId]` | project review detail expansion |
| [NotificationDropdown.tsx:53](../../frontend/src/components/layout/NotificationDropdown.tsx#L53) | polling interval | notifications poll |
| [UserCombobox.tsx:68](../../frontend/src/components/common/UserCombobox.tsx#L68) | search query | user autocomplete |
| [UserCombobox.tsx:73](../../frontend/src/components/common/UserCombobox.tsx#L73) | debounced query | user search refetch |

### 3c. Custom hooks wrapping fetch

Only one hook actually fetches data — the rest are context consumers:

- [useReviewDetails.ts](../../frontend/src/hooks/useReviewDetails.ts) — fetches expanded project-review details via reducer; consumers: row-expanders in [ProjectReviews.tsx](../../frontend/src/pages/ProjectReviews.tsx) and [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx).
- [useAuth.ts](../../frontend/src/hooks/useAuth.ts) — consumer of `AuthProvider` context; no direct fetch.
- [useSystemSettings.ts](../../frontend/src/hooks/useSystemSettings.ts) — consumer of `SystemSettingsProvider` context; no direct fetch.

Other hooks ([useConfirm.ts](../../frontend/src/hooks/useConfirm.ts), [useSidebar.ts](../../frontend/src/hooks/useSidebar.ts), [useSnackbar.ts](../../frontend/src/hooks/useSnackbar.ts), [useToast.ts](../../frontend/src/hooks/useToast.ts), [usePageTitleOverride.ts](../../frontend/src/hooks/usePageTitleOverride.ts)) handle UI state only.

### 3d. Direct service calls in event handlers (no caching layer)

| File:line | Trigger |
|---|---|
| [GoalFormModal.tsx:109](../../frontend/src/components/goals/GoalFormModal.tsx#L109) | onSave → `goalService.createGoal/updateGoal` |
| [EvalForm.tsx:139](../../frontend/src/components/reviews/EvalForm.tsx#L139) | onSubmit → `annualReviewService.submitMentorEval` |
| [EvalForm.tsx:148](../../frontend/src/components/reviews/EvalForm.tsx#L148) | draft handler → `saveMentorDraft` |
| [ProjectsTab.tsx:146](../../frontend/src/components/admin/ProjectsTab.tsx#L146) | delete → `projectService.deleteProject` |
| [GoalSelfReviewModal.tsx:131](../../frontend/src/components/goals/GoalSelfReviewModal.tsx#L131) | submit → `goalService.submitSelfReview` |
| [BulkApproveModal.tsx:97](../../frontend/src/components/goals/BulkApproveModal.tsx#L97) | bulk approve |
| [FeedbackGive.tsx:52](../../frontend/src/pages/FeedbackGive.tsx#L52) | submit feedback |
| [PasswordChangeCard.tsx](../../frontend/src/components/profile/PasswordChangeCard.tsx) | password change |
| [ExportExcelButton.tsx](../../frontend/src/components/exports/ExportExcelButton.tsx) | export downloads (blob — won't fit `query.data`) |

### 3e. Service layer

Each service file maps to a domain. Endpoints summarized in section 6.

- [auth.service.ts](../../frontend/src/services/auth.service.ts)
- [goal.service.ts](../../frontend/src/services/goal.service.ts)
- [annual-review.service.ts](../../frontend/src/services/annual-review.service.ts)
- [project-review.service.ts](../../frontend/src/services/project-review.service.ts)
- [admin.service.ts](../../frontend/src/services/admin.service.ts)
- [feedback360.service.ts](../../frontend/src/services/feedback360.service.ts)
- [project.service.ts](../../frontend/src/services/project.service.ts)
- [export.service.ts](../../frontend/src/services/export.service.ts)
- [dashboard.service.ts](../../frontend/src/services/dashboard.service.ts)
- [mentee.service.ts](../../frontend/src/services/mentee.service.ts)
- [profile.service.ts](../../frontend/src/services/profile.service.ts)
- [notification.service.ts](../../frontend/src/services/notification.service.ts)
- [system-settings.service.ts](../../frontend/src/services/system-settings.service.ts)

### 3f. Fetch sites grouped by owning route

| Route | Page file | Fetches |
|---|---|---|
| `/dashboard` | [Dashboard.tsx](../../frontend/src/pages/Dashboard.tsx) | summary + per-widget detail |
| `/annual-goals` | [AnnualGoals.tsx](../../frontend/src/pages/AnnualGoals.tsx) | my-goals, team-goals (tab), filters |
| `/annual-reviews` | [AnnualReviews.tsx](../../frontend/src/pages/AnnualReviews.tsx) | self/mentor/mgmt review tabs |
| `/management-reviews` | [ManagementReviews.tsx](../../frontend/src/pages/ManagementReviews.tsx) | calibration grid |
| `/admin` | [AdminPanel.tsx](../../frontend/src/pages/AdminPanel.tsx) | per-tab (Users, Projects, Exports, Settings, Management) |
| `/project-reviews` | [ProjectReviews.tsx](../../frontend/src/pages/ProjectReviews.tsx) | my-projects + PM queue + secondary + per-row detail |
| `/profile` | [Profile.tsx](../../frontend/src/pages/Profile.tsx) | profile + expectations |
| `/my-mentees` | [MyMentees.tsx](../../frontend/src/pages/MyMentees.tsx) | summaries |
| `/my-mentees/:id` | [MenteeDetail.tsx](../../frontend/src/pages/MenteeDetail.tsx) | detail + nested tabs (goals/reviews/projects) |
| `/feedback` | [Feedback360.tsx](../../frontend/src/pages/Feedback360.tsx) | peers + aggregate |
| `/feedback/give/:id` | [FeedbackGive.tsx](../../frontend/src/pages/FeedbackGive.tsx) | my-review + submit |

---

## 4. List / table / grid inventory

**Existing virtualization:** None found. Confirmed absent in [frontend/package.json](../../frontend/package.json) and across all imports.

| File:line | Iterates | Typical row count | Row height | Virtualized? |
|---|---|---|---|---|
| [UsersTab.tsx:248](../../frontend/src/components/admin/UsersTab.tsx#L248) | `visibleUsers.map()` | 5–200+ org-wide | fixed (`py-3.5`) | no |
| [ProjectsTab.tsx:397](../../frontend/src/components/admin/ProjectsTab.tsx#L397) | `visibleProjects.map()` | 5–100+ | fixed (`py-3.5`) | no |
| [PeerList.tsx:130](../../frontend/src/components/feedback360/PeerList.tsx#L130) | `filtered.map()` 2-col grid | **50–500+ (all org)** | fixed | no |
| [MenteeTable.tsx:64](../../frontend/src/components/mentees/MenteeTable.tsx#L64) | `mentees.map()` | 10–50 | fixed (`py-3`) | no |
| [MyMentees.tsx:178-187](../../frontend/src/pages/MyMentees.tsx#L178-L187) | grid + table views | 5–50 | fixed | no |
| [ProjectReviews.tsx:364](../../frontend/src/pages/ProjectReviews.tsx#L364) | `sortedCards.map()` grid | 3–30 | fixed | no |
| [ProjectReviews.tsx:453-507](../../frontend/src/pages/ProjectReviews.tsx#L453-L507) | table w/ expandable rows | 3–30 | **variable (expandable)** | no |
| [AnnualGoals.tsx:621](../../frontend/src/pages/AnnualGoals.tsx#L621) | `sortedGoals.map()` grid | 5–50 | fixed | no |
| [AnnualGoals.tsx:655-775](../../frontend/src/pages/AnnualGoals.tsx#L655-L775) | table w/ expandable rows | 5–50 | **variable (expandable)** | no |
| [TeamGoalsTab.tsx](../../frontend/src/components/goals/TeamGoalsTab.tsx) | team goals table | 10–100+ (mentor) | variable | no |
| [TeamReviewTab.tsx](../../frontend/src/components/reviews/TeamReviewTab.tsx) | mentee × cycles | 10–200+ | variable | no |
| [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) | PM queue, expandable | 5–100+ | variable | no |
| [NotificationDropdown.tsx:102-126](../../frontend/src/components/layout/NotificationDropdown.tsx#L102-L126) | system + user notifications | 0–20 (capped, `max-h-80`) | fixed | no |

**Likely >100-row candidates in production:** [UsersTab](../../frontend/src/components/admin/UsersTab.tsx), [PeerList](../../frontend/src/components/feedback360/PeerList.tsx), [ProjectsTab](../../frontend/src/components/admin/ProjectsTab.tsx), [TeamGoalsTab](../../frontend/src/components/goals/TeamGoalsTab.tsx), [TeamReviewTab](../../frontend/src/components/reviews/TeamReviewTab.tsx), [PMEvaluationTab](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx). Of these, the expandable-row tables (TeamGoals, TeamReview, PMEvaluation, AnnualGoals table view, ProjectReviews table view) need variable-height virtualization.

**Filter/sort/pagination state:** All local `useState` per page; derived lists via `useMemo`. **No pagination anywhere** — client-side filter + sort over the full result set. No URL-param-driven state for filters. (Relevant for queryKeys: keys can be simple per-route since filters aren't shared.)

---

## 5. Mutation hot-paths

Sorted by likely firing frequency. Frequency is a best guess from code shape (no telemetry).

| File:line | Frequency | Currently invalidates |
|---|---|---|
| [CriteriaChecklist.tsx](../../frontend/src/components/goals/CriteriaChecklist.tsx) — `goalService.updateCriterion()` toggle | **high** — every checkbox click while reviewing goals | optimistic local `setCriteria`; no parent refetch |
| [CriteriaChecklist.tsx](../../frontend/src/components/goals/CriteriaChecklist.tsx) — `addCriterion` / drag-reorder | **high** during goal drafting | local state only |
| [EvalForm.tsx:148](../../frontend/src/components/reviews/EvalForm.tsx#L148) — `saveMentorDraft` autosave | **high** — fires on field change / unmount | fire-and-forget, no refetch |
| [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) — `savePMDraft` autosave | **high** | fire-and-forget |
| [ManagementReviewTab.tsx](../../frontend/src/components/admin/ManagementReviewTab.tsx) — `setManagementRating` inline | **medium** — inline cell click | refetches calibration grid only; stale on `/annual-reviews` and `/my-mentees/:id` |
| [BulkApproveModal.tsx:97](../../frontend/src/components/goals/BulkApproveModal.tsx#L97) — `bulkApprove` | **medium** | manual `setGoals` in caller; team-goals tab not invalidated |
| [GoalFormModal.tsx:109](../../frontend/src/components/goals/GoalFormModal.tsx#L109) — create/update goal | **low–medium** | parent `getMyGoals` refetch closure |
| [EvalForm.tsx:139](../../frontend/src/components/reviews/EvalForm.tsx#L139) — `submitMentorEval` | low | parent refetch / drawer close |
| [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) — `submitPMEvaluation` | low | refetch `getPMQueue`; stale on `/my-mentees/:id` |
| [SecondaryEvalTab.tsx](../../frontend/src/components/project-reviews/SecondaryEvalTab.tsx) — `submitSecondaryEval` | low | refetch secondary queue |
| [ProjectsTab.tsx:146](../../frontend/src/components/admin/ProjectsTab.tsx#L146) — `deleteProject` / mark-complete | low | `setProjects` filter; no admin-elsewhere invalidation |
| [UsersTab.tsx](../../frontend/src/components/admin/UsersTab.tsx) — create / update / deactivate user | low | `setUsers` refetch; **UserCombobox cache not invalidated** |
| [SystemSettingsTab.tsx](../../frontend/src/components/admin/SystemSettingsTab.tsx) — `updateSettings` | low | context broadcast (already global) |
| [FeedbackGive.tsx:52](../../frontend/src/pages/FeedbackGive.tsx#L52) — `submitReview` | low (one-shot) | `useNavigate('/feedback')` |
| [NotificationDropdown.tsx](../../frontend/src/components/layout/NotificationDropdown.tsx) — `markAllRead` | low | inline state clear |
| [PasswordChangeCard.tsx](../../frontend/src/components/profile/PasswordChangeCard.tsx) — `changePassword` | rare | `authService.refreshSession()` |

---

## 6. Cross-page data dependencies

| Domain | Readers | Writers | Current invalidation gap |
|---|---|---|---|
| **goals** | `/annual-goals` (My/Team tabs), `/dashboard` (widget), `/my-mentees/:id` (MenteeGoalsTab) | `/annual-goals` (CRUD, submit, bulk-approve, criteria toggle) | Bulk approve doesn't refetch Team tab; mentee detail goes stale after writer edits |
| **annual reviews** | `/annual-reviews`, `/management-reviews` (calibration), `/dashboard` (widget), `/my-mentees/:id` (MenteeReviewTab) | `/annual-reviews` (self / mentor / mgmt), `/management-reviews` (inline) | Inline mgmt rating refetches calibration only; other readers stale |
| **project reviews** | `/project-reviews` (My/PM/Secondary tabs), `/admin` (ManagementTab), `/my-mentees/:id` (MenteeProjectsTab) | `/project-reviews` (PM eval, secondary, edit), `/admin` | PM-eval submit doesn't invalidate mentee project list |
| **projects** | `/admin` (ProjectsTab); referenced from project-review and goal forms via FK | `/admin` (create/update/delete/complete/reopen) | Exports + dropdowns elsewhere can hold stale project lists |
| **users** | `/admin` (UsersTab), `UserCombobox` in goals/reviews/feedback/admin modals app-wide | `/admin` (create/update/deactivate/reactivate) | **UserCombobox doesn't know about UsersTab changes** — repeated complaint surface |
| **feedback360** | `/feedback` (peers + aggregate), `/feedback/give/:id` | `/feedback/give/:id` (submit) | Navigation-based invalidation only (works but coarse) |
| **system settings** | every page via `SystemSettingsProvider` context | `/admin` (SystemSettingsTab) | Context broadcast — already global, no gap |
| **notifications** | Topbar `NotificationDropdown`, `/dashboard` | `markAllRead` | Inline only; polling every 30s |
| **auth/session** | every route via `AuthProvider` | `Login`, `RefreshSession`, `PasswordChange` | Context broadcast |
| **dashboard summary** | `/dashboard` | none (computed server-side) | n/a |

---

## 7. Routing & code-splitting baseline

- **Total routes:** 15 (see [App.tsx:88-148](../../frontend/src/App.tsx#L88-L148)).
- **Lazy-loaded:** 0. All page imports are eager at [App.tsx:11-25](../../frontend/src/App.tsx#L11-L25).
- **Suspense boundaries:** **none** in the codebase.
- **Layout persistence:** `AppShell` ([App.tsx:59](../../frontend/src/App.tsx#L59)) renders [Sidebar.tsx](../../frontend/src/layouts/Sidebar.tsx) + [Topbar.tsx](../../frontend/src/layouts/Topbar.tsx) **outside** `<Outlet />`. They stay mounted across navigation. Route content swaps via the outlet.
- **Top 10 source files by line count** (candidates for splitting / virtualization first):

  | # | File | Lines |
  |---|---|---|
  | 1 | [TeamGoalsTab.tsx](../../frontend/src/components/goals/TeamGoalsTab.tsx) | 856 |
  | 2 | [AnnualGoals.tsx](../../frontend/src/pages/AnnualGoals.tsx) | 811 |
  | 3 | [MenteeProjectsTab.tsx](../../frontend/src/components/mentees/MenteeProjectsTab.tsx) | 770 |
  | 4 | [ProjectModal.tsx](../../frontend/src/components/admin/ProjectModal.tsx) | 735 |
  | 5 | [MenteeAnnualSummaryTab.tsx](../../frontend/src/components/mentees/MenteeAnnualSummaryTab.tsx) | 704 |
  | 6 | [MenteeGoalsTab.tsx](../../frontend/src/components/mentees/MenteeGoalsTab.tsx) | 603 |
  | 7 | [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) | 597 |
  | 8 | [ProjectReviews.tsx](../../frontend/src/pages/ProjectReviews.tsx) | 531 |
  | 9 | [ProjectsTab.tsx](../../frontend/src/components/admin/ProjectsTab.tsx) | 512 |
  | 10 | [ManagementReviewTab.tsx](../../frontend/src/components/admin/ManagementReviewTab.tsx) | 491 |

---

## 8. Risks & unknowns

1. **Production row counts are estimates.** Number of users, peers, projects, mentees per mentor, and PM-queue depth are all best-guesses from the code shape. The org-size-dependent ones (Users, PeerList, TeamGoals) could be 10× higher or lower than guessed. **Need to confirm with a real prod DB snapshot or admin.**
2. **Backend pagination support unknown.** Every list endpoint (`GET /users`, `GET /projects`, `GET /feedback-360/peers`, `GET /goals`) appears to return the full set client-side. If backend already supports `?page=&size=`, virtualization is less urgent; if not, a server-side pagination story is a parallel decision.
3. **Polling cadence not characterized.** `NotificationDropdown` polls on an interval ([NotificationDropdown.tsx:53](../../frontend/src/components/layout/NotificationDropdown.tsx#L53)); didn't read out the exact ms value or whether it pauses on tab-blur.
4. **Auto-save behavior of drafts** ([EvalForm.tsx:148](../../frontend/src/components/reviews/EvalForm.tsx#L148), [PMEvaluationTab.tsx](../../frontend/src/components/project-reviews/PMEvaluationTab.tsx) `savePMDraft`): fires on unmount per useEffect cleanup. Migrating to TanStack Query mutations changes lifecycle — need to confirm UX intent (debounce vs. on-blur vs. on-unmount).
5. **Export blob downloads** ([export.service.ts](../../frontend/src/services/export.service.ts)) won't fit a `useQuery({ data })` shape. They'll keep a direct call pattern; not a regression risk, just won't gain anything from the migration.
6. **`useReviewDetails`** ([useReviewDetails.ts](../../frontend/src/hooks/useReviewDetails.ts)) is the only existing custom data hook. It uses a reducer pattern that doesn't trivially map to `useQuery`. Worth a closer look during Phase B migration sequencing — could be the smallest blast-radius first migration.
7. **`UserCombobox`** ([UserCombobox.tsx:68-73](../../frontend/src/components/common/UserCombobox.tsx#L68-L73)) does its own debounced search and is a known stale-data offender vs. `/admin` UsersTab edits. It's a strong candidate for the first cross-page cache demonstration.
8. **Expandable rows in tables** (ProjectReviews, AnnualGoals tables, PMEvaluationTab, TeamGoalsTab) imply variable row heights. `@tanstack/react-virtual` handles this with `measureElement`, but the migration is non-trivial and worth its own PR per surface.

---
