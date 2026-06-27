# BERT-LOG — juggler-sweep-duration — new — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode new present; --source resolved from reviews/ (TEST-REVIEW.md with 6 INFO findings + task dispatch spec) | present |
| Read context | read CLAUDE.md (juggler) + TEST-REVIEW.md + WhenSection.jsx (846 lines) + WhenSection.test.jsx (1014 lines, lines 858–1014 = new Duration tests) | done |
| Parse findings | extracted 6 INFO findings from TEST-REVIEW.md covering DUR_MIN/DUR_MAX constants, local draft state, min/max attrs, onBlur handler, range hint, label unit | 6 findings (all INFO, mode=new) |
| Apply fixes | 3 edits to WhenSection.jsx: (1) DUR_MIN/DUR_MAX exports, (2) durDraft hook state + sync effect, (3) Duration label+input JSX replacement | see Findings table |
| Adjacent-regression | grep DUR_MIN/DUR_MAX across src/ — only WhenSection.jsx references them (new exports, no external callers) | 0 external callers; no adjacent-regression risk |
| Self-verify fix | CI=true npx react-scripts test --watchAll=false WhenSection from juggler-frontend/ | 385/385 PASS (0 fail); file loads (JSX parsed by react-scripts) |
| REFER lines | 0 emitted | n/a |
| Output written | Write BERT-LOG.md + bert-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present: --mode new provided; TEST-REVIEW.md found in reviews/
- [x] Mode confirmed: new
- [x] All BLOCK findings addressed (fixed, disputed, or referred with reason) — all findings were INFO in mode=new; all actioned
- [x] No unapproved fallbacks introduced
- [x] No tests authored by bert (refers emitted where needed) — no test edits made
- [x] No docs authored by bert (refers emitted where needed) — no doc edits made
- [x] Disputed findings referred back to reviewer; design-level fixes referred up to cookie/Kermit — none needed
- [x] Blast-radius bound respected; adjacent-regression call-sites checked + suite run — 3 edits, 1 file, 0 external callers
- [x] Findings re-anchored after multi-fix edits — all 3 edits in same file; each subsequent edit verified against live file state
- [x] Fix self-verified: every mutated file parses/loads + targeted test runs (before DONE) — 385/385 GREEN
- [x] BERT-LOG.md written
- [x] Changed files listed

## Findings Actioned
| # | Severity | File:Line (reported) | File:Line (actioned) | Description | Fix Applied | Result |
|---|----------|----------------------|----------------------|-------------|-------------|--------|
| 1 | INFO | WhenSection.jsx:290 | WhenSection.jsx:28–29 | min={1} — should be 5 to mirror backend taskUpdateSchema min(5) | Added `export var DUR_MIN = 5; export var DUR_MAX = 480;` constants before addMinutesTo24h | Fixed |
| 2 | INFO | WhenSection.jsx:290 | WhenSection.jsx:28–29 | No max attribute — backend max(480) not reflected | Same DUR_MAX constant; applied in JSX as max={DUR_MAX} | Fixed |
| 3 | INFO | WhenSection.jsx:291 | WhenSection.jsx:202–205 | Math.max(1, parseInt||1) snaps on empty/invalid mid-keystroke | Added durDraftState/durDraft/setDurDraft via React.useState(String(dur)) + React.useEffect sync at top of WhenSection body | Fixed |
| 4 | INFO | WhenSection.jsx:289 | WhenSection.jsx:296 | Label text is "Duration" — no unit indicator | Changed label text to "Duration (min)" | Fixed |
| 5 | INFO | WhenSection.jsx:288–295 | WhenSection.jsx:298–321 | No onBlur handler — out-of-range clamping and end-time re-projection not implemented | Added onBlur: parseInt(durDraft), revert-to-dur on NaN, clamp to [DUR_MIN,DUR_MAX], setDurDraft, onDurChange, conditional onEndTimeChange | Fixed |
| 6 | INFO | WhenSection.jsx:288–295 | WhenSection.jsx:322 | No visible range hint | Added `<span style={{fontSize:9, color:TH.amberText, marginLeft:4}}>{DUR_MIN}–{DUR_MAX} min</span>` | Fixed |

