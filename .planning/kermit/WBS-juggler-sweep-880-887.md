# WBS — juggler-sweep-880-887 — chore (--trivial) — 2026-06-26

## Intent
Two deliberate UI removals David requested (autonomous juggler backlog sweep):
- **999.880** Remove the open/done task statistics bar chart from the main Juggler screen — no longer wanted.
- **999.887** Settings is launched from two places; remove the gear-icon launch point, keep the other.

Pure frontend UI removals. No logic/API/schema/route change. Non-risky surface → `--trivial` lane.

## Work Items
| ID | Task | Mode | Scope | Inputs | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|--------|-----------|---------------------|--------|------|
| W1 | Remove `CompletionMetricsWidget` (the open/done stats bar chart): delete component file + its only import + only render site | chore | juggler-frontend | evidence below | — | Widget no longer renders on the Juggler screen; no dangling import/ref; shared state (`allTasks`/`statuses`/`theme`) untouched; build+tests green | ernie (trivial reviewer) | 1 |
| W2 | Remove the gear-icon Settings launch point in HeaderBar (desktop bare gear button); keep UserDropdown (desktop) + overflow menu item (mobile) | chore | juggler-frontend | evidence below | — | Standalone gear button gone; Settings still reachable on desktop (UserDropdown) and mobile (overflow item); `onShowSettings`/`Settings` import still used (no orphan) | ernie (trivial reviewer) | 1 |

W1 and W2 are independent (different components) → same wave, no dep.

## Evidence (file:line, pre-edit)
**999.880 — chart = `CompletionMetricsWidget` (999.256), a discrete imported component computing done/open/overdue + a % bar:**
- `juggler-frontend/src/components/layout/CompletionMetricsWidget.jsx` (whole file, 64 lines) — deleted
- `juggler-frontend/src/components/layout/AppLayout.jsx:11` — `import CompletionMetricsWidget` — removed
- `juggler-frontend/src/components/layout/AppLayout.jsx:1197-1198` — render site `{!isMobile && <CompletionMetricsWidget .../>}` + its comment — removed
- Props `allTasks`/`statuses`/`theme` are shared app state used widely → NOT removed (no orphaned fetch/state; widget is pure/derived, no own fetch)
- (NOT the TimelineView inline IIFE progress bar — that is per-day timeline-chrome done/total+hours, not the "open/done statistics" component; left intact, its test still passes)

**999.887 — two desktop launch points; gear-icon = the bare gear button:**
- `juggler-frontend/src/components/layout/HeaderBar.jsx:184` — `<button onClick={onShowSettings} ... aria-label="Settings"><Settings size={16}/></button>` (desktop `!useOverflow`, no text label) = the GEAR-ICON launch point — removed
- KEEP `HeaderBar.jsx:234` `<UserDropdown ... onShowSettings={onShowSettings}/>` → UserDropdown labeled "Settings" item (desktop "other entry point")
- KEEP `HeaderBar.jsx:70` overflow menu `{label:'Settings'}` (mobile-only; UserDropdown is inside the `!useOverflow` desktop block so on mobile the overflow item is the ONLY Settings path — removing it would break mobile reachability)
- `onShowSettings` prop + `Settings` lucide import remain in use (lines 70, 234) → no orphan

## Dependency Graph
W1, W2 independent — both Wave 1.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| (none) | — | W1 (chart) and W2 (settings launcher) touch different components; derived independent |

## Waves
Wave 1: W1, W2

## Snuffy
Skipped — self-evident `--trivial`: 0 added lines, ~3 line removals + one dead-component file deletion, pure frontend UI, no risky surface. Snuffy would rubber-stamp (per Step 3.7 self-evident-trivial skip clause).
