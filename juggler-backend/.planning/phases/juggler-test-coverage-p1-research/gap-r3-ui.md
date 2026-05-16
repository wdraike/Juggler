# R3: Frontend UI Coverage Gap Report

## Existing spec file status

| File | Status | Test count |
|------|--------|-----------|
| tests/e2e.spec.js | EXISTS | 15 tests |
| tests/task-create.spec.js | EXISTS (real tests) | 4 tests |
| tests/task-edit.spec.js | EXISTS (real tests) | 4 tests |
| tests/recurring.spec.js | EXISTS (real tests) | 4 tests |
| tests/calendar-navigation.spec.js | EXISTS (real tests) | 5 tests |
| tests/settings.spec.js | EXISTS (real tests) | 7 tests |
| tests/responsive.spec.js | EXISTS (real tests) | 16 test bodies × 13 devices |

**Note:** The TEST-USE-CASES.md §8 Coverage Summary lists Screen/Playwright as "COVERED=0, PLANNED=19" — this is stale. All 6 flow spec files now contain real test bodies (written after the plan doc was last updated).

---

## data-testid attributes found (for Playwright selectors)

| Component file | data-testid values |
|---------------|-------------------|
| (all files scanned) | **None found** |

Zero `data-testid` attributes exist anywhere in `juggler-frontend/src/`. All existing tests rely exclusively on: button titles, visible text (`text=`), placeholder text, element roles, and CSS attribute selectors (`button[title="..."]`, `input[type="range"]`).

---

## PLANNED PW- items status

| ID | Description | Target spec file | File exists? | Tests written? | Notes |
|----|-------------|-----------------|--------------|---------------|-------|
| PW-01 | QuickAddTask inline form — fill + submit | tests/task-create.spec.js | YES | YES | "QuickAddTask inline form — fill and submit" |
| PW-02 | TaskEditForm full creation: text, priority, duration, when-window, project | tests/task-create.spec.js | YES | PARTIAL | "TaskEditForm full creation with all fields" — missing when-window coverage |
| PW-03 | Recurring task creation: toggle + daily/weekly, save | tests/recurring.spec.js | YES | YES | "Create recurring task — enable recurrence toggle in TaskEditForm" |
| PW-04 | Task with dependency: dep picker → dep badge visible | tests/task-create.spec.js | YES | PARTIAL | "Task creation with dependency field" — dep badge visibility not asserted |
| PW-10 | Click task card → sidebar/edit panel opens | tests/task-edit.spec.js | YES | YES | "Click task card opens sidebar edit panel" |
| PW-11 | Status cycle: open → wip → done | tests/task-edit.spec.js | YES | YES | "Status toggle: open → wip (Start) → done (Complete)" |
| PW-12 | Drag-pin task → pin badge appears, Unpin visible | tests/task-edit.spec.js | YES | PARTIAL | "Drag-pin a task in Day view" — pin badge assertion is missing |
| PW-13 | Unpin → badge gone | tests/task-edit.spec.js | YES | PARTIAL | "Unpin a task — pin badge / unpin control" — badge-gone assertion is missing |
| PW-14 | RecurringDeleteDialog: delete instance vs. template cascade | tests/recurring.spec.js | YES | YES | Two separate tests: "skip instance only" + "delete entire series" |
| PW-20 | WeekStrip: click different days, view updates | tests/calendar-navigation.spec.js | YES | PARTIAL | Tests prev/next/Today buttons only; does not click individual day cells in WeekStrip |
| PW-21 | View switch: DayView → ThreeDayView → WeekView → CalendarView | tests/calendar-navigation.spec.js | YES | PARTIAL | Covers Day→3-Day, 3-Day→Week, Week→Month; does not test Flex, Timeline, Clock, Deps, Issues views |
| PW-22 | ListView: filter by priority | tests/calendar-navigation.spec.js | YES | PARTIAL | Only checks P1 task visible; no filter pill interaction tested |
| PW-23 | PriorityView: tasks grouped by P1-P4 | tests/calendar-navigation.spec.js | YES | NO | No test targets PriorityView specifically (covered only by e2e.spec.js smoke switching) |
| PW-24 | DependencyView: dependency graph renders | tests/calendar-navigation.spec.js | YES | NO | No dedicated test for Deps/DependencyView in calendar-navigation.spec.js |
| PW-30 | SettingsPanel open — each of 6 tabs accessible | tests/settings.spec.js | YES | YES | 7 tests covering open + each tab |
| PW-31 | Locations: add location, save, verify appears | tests/settings.spec.js | YES | PARTIAL | Tab opens without crash only; add/save/verify flow not written |
| PW-32 | Projects: add project, rename, delete | tests/settings.spec.js | YES | PARTIAL | Tab opens without crash only; CRUD flow not written |
| PW-33 | Templates (time blocks): add block, change color | tests/settings.spec.js | YES | PARTIAL | Tab opens without crash only; add/color flow not written |
| PW-34 | CalSyncPanel: connect flow visible (mock API) | tests/settings.spec.js | YES | NO | CalSyncPanel is not opened or tested in settings.spec.js; no dedicated CalSync tab test |