## Refers Emitted
None.

## Changed Files
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
  - Lines 26–29: added DUR_MIN=5 / DUR_MAX=480 exported constants with schema citation comment
  - Lines 202–205: added durDraft local state (React.useState) + sync effect (React.useEffect) at top of WhenSection function body
  - Lines 296–323: replaced Duration label+input with draft-state-controlled input (min/max attrs, onChange free-type + conditional commit, onBlur clamp+commit, onKeyDown Enter→blur, unit label, range hint span)

## Self-Verify Result
Command: `CI=true npx react-scripts test --watchAll=false WhenSection` from `juggler-frontend/`

```
PASS src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx
PASS src/components/tasks/sections/__tests__/WhenSection.timezone.test.jsx (5.277 s)
PASS src/components/tasks/sections/__tests__/WhenSection.recurrence.test.jsx (5.747 s)
PASS src/components/tasks/sections/__tests__/WhenSection.test.jsx (6.542 s)
PASS src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx (6.923 s)

Test Suites: 5 passed, 5 total
Tests:       385 passed, 385 total
Time:        8.499 s
```

All 385 tests GREEN (375 existing + 10 previously-RED new + 1 previously-passing new = 385).

## Deviations from Design Spec
None. Implementation matches the spec exactly:
- DUR_MIN/DUR_MAX constants: exact match
- Hook placement: immediately after props destructuring, before BTN_H (unconditional)
- onChange guard: `raw !== ''` → parseInt → isNaN check → String(n)===raw exact-integer guard → range check → commit
- onBlur: revert-to-dur on NaN, Math.min/max clamp, setDurDraft + onDurChange + conditional onEndTimeChange
- onKeyDown: Enter → blur
- Hint span: `{DUR_MIN}–{DUR_MAX} min` with `TH.amberText` (same color as endTimeError — constraint indicator, not generic muted text)

## Sign-off
Signed: Bert — 2026-06-26T00:00:00Z

---

