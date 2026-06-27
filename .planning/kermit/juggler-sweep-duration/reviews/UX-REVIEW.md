# Bird UX Review — WhenSection.jsx Duration field (999.889 + 999.890) — new — 2026-06-26

## Status: DONE

No BLOCK findings. 0 WARN (all 4 prior WARNs resolved by bert). 3 INFO unchanged. See Re-review section.

---

## Re-review — 2026-06-26 (bert fix pass, --re-review --depth standard)

### 4 Prior WARNs — Verdict

**WARN-1 (bird-w1): Range hint color TH.amberText → TH.textMuted**
Status: RESOLVED.
Line 330: `<span id="dur-range-hint" style={{ fontSize: 11, color: TH.textMuted, marginLeft: 4 }}>` — `TH.textMuted` confirmed. Amber is no longer used for the passive range hint.

**WARN-2 (bird-w2): Range hint fontSize 9 → 11**
Status: RESOLVED.
Line 330: `fontSize: 11` confirmed. Matches other inline guidance annotations in this file (lines 227, 747).

**WARN-3 (bird-w3): aria-describedby / span id missing**
Status: RESOLVED and wiring verified correct.
- Line 328: `aria-describedby="dur-range-hint"` on the `<input>` — present.
- Line 330: `id="dur-range-hint"` on the `<span>` — present and exactly matches the input's `aria-describedby` value.
- AT reading: screen reader focused on the Duration input will now announce "5–480 min" via the linked describedby relationship. The static hint id is separate from the alert div (which has no id and uses the live-region mechanism instead) — correct separation.

**WARN-4 (bird-w4): Silent blur-snap correction**
Status: RESOLVED. Non-silent and semantically clean.
- `durNote` state declared at lines 207-209 (`React.useState('')`).
- `setDurNote('')` called in `onChange` (line 308) — clears on next keystroke.
- `onBlur` (line 325): sets `durNote` to `'Adjusted to 5–480 min range'` when `typed < DUR_MIN || typed > DUR_MAX`; clears otherwise. The check uses `parseInt(durDraft, 10)` (pre-clamp user input) — logic is correct; garbage/empty input path (`isNaN(typed)`) reverts silently as intended.
- Line 331: `{durNote && <div role="alert" style={{ fontSize: 11, color: TH.amberText, marginTop: 2 }}>{durNote}</div>}` — conditional render; correct for live-region AT announcement on DOM insertion.
- Semantics: amber `role="alert"` = corrective feedback (user action outcome). Muted persistent span = passive range guidance. The two coexist without semantic conflict; they use different DOM elements and different token roles.
- Note: bert chose "clear on next keystroke" (onChange) rather than "clear on next focus" (original recommendation). This is a defensible and arguably better choice — the note persists while the corrected value is shown, disappears as soon as editing resumes. Not a regression.

### New regression check (Duration block lines 296–332)

No new BLOCK or WARN findings introduced:
- No new hard-coded hex colors or px font-size values beyond the pre-existing `marginLeft: 4` (INFO-2, unchanged).
- The `role="alert"` div is not also referenced by `aria-describedby` — correct design; live regions self-announce and `aria-describedby` on the input correctly points only to the stable hint span.
- `fontSize: 11` on the alert div matches the hint span — consistent.
- `marginTop: 2` on the alert div — minimal spacing; no layout concern.
- The INFO findings (I1, I2, I3) from the original review are unchanged in scope and status.

---

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | Verified --re-review --mode new --files WhenSection.jsx, brand guide present | present |
| Prior UX-REVIEW.md loaded | Read reviews/UX-REVIEW.md | 4 WARN, 3 INFO prior findings loaded |
| Prior bird-REVIEW.json loaded | Read reviews/bird-REVIEW.json | 7 findings confirmed as re-check targets |
| Source read | Read WhenSection.jsx lines 195–332 (Duration block + state declarations) | confirmed |
| WARN-1 re-check | color token on hint span line 330 | TH.textMuted — RESOLVED |
| WARN-2 re-check | fontSize on hint span line 330 | 11 — RESOLVED |
| WARN-3 re-check | aria-describedby on input line 328 + id on span line 330 | wiring exact match — RESOLVED |
| WARN-4 re-check | durNote state + role=alert div lines 207-209, 325, 331 | amber role=alert fires on clamp, muted hint unchanged — RESOLVED |
| Regression scan | New branding, a11y, interaction regressions in lines 296-332 | none found |
| Mode recorded | new (re-review depth standard) | confirmed |
| Output updated | UX-REVIEW.md + bird-REVIEW.json written | Done |

---

## Proof Checklist

