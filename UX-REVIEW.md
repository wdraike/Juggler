# UX Review — CalendarView.jsx overdue badge — 2026-06-05

## Executive Summary
The overdue indicator addition to `CalendarView.jsx` is visually consistent with the existing `DailyView` pattern (uses `theme.error`, ⚠ glyph, red border). No critical UX issues. W1 (missing Playwright test) addressed with `calendar-overdue-badge.spec.js`. Two Info items remain as polish candidates.

## Critical Findings (blocks release)
_None._

## Warning Findings (fix this sprint)
| # | Status | Category | Screen | Viewport | Finding | Remediation |
|---|--------|----------|--------|----------|---------|-------------|
| W1 | FIXED | Test coverage | Calendar (month) | All | No e2e test for overdue badge rendering in CalendarView. | Added `tests/calendar-overdue-badge.spec.js` with two tests: (1) ⚠ badge visible for overdue task; (2) done task suppresses badge. |

## Info Findings (polish)
| # | Category | Screen | Viewport | Finding | Remediation |
|---|----------|--------|----------|---------|-------------|
| I1 | Accessibility | Calendar (month) | All | The overdue ⚠ span has no `aria-label` or `title`. Screen readers may announce "warning sign" with no context. Pre-existing gap on `~` and `◇` badges too — not a regression introduced here. | Add `aria-label="Overdue"` or `title="This task is overdue"` to the overdue badge span, matching the tooltip text used in DailyView's overdue badge. |
| I2 | Visual | Calendar (month) | mobile-sm (375px) | Task chips at `fontSize: 9px` with the 8px overdue badge icon are near the legibility threshold on mobile. Pre-existing constraint of the month-view chip design. | Consider omitting the ⚠ text on mobile and relying solely on the red border, or reserving the badge for ≥tablet viewports. |

## Viewport Coverage
| Viewport | Status |
|----------|--------|
| 320px (reflow) | PASS — badge is inline text, no new overflow risk |
| 375px (mobile-sm) | PASS with note (see I2) |
| 768px (tablet) | PASS |
| 1024px (laptop) | PASS |
| 1440px (desktop) | PASS |

## Accessibility Audit
| Check | Status |
|-------|--------|
| Color — theme.error used (not hard-coded) | PASS |
| Color contrast of badge text vs background | PASS — `#8B2635` on white has >4.5:1 |
| Keyboard navigation — no change | PASS |
| Role/tabIndex on TaskEntry — unchanged | PASS |
| Badge has aria-label/title | INFO (I1, pre-existing pattern) |

## Status: PASS
_Signed: Bird — 2026-06-05T00:00:00Z_
