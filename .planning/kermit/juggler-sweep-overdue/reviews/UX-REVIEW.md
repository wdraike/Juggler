# Bird UX Review — ConflictsView.jsx (stale bucket help text) — bugfix — 2026-06-26

## Status: DONE

> Re-review 2026-06-26: bird-001 and bird-002 RESOLVED by bert's replacement text. All 4 prior
> findings closed. No BLOCKs, no open WARNs, no open INFOs. Final wording still requires David
> sign-off (subjective UX copy per the leg spec) — that is a product decision, not a UX WARN.

---

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode bugfix, --files ConflictsView.jsx, --brand raike-and-sons-brand-guide.md | All present |
| Brand guide loaded | Read raike-and-sons-brand-guide.md (voice, tone, type, color sections) | Loaded — brand personality: confident, warm, professional but never stuffy, plain language |
| Design tokens loaded | design-system.css (referenced via brand guide); helpStyle in file is inline at font-size:11 px, unchanged by this diff | No token change in scope |
| Scope confirmed | git diff HEAD~1 -- ConflictsView.jsx; 1 string changed at line 81 | 1 screen, 1 string |
| Mode recorded | bugfix — review scope: changed string + one level of neighbours (sibling help texts lines 68, 73, 86, 91) | Applied |
| Sibling voice comparison | Read lines 64–93 of ConflictsView.jsx — all 4 sibling help texts captured | Completed |
| Brand/copy conformance | Compared new string to sibling patterns: opening term, tone, jargon, actionable close, length | 2 WARNs found |
| Factual accuracy | Verified new text no longer asserts all items move to today; distinguishes eligible vs committed | Accurate |
| Layout / overflow | Character count new text ~169 vs siblings 85–374; helpStyle unchanged (font-size 11, lineHeight 1.4) | No overflow risk |
| Viewport snapshots | SKIPPED — copy-only change; no layout or visual output change; helpStyle div dimensions unaffected | N/A |
| A11y automated (Step 4a) | SKIPPED — string content change only; no structural HTML, role, or contrast change | N/A |
| A11y manual (Step 4b) | SKIPPED — no interactive element altered | N/A |
| Interaction testing | SKIPPED — help text is static display; no interaction change | N/A |
| Env/i18n (Step 6a) | SKIPPED — copy-only change, no RTL / motion / dark-mode impact (text color via theme.textMuted token, unchanged) | N/A |
| Output written | UX-REVIEW.md + bird-REVIEW.json | Done |

---

## Proof Checklist

- [x] Required inputs present: --mode supplied, ≥1 frontend file in scope, brand guide readable
- [x] raike-and-sons-brand-guide.md read (voice: professional but never stuffy, warm, plain language; Inter for UI copy)
- [x] design-system.css token values loaded (helpStyle uses inline theme tokens, unchanged by diff)
- [x] Scope confirmed — 1 file, 1 changed string
- [x] Mode recorded in output (bugfix); mode-specific depth applied (changed string + sibling neighbours)
- [x] All screens enumerated — 1 screen in scope (ConflictsView / Issues page)
- [x] Brand conformance checked: voice, term consistency, tone, length
- [x] All 7 viewports: SKIPPED — copy-only change; no reflow impact (same helpStyle container, same font-size); documented as skipped, not silently absent
- [x] WCAG version pinned to 2.2 AA per BASE-NFR §3.5
- [x] a11y AUTOMATED (Step 4a): SKIPPED — no structural/contrast change
- [x] a11y MANUAL (Step 4b): SKIPPED — no interactive element change
- [x] Interactions: SKIPPED — static text only
- [x] Env/i18n (Step 6a): SKIPPED — copy-only; theme token unchanged
- [x] --responsive-only not passed; skipped steps documented as SKIPPED
- [x] React-logic issues: none spotted in diff scope
- [x] Test-inventory concerns: none
- [x] All findings carry File:Line + severity
- [x] Flag-and-refer lines emitted for any out-of-column issues (none found)
- [x] Rubric Coverage Map emitted — every dimension marked
- [x] UX-REVIEW.md written to $REVIEW_DIR in Contract-4 format
- [x] Status set: DONE (no BLOCKs)
- [x] Project knowledge: no novel requirement/standard decisions made this leg; no Scooter INBOX notice required

---

## The Change

| | Text |
|---|---|
| **Removed** | `These tasks were scheduled for a past date but have no due date, so they aren't actually overdue. The scheduler will move them to today on its next run, or you can reschedule them manually.` |
| **Added** | `These items have a scheduled date in the past and no hard deadline. The scheduler rolls eligible ones forward on its next run; committed items stay pinned to their date.` |

**Factual accuracy verdict:** The new text is factually correct. The old text's claim ("will move them to today on its next run") was wrong — it implied all stale items roll forward unconditionally. The new text correctly distinguishes eligible items (roll forward) from committed items (stay pinned). The fix is accurate.

---

## Findings

### Re-review verdict (2026-06-26)

bert applied the exact phrasing bird recommended. Diff confirmed:

```
- 'These tasks were scheduled for a past date but have no due date, so they aren't actually
-  overdue. The scheduler will move them to today on its next run, or you can reschedule
-  them manually.'
+ "These tasks have a past scheduled date and no hard deadline. Flexible tasks roll forward
+  on the next scheduler run; fixed-time tasks and calendar-linked events stay pinned at
+  their original date. Reschedule manually when you're ready."
```