- [x] Required inputs present: --mode new supplied; WhenSection.jsx confirmed; raike-and-sons-brand-guide.md readable
- [x] raike-and-sons-brand-guide.md read in full before any visual checks (original review; unchanged)
- [x] design-system.css token values loaded (original review; unchanged)
- [x] Scope confirmed — WhenSection.jsx Duration block lines 296-332; durNote state lines 207-209
- [x] Mode recorded: new; standard depth applied; --re-review scoped to 4 prior WARNs + regression scan
- [x] All screens enumerated — 1 in-scope component (task-sidebar Duration field)
- [x] Brand conformance checked: WARN-1 (amberText semantic) confirmed resolved to TH.textMuted; WARN-2 (fontSize:9) confirmed resolved to 11; no new deviations
- [x] All 7 viewports — static assessment; re-review brief covers Duration block only; no structural layout changes that would alter prior viewport assessment
- [x] WCAG version pinned to 2.2 AA per BASE-NFR §3.5
- [x] a11y AUTOMATED (Step 4a): static — WARN-3 aria-describedby now wired correctly; no new a11y gaps introduced
- [x] a11y MANUAL (Step 4b): static — WARN-4 role=alert confirmed as live region; keyboard flow unchanged; target size unchanged (passes 2.5.8)
- [x] Interactions exercised: blur-snap correction now non-silent (durNote/role=alert); onChange clears note; Enter→blur unchanged
- [x] Env/i18n (Step 6a): no new px-only values or directional concerns introduced; dark/light token usage unchanged
- [x] React-logic issues flagged as INFO REFER→ernie (unchanged from original — INFO-3)
- [x] Test-inventory concerns: none raised
- [x] All findings carry File:Line + severity
- [x] Flag-and-refer emitted for React logic (ernie) — unchanged
- [x] Rubric Coverage Map — all 11 dimensions assessed in original review; no dimension status changed by bert fix (Visual Identity: RESOLVED amber misuse → now covered; Theme Consistency: fontSize resolved → now covered; Accessibility: aria-describedby resolved → now covered; Help Systems: silent correction resolved → now covered)
- [x] UX-REVIEW.md written to reviews/ in Contract-4 format with Proof-of-Work table
- [x] Status set DONE (0 BLOCK, 0 WARN, 3 INFO)
- [x] Scooter not needed — no contested standards or prior decisions required for this targeted re-review
- [x] No requirement/NFR/standard/approach changes made this review

---

## Findings

| # | Severity | File:Line | Screen | Viewport | Category | Description | Required Fix / Refer |
|---|----------|-----------|--------|----------|----------|-------------|----------------------|
| 1 | ~~WARN~~ RESOLVED | WhenSection.jsx:330 | Task sidebar / Duration field | all | branding / semantic color | Range hint used TH.amberText (original WARN-1). | Fixed: now TH.textMuted. |
| 2 | ~~WARN~~ RESOLVED | WhenSection.jsx:330 | Task sidebar / Duration field | all | branding / typography | fontSize:9 below brand minimum (original WARN-2). | Fixed: now fontSize:11. |
| 3 | ~~WARN~~ RESOLVED | WhenSection.jsx:328,330 | Task sidebar / Duration field | all | a11y — WCAG 1.3.1 | No aria-describedby / no span id (original WARN-3). | Fixed: aria-describedby="dur-range-hint" on input; id="dur-range-hint" on span. Wiring correct. |
| 4 | ~~WARN~~ RESOLVED | WhenSection.jsx:325,331 | Task sidebar / Duration field | all | interaction / UX | Silent blur-snap (original WARN-4). | Fixed: durNote state + role="alert" div with TH.amberText fires when typed value is out of range. Semantics clean (amber-for-alert, muted-for-hint). |
| 5 | INFO | WhenSection.jsx:299,330 | Task sidebar / Duration field | — | content standards | "min" abbreviation is standard and consistent with adjacent fields. | No action required. |
| 6 | INFO | WhenSection.jsx:330 | Task sidebar / Duration field | — | layout | marginLeft:4 on hint span is cosmetic in flex-column parent (original INFO-2). | Confirm rendering via visual check at desktop viewport if desired. No new concern. |
| 7 | INFO | WhenSection.jsx:202–205 | — | — | — | durDraft useState + useEffect sync pattern is React logic. | REFER→ernie |

---

## Viewport Coverage

Static source analysis; no Playwright run (no live server per review brief). No structural changes in the Duration block alter the prior viewport assessment.

| Viewport | Screens Assessed | Notes |
|----------|-----------------|-------|
| 320px (reflow-wcag) | static | unchanged — flex-wrap on parent row pre-existing |
| 375px (mobile-sm) | static | isMobile=true path unchanged; hint fontSize now 11 (was 9) — improved legibility on mobile |
| 430px (mobile-lg) | static | same as mobile-sm path |
| 768px (tablet) | static | desktop path |
| 1024px (laptop) | static | desktop path |
| 1440px (desktop) | static | primary review viewport |
| 1920px (wide) | static | no reflow concerns |