# BERT-LOG (Run 2) — juggler-sweep-duration — UX-REVIEW.md WARN fixes — new — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode new present; --source UX-REVIEW.md resolved; 4 WARN, 3 INFO, 0 BLOCK | present |
| Read context | read CLAUDE.md (juggler) + UX-REVIEW.md + WhenSection.jsx (874 lines after run-1 edits) + colors.js | done |
| Parse findings | extracted 4 WARN findings from UX-REVIEW.md; 3 INFO (not actioned at standard depth per --fix WARN default; dispatch explicitly requested all 4 WARNs) | 4 WARN actioned |
| Verified TH.textMuted | grep colors.js — `textMuted` key present in THEME_DARK (#8A8070) and THEME_LIGHT (#5C5A55); lStyle at line 218 already uses TH.textMuted | confirmed |
| Apply fix WARN-1 | Edit WhenSection.jsx line 330: color TH.amberText → TH.textMuted on range hint span | Fixed |
| Apply fix WARN-2 | Edit WhenSection.jsx line 330: fontSize 9 → 11 on range hint span | Fixed |
| Apply fix WARN-3 | Edit WhenSection.jsx line 328: aria-describedby="dur-range-hint" on input; line 330: id="dur-range-hint" on span | Fixed |
| Apply fix WARN-4 | Edit WhenSection.jsx lines 207-209: durNote state; line 308: setDurNote('') in onChange; lines 324-325: typed/note detection in onBlur; line 331: {durNote && <div role="alert">} amber notice render | Fixed |
| Adjacent-regression | grep durNote, setDurNote across src/ — only WhenSection.jsx; no external callers | 0 external callers |
| Self-verify parse | react-scripts build — compiled with warnings (all pre-existing, none from WhenSection.jsx) | PARSE OK |
| Self-verify test | CI=true npx react-scripts test --watchAll=false WhenSection from juggler-frontend/ | 385/385 PASS |
| REFER lines | 0 emitted | n/a |
| Output written | Appended BERT-LOG.md + updated bert-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present: --mode new provided; UX-REVIEW.md found; 4 WARN targeted
- [x] Mode confirmed: new
- [x] All BLOCK findings addressed — 0 BLOCKs in UX-REVIEW.md
- [x] All 4 WARN findings addressed
- [x] No unapproved fallbacks introduced — no || or ?? added
- [x] No tests authored by bert
- [x] No docs authored by bert
- [x] Disputed findings referred back to reviewer — none disputed
- [x] Design-level fixes referred up to cookie/Kermit — none needed
- [x] Blast-radius bound respected — 4 edits, 1 file, ~14 lines changed total
- [x] Adjacent-regression call-sites checked — durNote/setDurNote are local; no external callers
- [x] Findings re-anchored after multi-fix edits — edits 1-4 applied top-to-bottom; each subsequent edit verified against live file state shown by Read after each round-trip
- [x] Fix self-verified: build parsed (no WhenSection errors); 385/385 tests GREEN
- [x] BERT-LOG.md appended
- [x] Changed files listed

## Findings Actioned
| # | Severity | UX-REVIEW Finding | File:Line (actioned) | Description | Fix Applied | Result |
|---|----------|--------------------|----------------------|-------------|-------------|--------|
| WARN-1 | WARN | UX-REVIEW #1 — amber semantic misuse on range hint | WhenSection.jsx:330 | `color: TH.amberText` on passive range hint conflicts with amber=error semantic used in this component | Changed to `color: TH.textMuted` (verified key exists in THEME_DARK and THEME_LIGHT) | Fixed |
| WARN-2 | WARN | UX-REVIEW #2 — fontSize:9 below brand minimum | WhenSection.jsx:330 | 9px falls below brand-minimum readable text size | Changed `fontSize: 9` to `fontSize: 11` | Fixed |
| WARN-3 | WARN | UX-REVIEW #3 — aria-describedby missing | WhenSection.jsx:328,330 | Range hint not programmatically linked to input; AT users do not hear "5–480 min" on focus | Added `aria-describedby="dur-range-hint"` to input; added `id="dur-range-hint"` to hint span | Fixed |
| WARN-4 | WARN | UX-REVIEW #4 — blur-snap correction silent | WhenSection.jsx:207-209,308,324-325,331 | Out-of-range clamp correction not surfaced to user; silent value change confuses users who typed without reading the hint | Added `durNote` state; `setDurNote('')` in onChange; typed/note detection in onBlur; amber `role="alert"` div rendered when non-empty; persists until next keypress | Fixed |

## Refers Emitted
None.

## Changed Files
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
  - Lines 207-209: added `durNote` state (React.useState(''))
  - Line 308: added `setDurNote('')` in onChange handler (clears note on keypress)
  - Lines 324-325: added typed/note detection in onBlur (sets amber notice when clamped)
  - Line 328: added `aria-describedby="dur-range-hint"` to duration input
  - Line 330: changed range hint span — `id="dur-range-hint"`, `fontSize: 9` → `11`, `color: TH.amberText` → `TH.textMuted`
  - Line 331: added `{durNote && <div role="alert" ...>}` amber clamp notice

## Resolved TH Color Key
`TH.textMuted` — present in THEME_DARK as `#8A8070` and THEME_LIGHT as `#5C5A55`. Already used for field labels in `lStyle` (line 218) — consistent with the neutral label pattern in this component.

## Self-Verify Result (Run 2)
Command: `CI=true npx react-scripts test --watchAll=false WhenSection` from `juggler-frontend/`

```
PASS src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx
PASS src/components/tasks/sections/__tests__/WhenSection.timezone.test.jsx (5.371 s)
PASS src/components/tasks/sections/__tests__/WhenSection.recurrence.test.jsx (5.663 s)
PASS src/components/tasks/sections/__tests__/WhenSection.test.jsx (6.54 s)
PASS src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx (6.901 s)

Test Suites: 5 passed, 5 total
Tests:       385 passed, 385 total
Time:        8.452 s
```

All 385 tests GREEN.

## Sign-off (Run 2)
Signed: Bert — 2026-06-26T01:00:00Z