**Summary of PLANNED status vs. actual:**
- Fully satisfied: PW-01, PW-03, PW-10, PW-11, PW-14, PW-30 (6 of 19)
- Partially satisfied (test exists but assertion depth is shallow): PW-02, PW-04, PW-12, PW-13, PW-20, PW-21, PW-22, PW-31, PW-32, PW-33 (10 of 19)
- Still zero coverage: PW-23, PW-24, PW-34 (3 of 19)

---

## Components with zero test coverage

These components have no Playwright test targeting them (neither e2e.spec.js nor any flow spec):

| Component | File | Recommended test type |
|-----------|------|----------------------|
| AiCommandPanel | components/features/AiCommandPanel.jsx | Flow spec — open panel, send command, verify response area |
| CalSyncPanel | components/features/CalSyncPanel.jsx | Flow spec (PW-34) — connect flow with mocked OAuth endpoints |
| CompletionTimePicker | components/features/CompletionTimePicker.jsx | Unit/flow — open from task form, pick time, verify field updates |
| ConfirmDialog | components/features/ConfirmDialog.jsx | Flow spec — trigger confirm dialog, click confirm vs. cancel |
| HelpModal | components/features/HelpModal.jsx | Flow spec — open modal, verify content, close |
| ImportExportPanel | components/features/ImportExportPanel.jsx | Smoke in e2e.spec.js test 13 only — no assertion on panel content |
| RecurringDeleteDialog | components/features/RecurringDeleteDialog.jsx | Covered in recurring.spec.js but only reachable via delete button in edit form |
| WeatherBadge | components/features/WeatherBadge.jsx | Flow spec — mock weather API, verify badge appears |
| AnnotationCanvas | components/feedback/AnnotationCanvas.jsx | No test coverage |
| FeedbackButton | components/feedback/FeedbackButton.jsx | No test coverage |
| FeedbackDialog | components/feedback/FeedbackDialog.jsx | No test coverage |
| AppFooter | components/layout/AppFooter.jsx | No test coverage |
| FontSizeControl | components/layout/FontSizeControl.jsx | No test coverage |
| HealthDot | components/layout/HealthDot.jsx | No test coverage |
| ToastNotification | components/layout/ToastNotification.jsx | Flow spec — trigger action that produces toast, verify text |
| UserDropdown | components/layout/UserDropdown.jsx | Flow spec — open dropdown, verify sign-out button |
| WeekStrip | components/layout/WeekStrip.jsx | Tested via e2e.spec.js nav tests but WeekStrip day-cell clicks not tested |
| DisabledItemsPanel | components/billing/DisabledItemsPanel.jsx | No test coverage |
| UpgradePrompt | components/billing/UpgradePrompt.jsx | No test coverage |
| ImpersonationBanner | components/admin/ImpersonationBanner.jsx | Has unit tests (Jest) but no Playwright coverage |
| ImpersonationPage | components/admin/ImpersonationPage.jsx | Has unit tests (Jest) but no Playwright coverage |
| SchedulerDebug | components/admin/SchedulerDebug.js | No test coverage |
| SchedulerStepper | components/admin/SchedulerStepper.jsx | No test coverage |
| SCurveTimeline | components/schedule/SCurveTimeline.jsx | No Playwright test; Clock view not exercised in any spec |
| HorizontalTimeline | components/schedule/HorizontalTimeline.jsx | Smoke only via e2e.spec.js test 15 |
| CalendarGrid | components/schedule/CalendarGrid.jsx | Smoke only via DayView tests (hour labels visible) |
| ScheduleCard | components/schedule/ScheduleCard.jsx | Drag test in task-edit.spec.js is conditional; pin badge not asserted |
| StatusToggle | components/schedule/StatusToggle.jsx | Tested via task-edit and recurring specs |
| ConflictsView | components/views/ConflictsView.jsx | No dedicated test; Issues view accessed only in e2e.spec.js view loop |
| DailyView | components/views/DailyView.jsx | Smoke only; separate from DayView (Flex) — no direct navigation test |
| DependencyView | components/views/DependencyView.jsx | No dedicated test (PW-24 not written) |
| PriorityView | components/views/PriorityView.jsx | No dedicated test (PW-23 not written); covered only by e2e view-loop smoke |
| SCurveView | components/views/SCurveView.jsx | No test coverage (Clock view) |
| ErrorBoundary | components/ErrorBoundary.jsx | No test coverage |
| LoginPage | components/auth/LoginPage.jsx | No test — all specs bypass auth via route interception |

---

## Summary

- Spec files with real tests: 7 (e2e.spec.js + 5 flow specs + responsive.spec.js)
- Spec files that are stubs: 0
- PW- items still with zero test coverage: 3 (PW-23, PW-24, PW-34)
- PW- items with shallow/partial coverage only: 10
- PW- items fully satisfied: 6
- data-testid attributes found: 0
- Components with zero Playwright coverage: 26 of 39 total component files
- TEST-USE-CASES.md §8 row "Screen/Playwright COVERED=0" is stale — all 6 flow spec files have real test bodies
