# Traceability — juggler-sweep-duration — new

| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| R1 | Duration field free-typeable (no mid-keystroke snap to 1) | local input string state, commit-on-blur | juggler-frontend/src/components/tasks/sections/WhenSection.jsx (Duration input) | `WhenSection.test.jsx` describe('Duration field (999.889/890)') tests #1–3 — PASS | verified |
| R2 | Min 5 / max 480 enforced + surfaced; out-of-range corrected to nearest bound | named range constant mirroring task.schema.js | WhenSection.jsx (Duration input + range hint) | `WhenSection.test.jsx` describe('Duration field (999.889/890)') tests #4–8 (range attr/hint/clamp) + #12 (a11y aria-describedby) + #13–16 (clamp-notice alert) — PASS | verified |
| R3 | Unit indicated as minutes | label/suffix/placeholder "min" | WhenSection.jsx (Duration label) | `WhenSection.test.jsx` describe('Duration field (999.889/890)') test #9 (label) + #12 (hint "5–480 min") — PASS | verified |
| R4 | Native stepper + end-time projection preserved | onDurChange + addMinutesTo24h on commit (blur path) + onChange live-commit for in-range values | WhenSection.jsx (Duration input) | `WhenSection.test.jsx` describe('Duration field (999.889/890)') tests #10–11 (blur path) + `R4 (onChange live-commit)` test #17 (onChange path, no blur — T1 zoe gap now pinned) — ALL PASS | verified |
