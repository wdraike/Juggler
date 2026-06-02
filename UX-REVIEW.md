# UX Review — TaskDetailHeader WCAG Fixes (UX-JUG-P1, P2, P4) — 2026-05-31

## Executive Summary

All three targeted WCAG fixes applied correctly. No regressions introduced. 428 tests pass. Four pre-existing accessibility gaps noted as Info items — not regressions, out of scope for this ticket.

## Critical Findings (blocks release)

None.

## Warning Findings (fix this sprint)

None.

## Info Findings (polish — pre-existing, out of scope for this ticket)

| # | Category | Element | Finding | Remediation |
|---|----------|---------|---------|-------------|
| I-1 | Accessibility (WCAG 2.5.8) | Priority `<select>` (line 154) | `height: 22` — below WCAG 2.5.8 24px minimum target size. Pre-existing, not regressed. | Increase to `height: 28` or apply BTN_H pattern |
| I-2 | Accessibility (WCAG 2.5.8) | "Enable Flex" button (line 94) | `fontSize: 9`, no explicit height — below minimum. Pre-existing. | Increase font size; add explicit height |
| I-3 | Accessibility (WCAG 1.4.3) | "Status" section label (line 104) | `fontSize: 9` — same small-text issue P1 fixed in lStyle. Pre-existing. | Change to `fontSize: isMobile ? 12 : 11` |
| I-4 | Accessibility (WCAG 4.1.2) | Close button `×` | No `aria-label`. Screen readers announce "times" or "×". Pre-existing. | Add `aria-label="Close"` |

## Verification of Applied Fixes

### UX-JUG-P1 — WCAG 1.4.3 Label Font Size

- Before: `fontSize: 9` (hardcoded)
- After: `fontSize: isMobile ? 12 : 11`
- Desktop 11px at `fontWeight: 600` meets AA contrast at typical label muted colors. Mobile 12px is above the small-text threshold.
- Applied to: Project, Notes, Link labels (all use `lStyle`)
- Status: **PASS**

### UX-JUG-P2 — WCAG 2.5.8 Target Size Minimum

- Before: `BTN_H = isMobile ? 30 : 26`
- After: `BTN_H = isMobile ? 36 : 28`
- Desktop 28px meets WCAG 2.5.8 AA (24px minimum). Mobile 36px exceeds minimum.
- Applied to: Status buttons, Project select, Link input, Open link button (all use `BTN_H`)
- Status: **PASS**

### UX-JUG-P4 — WCAG 1.3.1 Label Association

- Before: `<label style={...}>Project<select ...>` — implicit association only
- After: `<label htmlFor='task-project-select' ...>` + `<select id='task-project-select' ...>`
- Explicit `for`/`id` pairing is the robust pattern for screen readers and assistive tech.
- Notes and Link labels use implicit wrapping association (valid per HTML spec).
- Status: **PASS**

## Viewport Coverage

Static component — no Playwright run (no local dev server running). Source-level analysis covers the targeted changes.

| Viewport | Assessment |
|----------|-----------|
| 320px (reflow) | `flexWrap: 'wrap'` present on toolbar and status row — no 2D scroll expected |
| 375px (mobile-sm) | `BTN_H = 36` meets 2.5.8; `fontSize: 12` for labels meets readability |
| 1440px (desktop) | `BTN_H = 28` meets 2.5.8 AA; `fontSize: 11` at weight 600 readable |

## Test Coverage

| Check | Result |
|-------|--------|
| `TaskDetailHeader.test.jsx` covers project select | PASS |
| `TaskDetailHeader.test.jsx` covers null project (P4 regression guard) | PASS |
| All 428 tests pass | PASS |
| No snapshot regressions | PASS (no snapshots in suite) |

## Status: PASS

_Signed: Bird — 2026-05-31T00:00:00Z_
