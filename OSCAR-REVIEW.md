# Oscar Review — 2026-05-21 — rolling_anchor null backfill fix

## Decision: WARN — Commit approved with noted follow-ups

---

## Changed Files

| File | Category | Agent(s) Launched |
|------|----------|-------------------|
| juggler-backend/src/scheduler/runSchedule.js | Code logic | earnie, peneloppy, bert |
| juggler-backend/tests/expandRecurring.test.js | Test | tina |

---

## Agent Launch Decisions

| Agent | Launched | Reason | Result | Finding Count |
|-------|----------|--------|--------|---------------|
| earnie-code-critic | Yes | scheduler logic changed | WARN | 0 Critical, 2 Warn, 3 Info |
| tina-test-expert | Yes | code + test changed | WARN | 47/47 pass; coverage gap (backfill path, blocked by pre-existing uuid ESM issue) |
| peneloppy-security | Yes | DB write added in scheduler transaction | PASS | 0 CRITICAL, 0 HIGH, 1 Medium, 2 Low |
| bert-code-fixer | Yes | Fix W1 (log count misleads) | Fixed | W1 resolved |
| phillis-doc-cop | No | No .md files changed | N/A | — |
| cookie-monster-architect | No | No infra/schema/migration changes | N/A | — |
| big-brid-ux | No | No frontend changes | N/A | — |

---

## Review Summary

| Review | Critical/BLOCK | Warn | Status |
|--------|---------------|------|--------|
| CODE-REVIEW.md | 0 | 2 (W1 fixed by bert) | WARN→PASS |
| TEST-REVIEW.md | 0 | 1 (coverage gap, blocked by pre-existing issue) | WARN |
| SECURITY-REVIEW.md | 0 | 0 (1 Medium, 2 Low) | PASS |

---

## Findings Resolved

**W1 (Earnie → fixed by bert):** `Promise.all` log reported `_rollingBackfills.length` as "backfilled" even when `whereNull` filtered out concurrent writes. Fixed: `Promise.all` now captures per-row affected counts, sums them, and logs `A/N written` (actual vs candidates).

---

## Findings to Address (follow-up, not blocking)

**W2 (Earnie — Advisory):** No dedicated test for the "rolling task with no done history" branch (`if (!latestDone) return`). Covered indirectly by existing `'7-day interval generates instances'` test. Add an explicit named test.

**Tina — Coverage gap:** The backfill block inside `runScheduleAndPersist` has no integration test (seeds null anchor → runs scheduler → asserts DB write + correct next occurrence). Blocked by pre-existing uuid ESM incompatibility in `runScheduleIntegration.test.js` (not caused by this fix). Track as follow-up: fix uuid jest config, then add integration test.

**Peneloppy Medium — Unbounded Promise.all:** First-run burst of N concurrent UPDATE queries in transaction (no chunk cap). Steady-state: zero impact (whereNull guard fires once per task). Risk is acceptable for typical rolling task counts (<20/user); revisit if rolling tasks become high-volume.

**Peneloppy Low — Implicit injection guard:** `b.anchor` is safe (sourced from MySQL DATE column via isoToDateKey). Consider adding `if (!/^\d{4}-\d{2}-\d{2}$/.test(b.anchor)) return` before push for defence-in-depth.

---

## Accountability Statement

All required agents launched per rubric. No CRITICAL, HIGH, or BLOCK findings. Bert resolved W1. Remaining findings are advisory (W2, coverage gap, Medium/Low security). Commit is **APPROVED**.

Signed: Oscar, Technology Director — 2026-05-21T11:46:04Z
