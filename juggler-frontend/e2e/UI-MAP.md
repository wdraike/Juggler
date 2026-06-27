# Juggler Frontend — UI Map

Human-readable companion to [`ui-map.json`](./ui-map.json) (`$schema: juggler-ui-map/v1`).
Statically derived from `App.js` / `AppLayout.jsx` view-switch state + `src/theme`.

**Counts (MUST match `ui-map.json` exactly):**

| Category | Count |
|----------|-------|
| Screens  | 15 |
| Modals   | 12 |
| Paths    | 15 |
| Surfaces (screens + modals) | 27 |
| Overall (surfaces + paths)  | 42 |

The coverage calculator treats **screens + modals together** as the `screens`
(surfaces) category and **paths** as the `paths` category. See
[`coverage/ui-coverage.js`](./coverage/ui-coverage.js).

> **Note:** the pre-existing `../tests/e2e/` smoke specs already cover some
> surfaces (via retrofitted `// @covers` annotations), and `collect-coverage.js`
> aggregates both `tests/e2e/**` and `e2e/specs/**`. See
> [`DECOMPOSITION.md`](./DECOMPOSITION.md).

---

## Screens (15)

`viewMode` state in `AppLayout.jsx`, switched via `NavigationBar`; plus auth and
admin routes in `App.js`.

| id | label | component | evidence | select |
|----|-------|-----------|----------|--------|
| `screen:daily` | Day View | DayView.jsx | AppLayout.jsx:1279 | `setViewMode('daily')` |
| `screen:day` | Flex View | DayView.jsx | AppLayout.jsx:1198 | `setViewMode('day')` |
| `screen:3day` | 3-Day View | ThreeDayView.jsx | AppLayout.jsx:1221 | `setViewMode('3day')` |
| `screen:week` | Week View | WeekView.jsx | AppLayout.jsx:1235 | `setViewMode('week')` |
| `screen:month` | Calendar View | CalendarView.jsx | AppLayout.jsx:1269 | `setViewMode('month')` |
| `screen:timeline` | Timeline View | TimelineView.jsx | AppLayout.jsx:1249 | `setViewMode('timeline')` |
| `screen:list` | List View | ListView.jsx | AppLayout.jsx:1306 | `setViewMode('list')` |
| `screen:priority` | Priority / Kanban | PriorityView.jsx | AppLayout.jsx:1317 | `setViewMode('priority')` |
| `screen:deps` | Dependencies DAG | DependencyView.jsx | AppLayout.jsx:1328 | `setViewMode('deps')` |
| `screen:conflicts` | Issues / Unplaced | ConflictsView.jsx | AppLayout.jsx:1338 | `setViewMode('conflicts')` |
| `screen:login` | Login | components/auth/LoginPage.jsx | App.js:65 | rendered when `useAuth().user` is falsy |
| `screen:auth-callback` | OAuth Callback (loading) | App.js inline | App.js:29-44 | url `/auth/callback` |
| `screen:admin-scheduler-debug` | Scheduler Debug | SchedulerDebug.jsx | App.js:17-20 | url `/admin/scheduler-debug` |
| `screen:admin-scheduler-stepper` | Scheduler Stepper | SchedulerStepper.jsx | App.js:21-24 | url `/admin/scheduler-stepper` |
| `screen:admin-impersonation` | Impersonation | ImpersonationPage.jsx | App.js:25-28 | url `/admin/impersonation` |

## Modals (12)

| id | label | component | evidence | trigger |
|----|-------|-----------|----------|---------|
| `modal:task-editor` | Task Editor | TaskEditForm.jsx | AppLayout.jsx:1420 | task card click → expandedTasks |
| `modal:settings` | Settings | SettingsPanel.jsx | AppLayout.jsx:1486 | HeaderBar gear |
| `modal:import-export` | Import / Export | ImportExportPanel.jsx | AppLayout.jsx:1495 | settings / menu |
| `modal:calendar-sync` | Calendar Sync | CalSyncPanel.jsx | AppLayout.jsx:1504 | settings button / OAuth callback |
| `modal:help` | Help | HelpModal.jsx | AppLayout.jsx:1543 | HeaderBar ? / Cmd+? |
| `modal:disabled-items` | Disabled Items | DisabledItemsPanel.jsx | AppLayout.jsx:1550 | plan-limit banner |
| `modal:confirm-delete` | Confirm Delete | ConfirmDialog.jsx | AppLayout.jsx:1570 | task delete |
| `modal:recurring-delete` | Recurring Delete | RecurringDeleteDialog.jsx | AppLayout.jsx:1580 | delete recurring instance |
| `modal:completion-time` | Completion Time | CompletionTimePicker.jsx | AppLayout.jsx:1590 | mark done |
| `modal:ai-command` | AI Command | AiCommandPanel.jsx | AppLayout.jsx:1600 | Cmd+Shift+K |
| `modal:quick-add` | Quick Add Task | QuickAddTask.jsx | AppLayout.jsx:1470 | + button / Cmd+N |
| `modal:toast-history` | Toast History | ToastNotification.jsx | AppLayout.jsx:1183 | toast area click |

## Paths (15)

| id | from | action | to |
|----|------|--------|----|
| `path:1` | screen:daily | click task | modal:task-editor |
| `path:2` | any-view | NavigationBar tab | screen (view switch) |
| `path:3` | any-view | filter pill | filter applied, stays on view |
| `path:4` | any-view | click status badge | status change |
| `path:5` | any-view | drag task to slot | reschedule |
| `path:6` | any-view | Cmd+Shift+K | modal:ai-command |
| `path:7` | modal:settings | Calendar Sync | modal:calendar-sync |
| `path:8` | screen:conflicts | unplaced row | modal:task-editor |
| `path:9` | screen:deps | task node | modal:task-editor |
| `path:10` | screen:priority | drag between columns | status change |
| `path:11` | any-view | + / Cmd+N | modal:quick-add |
| `path:12` | any-view | delete icon | modal:confirm-delete |
| `path:13` | any-view | mark done | modal:completion-time |
| `path:14` | any-view | gear | modal:settings |
| `path:15` | screen:login | Sign In | screen:auth-callback → AppLayout |

---

## Branding source

E2E branding assertions draw from the canonical palette so tests fail loudly on
brand drift.

- **Theme tokens:** [`src/theme/colors.js`](../src/theme/colors.js) — `BRAND`
  (shared constants) and `getTheme(darkMode)` (returns `THEME_DARK` /
  `THEME_LIGHT`).
- **Brand guide:** [`raike-and-sons-brand-guide.md`](../../../raike-and-sons-brand-guide.md)
  (monorepo root).

Key brand tokens an E2E test can assert:

| token | hex | role |
|-------|-----|------|
| navy | `#1A2B4A` | primary brand / headers / actions |
| gold | `#C8942A` | accent / highlights / warning |
| parchment | `#F5F0E8` | light surface background |
| charcoal | `#2C2B28` | primary text on light |