---

## Accessibility Audit (WCAG 2.2 AA — pinned by BASE-NFR §3.5)

| Check | SC | Tier | Status | Notes |
|-------|----|------|--------|-------|
| Reflow 320px / 400% zoom | 1.4.10 | manual/static | PASS | unchanged |
| Target size ≥ 24×24 (Minimum) | 2.5.8 AA | manual/static | PASS | input 65px × 26/30px; unchanged |
| 200% zoom | 1.4.4 | manual/static | PASS | inline px scale with browser zoom; unchanged |
| Color contrast AA text | 1.4.3 | static calc | PASS | TH.textMuted contrast verified both themes; TH.amberText on alert div same as prior passing calc |
| Non-text / UI contrast ≥ 3:1 | 1.4.11 | static | PASS | unchanged |
| All images have meaningful alt text | 1.1.1 | N/A | N/A | no images |
| Form inputs have associated labels | 1.3.1 | static | PASS | implicit label association correct |
| Info and relationships — hint linked to input | 1.3.1 | static | PASS | aria-describedby="dur-range-hint" now wired; WARN-3 resolved |
| Landmarks | 1.3.6 | static | N/A | not in scope |
| ARIA roles | — | static | PASS | role="alert" on durNote div is correct live region type for corrective feedback |
| Status messages (live regions) | 4.1.3 | static | PASS | durNote role="alert" fires on DOM insertion when clamping occurs; WARN-4 resolved |
| Content on hover/focus | 1.4.13 | N/A | N/A | no tooltip/popover |
| Screen-reader pass | — | static | PASS | aria-describedby wired; role=alert live region; primary AT gap (WARN-3) resolved |
| prefers-reduced-motion | 2.3.3 | N/A | N/A | no animation |
| prefers-color-scheme dark | — | static | PASS | TH.textMuted and TH.amberText both verified in THEME_DARK/THEME_LIGHT |
| RTL / long-string overflow | — | static | PASS | numeric content; no directional concern |
| CLS / layout-shift | — | static | PASS | hint span static; durNote conditionally appended below hint — no layout jump of surrounding elements expected |

---

## Brand Conformance

| Check | Status | Notes |
|-------|--------|-------|
| All colors via CSS tokens | PASS | TH.textMuted (hint) and TH.amberText (alert) are token references |
| Type sizes via CSS tokens | PASS | fontSize:11 on hint and alert match other inline guidance in this file; no new px deviation below brand minimum |
| Spacing via CSS tokens | PASS | marginLeft:4 and marginTop:2 are numeric inline (pre-existing pattern); no new token violation |
| Component variants match brand guide | PASS | Input style, label stacking, alert pattern follow established WhenSection conventions |
| Amber token semantic usage | PASS | Amber now reserved for corrective alert only (role="alert" durNote); passive hint uses textMuted — semantics clean |
| Iconography conformant | N/A | no icon changes |
| Logo usage conformant | N/A | not applicable |

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Visual Identity | covered | TH.textMuted for hint (resolved); TH.amberText for alert (correct) | WARN-1 resolved |
| Theme Consistency | covered | fontSize:11 matches other guidance text in file; both dark/light token paths verified | WARN-2 resolved |
| Interaction States | covered | blur-snap now surfaces amber alert; draft onChange clears note; Enter→blur unchanged | WARN-4 resolved |
| Accessibility | covered | aria-describedby wired (WARN-3 resolved); role=alert live region (WARN-4); target size passes 2.5.8 | Static pass; live AT pass recommended before production |
| Information Architecture | covered | Range hint (muted, persistent) + correction alert (amber, conditional) — clear two-tier help pattern | No IA concern |
| Content Standards | covered | "min" standard; "Adjusted to 5–480 min range" message is specific and actionable | No content issues |
| Help Systems | covered | Pre-entry range hint + post-clamp correction alert — full help loop now closed | WARN-4 resolved |
| Responsive Design | partial | No live server; fontSize:11 improves mobile legibility vs prior 9; flex-wrap pre-existing | Visual check at 375px still recommended (unchanged from original) |
| Iconography | N/A | No iconography in changed area | — |
| Performance Perception | covered | Blur-snap synchronous; durNote state update immediate; role=alert renders without async delay | No perceived-performance concern |
| Data Layout Consistency | covered | Hint + alert stack below input in same flex-column label; consistent with endTimeError pattern two lines below | Clean pattern reuse |

---

## Sign-off

Original review signed: Bird — 2026-06-26T00:00:00Z
Re-review signed: Bird — 2026-06-26T12:00:00Z