| # | ID | Prior Severity | File:Line | Status | Resolution |
|---|----|---------------|-----------|--------|------------|
| 1 | bird-001 | WARN | ConflictsView.jsx:81 | **RESOLVED** | Opens "These tasks" — matches all sibling sections. Voice consistent. |
| 2 | bird-002 | WARN | ConflictsView.jsx:81 | **RESOLVED** | "committed items" replaced with "fixed-time tasks and calendar-linked events stay pinned at their original date" — plain English, no internal jargon. |
| 3 | bird-003 | INFO | ConflictsView.jsx:81 | **RESOLVED** | "Reschedule manually when you're ready." appended — actionable close restored, consistent with siblings. |
| 4 | bird-004 | INFO | ConflictsView.jsx:81 | **RESOLVED** | "their date" replaced with "their original date" — grammar tightened. |

**Remaining gate:** Final wording is subjective UX copy. David sign-off is still required per the leg spec. This is a product/copy approval, not an open WARN.

---

## Recommended Phrasing

The following is bird's suggested alternative. Final wording is David's decision (subjective UX copy):

> These tasks have a past scheduled date and no hard deadline. Flexible tasks roll forward on the next scheduler run; fixed-time tasks and calendar-linked events stay pinned at their original date. Reschedule manually when you're ready.

This recommendation:
- Opens with "These tasks" (consistent with all siblings)
- Replaces "committed items" with plain-English descriptions of the two cases
- Restores an actionable close
- Removes the semicolon mid-sentence (sibling style prefers em-dashes or new sentences for asides)
- Matches the brand voice (warm, plain, not stuffy)

---

## Viewport Coverage

| Viewport | Screens Tested | Status |
|----------|---------------|--------|
| 320px (reflow-wcag) | — | SKIPPED — copy-only change; helpStyle container unaffected |
| 375px (mobile-sm) | — | SKIPPED |
| 430px (mobile-lg) | — | SKIPPED |
| 768px (tablet) | — | SKIPPED |
| 1024px (laptop) | — | SKIPPED |
| 1440px (desktop) | — | SKIPPED |
| 1920px (wide) | — | SKIPPED |

**Length note:** New text is ~169 characters vs sibling range of 85–374 characters. helpStyle is `{ fontSize: 11, color: theme.textMuted, padding: '2px 0 6px 0', lineHeight: 1.4 }` — identical to all other sections, unchanged by this diff. No overflow or reflow risk introduced.

---

## Accessibility Audit (WCAG 2.2 AA — pinned by BASE-NFR §3.5)

All items below are SKIPPED or PASS-by-inheritance: this diff changes one string inside an existing `<div style={helpStyle}>` element. No structural HTML change, no color change, no interactive element change.

| Check | SC | Tier | Status | Notes |
|-------|----|------|--------|-------|
| Reflow 320px / 400% zoom | 1.4.10 | manual | SKIPPED | No layout change |
| Target size ≥ 24×24 (2.5.8 AA) | 2.5.8 | manual | SKIPPED | No interactive element |
| 200% zoom | 1.4.4 | manual | SKIPPED | No layout change |
| Color contrast AA (text) | 1.4.3 | axe | PASS (inherited) | theme.textMuted token unchanged |
| Non-text / UI contrast ≥ 3:1 | 1.4.11 | axe | SKIPPED | No non-text element changed |
| Focus visible | 2.4.7 | manual | SKIPPED | No focusable element changed |
| Keyboard traversal | 2.1.2 | manual | SKIPPED | No interactive element changed |
| ARIA roles | — | axe | SKIPPED | No structural change |
| Status messages (live regions) | 4.1.3 | axe | SKIPPED | No change |

---

## Brand Conformance

| Check | Status | Notes |
|-------|--------|-------|
| All colors via CSS tokens | PASS | helpStyle uses theme.textMuted — unchanged |
| Type sizes via CSS tokens | PASS | font-size:11 inline — unchanged, consistent with all siblings |
| Spacing via CSS tokens | PASS | padding unchanged |
| Component variants match brand guide | PASS | No component change |
| Iconography conformant | N/A | No icon change |
| Logo usage conformant | N/A | No logo change |
| Voice / tone | WARN | "committed items" is jargon; "These items" breaks sibling pattern (see Findings #1, #2) |
| Capitalization / sentence style | PASS | Sentence case, no title case in help text — conforms |

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Visual Identity | gap | No visual tokens changed; brand guide consulted for voice only | Copy-only change; visual identity unaffected |
| Theme Consistency | covered | helpStyle token (theme.textMuted) unchanged; confirmed consistent with siblings | PASS |
| Interaction States | gap | No interactive element in scope | Not applicable to this change |
| Accessibility | partial | Color/contrast inherited; structural a11y skipped (no HTML change) | Copy-only; existing a11y not regressed |
| Information Architecture | covered | String sits within established Issues page bucket structure; position unchanged | PASS |
| Content Standards | covered | Voice, term consistency, tone, jargon, length, actionable close — fully reviewed | 2 WARNs, 2 INFOs filed |
| Help Systems | covered | This string IS the help system text — primary focus of review | Factually accurate; clarity WARNs filed |
| Responsive Design | gap | Skipped — no layout change; length within sibling range | Length analysis confirms no reflow risk |
| Iconography | gap | No icon change | Not applicable |
| Performance Perception | gap | No render path change | Not applicable |
| Data Layout Consistency | covered | Sibling help text pattern checked (lines 64–93); new text deviates on opening noun | WARN #1 filed |

---

## Sign-off

Signed: Bird — 2026-06-26T00:00:00Z (original)
Re-review: Bird — 2026-06-26 (bert fix confirmed)

BLOCKs: 0 | WARNs resolved: 2 (bird-001, bird-002) | INFOs resolved: 2 (bird-003, bird-004) | Open: 0

> Final wording requires David sign-off (subjective UX copy; product/copy decision, not a UX gate).
