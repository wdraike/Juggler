# SPEC — juggler-sweep-880-887 — chore (--trivial)

Two deliberate UI removals (David-requested) in juggler-frontend. No behavior change to logic;
removal of unwanted UI + its dead code only.

## 999.880 — Remove open/done task statistics bar chart
- The `CompletionMetricsWidget` (done/open/overdue pills + completion % bar) no longer renders on the Juggler screen.
- Its component file, sole import, and sole render site are removed.
- Shared data (`allTasks`, `statuses`, `theme`) that also feeds other UI is preserved.

## 999.887 — Remove gear-icon Settings launch point
- The standalone gear-icon Settings button in the header (desktop) is removed.
- Settings remains reachable: desktop via the UserDropdown "Settings" item; mobile via the overflow-menu "Settings" item.
- No orphaned handler/import (`onShowSettings` and the `Settings` icon import stay in use).

## Acceptance
- App builds; touched-area test suites green (149 tests pass).
- No dangling references to the removed widget; no orphaned settings wiring.
- Settings reachable on both desktop and mobile via the kept entry points.
