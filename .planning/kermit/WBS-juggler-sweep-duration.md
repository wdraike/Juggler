# WBS — juggler-sweep-duration — new — 2026-06-26

## Intent
Two same-field enhancements to the task-sidebar Duration input (`WhenSection.jsx`): free-type
(999.889) + range enforce/surface (999.889) + minutes-unit indication (999.890). Single component,
single test file → ONE batched leg (Step 3.2: same files/tests/review surface = one item).

## Scooter consult
- Brain online (74506 nodes). No veto on the duration field / WhenSection.
- Canonical save-path range = `task.schema.js:17` taskUpdateSchema `dur min(5).max(480)` (bound at
  `task.routes.js:9`). Mirror that — evidence-based, not invented.
- Surfaced contradiction (brain #120 "720 cap" vs facade 1440 vs domain unbounded vs schema 480) =
  latent backend tech debt → David follow-up, NOT a blocker for this UI leg (sidebar saves via the
  480-capped path).

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | Make Duration input free-typeable (local string state, commit-on-blur/Enter), enforce min 5/max 480 via a single named constant correcting out-of-range to nearest bound, surface the range, indicate minutes unit; preserve native stepper + end-time projection | new | juggler-frontend | SPEC R1–R4; WhenSection.jsx:288-294; task.schema.js range | — | R1 free-type no snap-to-1; R2 5–480 enforced+surfaced, out-of-range→nearest bound (not magic default); R3 "min" unit shown; R4 stepper + addMinutesTo24h end-time projection preserved | telly (RED test first), bert (impl), ernie (React logic), bird (UX: range hint + minutes label visibility) | 1 |

## Dependency Graph
Single item — no deps.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| 999.889 + 999.890 batched into W1 | shared-module (same component + same test file + same review surface) | derived (Step 3.2 batching rule) |

## Waves
Wave 1: W1
