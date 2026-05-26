# Documentation Review — Juggler When-Mode Simplification

**Reviewer:** Prairie Dawn
**Date:** 2026-05-25
**Standard:** DOCUMENTATION-STANDARD.md
**Scope:** 5 docs created/updated by Abby for the When-mode simplification

---

## Summary

| Status | Count |
|--------|-------|
| BLOCK  | 0     |
| WARN   | 5     |
| INFO   | 2     |

**Overall verdict: WARN**

No blocking violations. Five warnings require attention before the next review cycle.

---

## Files Reviewed

| File | Registry Status | mtime | Review Status | Issues |
|------|----------------|-------|--------------|--------|
| `juggler-backend/docs/architecture/TASK-PROPERTIES.md` | DIRTY (was 2026-05-19) | 2026-05-25 16:21 | PASS | — |
| `juggler-backend/docs/architecture/SCHEDULER-UI-STATE-MAP.md` | DIRTY (was 2026-05-19) | 2026-05-25 16:25 | WARN | ASCII tree diagrams; no Mermaid |
| `juggler-backend/docs/use-cases/task.controller.md` | NEW (not in registry) | 2026-05-25 16:27 | PASS | — |
| `juggler-backend/docs/architecture/SCHEDULER.md` | DIRTY (was 2026-05-19) | 2026-05-25 16:28 | WARN | Stale "Pinned" terminology; stale `when:"fixed"` test reference |
| `juggler-backend/docs/architecture/WHEN-MODE-REDESIGN.md` | NEW (not in registry) | 2026-05-25 16:29 | WARN | ADR structure incomplete: missing explicit Status and Consequences sections |

---

## BLOCK Findings (Must Fix)

None.

---

## WARN Findings (Should Fix)

### W-1: SCHEDULER-UI-STATE-MAP.md — ASCII tree diagrams, no Mermaid
**File:** `juggler-backend/docs/architecture/SCHEDULER-UI-STATE-MAP.md`
**Lines:** 27–56, 242–337
**Issue:** Two substantial ASCII/box-drawing tree diagrams (the pipeline flow and the UI control trees) use `│` box-drawing characters. The standard requires Mermaid for diagram content when Mermaid can express it. A `flowchart TD` or `graph LR` can represent the pipeline; nested bullet trees can replace the UI control decision trees without box-drawing characters.
**Fix:** Convert the pipeline diagram (lines 27–56) to a Mermaid `flowchart TD` block. Convert the UI control trees (lines 242–337) to annotated Mermaid `flowchart` or replace with clean nested lists (no `│` chars).

---

### W-2: SCHEDULER.md — "Pinned" in severity hierarchy is stale post-redesign
**File:** `juggler-backend/docs/architecture/SCHEDULER.md`
**Lines:** 29, 46
**Issue:** The severity hierarchy still reads "1. **Pinned** — user locked to a specific date/time. Immovable." The concept of "pinned" as a distinct named tier has been superseded by `placement_mode = 'fixed'`. Line 46 similarly says "Pinned tasks are placed first (Phase 0)." These are accurate as behavioral descriptions but use the old vocabulary. The WHEN-MODE-REDESIGN.md established that the correct term is "fixed" tasks. The document is internally inconsistent — line 86 already uses the correct terminology ("This is the sole immovability signal — `date_pinned` has been removed").
**Fix:** Replace "Pinned" with "Fixed (`placement_mode = 'fixed'`)" in the severity hierarchy at line 29. Update line 46 to read "Fixed tasks are placed first (Phase 0)."

---

### W-3: SCHEDULER.md — "Pinned eviction" test cases use removed concept
**File:** `juggler-backend/docs/architecture/SCHEDULER.md`
**Lines:** 700–706
**Issue:** The "Principle 3 — pinned eviction first" section and test cases PE-1, PE-2, PE-3 describe scenarios with "pinned P2," "pinned P1," and "unpinned P4 chain member." The `date_pinned` column has been removed. These test cases still encode the old dual-axis model. The term "pinned" in these scenarios should be updated to "fixed (`placement_mode = 'fixed'`)" to match the current architecture.
**Fix:** Rename the section to "Principle 3 — fixed task eviction first." Replace "pinned P2," "pinned P1," and "unpinned" with "fixed-mode" and "non-fixed" throughout the PE-1/PE-2/PE-3 rows.

---

### W-4: SCHEDULER.md — UC-15.3 references removed `when:"fixed"` syntax
**File:** `juggler-backend/docs/architecture/SCHEDULER.md`
**Line:** 618
**Issue:** UC-15.3 reads: `Fixed task NOT reset | when:"fixed" tasks keep their scheduled_at`. The `when:"fixed"` token has been removed — `fixed` is no longer stored in the `when` column. The correct signal is `placement_mode = 'fixed'`. This test case description is factually wrong post-redesign and will mislead anyone writing or debugging the corresponding test.
**Fix:** Update UC-15.3 to: `Fixed task NOT reset | Tasks with placement_mode='fixed' keep their scheduled_at`.

---

### W-5: WHEN-MODE-REDESIGN.md — ADR structure incomplete
**File:** `juggler-backend/docs/architecture/WHEN-MODE-REDESIGN.md`
**Issue:** The document is titled as an Architecture Decision Record (ADR) but is missing two conventional ADR sections:
1. **Status** — An ADR must declare its decision status (e.g., Accepted, Proposed, Superseded, Deprecated). The document has no such declaration. The reader cannot determine whether this decision is final, experimental, or rolled back without reading the full prose.
2. **Consequences** — A standard ADR section enumerating the tradeoffs accepted by this decision (both positive and negative consequences). The document has a "Why" section explaining the motivation and a "What Changed" section describing the implementation, but no section named "Consequences" that captures the ongoing cost/benefit of the decision.
**Fix:** Add a `## Status` section immediately after the Summary with value `Accepted` (or the correct status). Add a `## Consequences` section enumerating known tradeoffs (e.g., migration window, loss of `prev_when` undo history, new requirement that drag sends full `date`+`time`).

---

## Accuracy Findings

Accuracy check performed by reading code and cross-referencing claims in the docs directly.

### A-1: SCHEDULER.md — "Pinned" terminology in hierarchy (duplicate of W-2/W-3)
Already captured above. No additional accuracy-only findings that are not covered by W-2/W-3/W-4.

### A-2: SCHEDULER-UI-STATE-MAP.md — `when` stripped of 'fixed' in item object
**File:** `juggler-backend/docs/architecture/SCHEDULER-UI-STATE-MAP.md`
**Line:** 112
**Claim:** `when, // stripped of 'fixed'; empty string = anytime`
**Status:** PASS — This note is present and is consistent with the WHEN-MODE-REDESIGN.md statement that `'fixed'` is no longer stored in the `when` column. The comment is legacy-context accurate.

---

## Cross-Reference Check

All cross-references verified to exist on disk:

| Reference | Source doc | Exists? |
|-----------|-----------|---------|
| `docs/architecture/TASK-PROPERTIES.md` | WHEN-MODE-REDESIGN.md, task.controller.md | YES |
| `docs/architecture/SCHEDULER-UI-STATE-MAP.md` | WHEN-MODE-REDESIGN.md | YES |
| `docs/architecture/SCHEDULER.md` | WHEN-MODE-REDESIGN.md, task.controller.md | YES |
| `docs/use-cases/task.controller.md` | WHEN-MODE-REDESIGN.md | YES |
| `docs/architecture/WEATHER-INTEGRATION.md` | TASK-PROPERTIES.md | YES |
| `src/lib/placementModes.js` | task.controller.md | YES |

No broken cross-references.

---

## Frontmatter Check

All 5 files have valid frontmatter with all required fields:

| File | type | service | status | last_updated | tags |
|------|------|---------|--------|-------------|------|
| TASK-PROPERTIES.md | design | juggler | active | 2026-05-25 | type/design, service/juggler, status/active, topic tags |
| SCHEDULER-UI-STATE-MAP.md | design | juggler | active | 2026-05-25 | type/design, service/juggler, status/active, topic tags |
| task.controller.md | use-case | juggler | active | 2026-05-25 | type/use-case, service/juggler, status/active, topic tags |
| SCHEDULER.md | design | juggler | active | 2026-05-25 | type/design, service/juggler, status/active, topic tags |
| WHEN-MODE-REDESIGN.md | design | juggler | active | 2026-05-25 | type/design, service/juggler, status/active, architecture-decision, topic tags |

No frontmatter violations.

---

## Required Core Docs (Project-Level)

The following required baseline docs are absent from `juggler/juggler-backend/docs/`:

| Document | Status | Notes |
|----------|--------|-------|
| `PROJECT-BRIEF.md` | MISSING | Required for all projects |
| `architecture/README.md` | MISSING | Required for all projects |
| `api/README.md` | MISSING | Juggler has API routes — required |
| `mcp/<server>.md` | MISSING | `src/mcp/server.js` exists — MCP doc required |

These were already missing before this review cycle and are not introduced by the When-mode simplification. They are tracked here for completeness. Abby should create them in the next documentation pass.

---

## Symlink Check

The Obsidian vault backup at `/Users/david/Obsidian-Vault.bak-20260522-125146/` has a `juggler-docs` symlink pointing to `juggler/docs` (not `juggler/juggler-backend/docs`). The active vault path `/Users/david/Obsidian-Vault/` does not exist on disk. No symlink action taken — vault location must be resolved before symlink can be verified or created.

---

## INFO Findings (Nice to Have)

### I-1: WHEN-MODE-REDESIGN.md — no link to migration audit SQL
**Issue:** The doc references `AUDIT-date_pinned-mismatch.sql` as a file to run before the Knex migration. That file is not linked and its location is not stated. A future operator running the migration needs to find it.
**Fix:** Add the path to the audit SQL file, e.g., `src/db/migrations/AUDIT-date_pinned-mismatch.sql` or wherever it lives.

### I-2: SCHEDULER.md — "rigid" appears in test case names UC-1.9/UC-1.10/UC-8.6/UC-19.7
**Issue:** Several test case descriptions use "rigid habit" informally (meaning "recurring with a strict time window"), not the removed `rigid` DB column. This is not factually wrong, but it may confuse readers who know `rigid` was removed. Consider renaming to "RECURRING_RIGID habit" or "time-window habit" in the test case table.
**Fix:** Optional — rename "rigid habit" to "RECURRING_RIGID habit" in test case IDs where the distinction matters.

---

## Next Steps

- [ ] W-1: Convert ASCII pipeline/UI-tree diagrams to Mermaid in SCHEDULER-UI-STATE-MAP.md
- [ ] W-2: Update severity hierarchy line 29 in SCHEDULER.md: "Pinned" → "Fixed"
- [ ] W-3: Rename "Principle 3 — pinned eviction" section and PE-1/PE-2/PE-3 test cases
- [ ] W-4: Fix UC-15.3 description: `when:"fixed"` → `placement_mode='fixed'`
- [ ] W-5: Add `## Status` and `## Consequences` sections to WHEN-MODE-REDESIGN.md
- [ ] Track MISSING core docs (PROJECT-BRIEF.md, architecture/README.md, api/README.md, mcp doc) for next documentation sprint
- [ ] Resolve active Obsidian vault location before next Prairie run

---

Signed: Prairie Dawn — 2026-05-25

Overall: WARN

---

## Re-Verification — bert fixes — 2026-05-25

**Reviewer:** Prairie Dawn
**Files re-read:** SCHEDULER-UI-STATE-MAP.md, SCHEDULER.md, WHEN-MODE-REDESIGN.md

| WARN | File | Status | Notes |
|------|------|--------|-------|
| W-1 | SCHEDULER-UI-STATE-MAP.md | RESOLVED | Single `flowchart TD` Mermaid block present (lines 27–43); no ASCII box-drawing characters found. |
| W-2 | SCHEDULER.md | RESOLVED | Line 29: "Fixed (`placement_mode = 'fixed'`) — immovable" — correct terminology present. |
| W-3 | SCHEDULER.md | RESOLVED | Section header: "Principle 3 — fixed task eviction first"; PE-1/PE-2/PE-3 use "fixed-mode" and "non-fixed" throughout. |
| W-4 | SCHEDULER.md | RESOLVED | UC-15.3 (line 618): `` `placement_mode='fixed'` tasks keep their scheduled_at `` — correct. |
| W-5 | WHEN-MODE-REDESIGN.md | RESOLVED | `## Status` (line 156) and `## Consequences` (line 162) both present and populated. |

**Introduced issues:** None. Mermaid block is well-formed (single open/close pair). No broken cross-references. One minor residual: SCHEDULER.md line 424 uses "pinned" informally in a manual regression checklist item ("No pinned task blocks a P1 deadline task from placing"). This is prose context only, not a formal term definition — recorded as INFO, not a new WARN.

**Overall verdict: PASS**

All five WARN findings are resolved. No new BLOCK or WARN findings introduced by the fixes.

Signed: Prairie Dawn — 2026-05-25

---

## Oscar Summary

**Decision: PASS**
**Mode: --document**
**Date: 2026-05-25**

| Agent | Launched | Reason | Result |
|-------|----------|--------|--------|
| abby | Yes | mandatory | 5 docs created/updated |
| prairie | Yes | mandatory, sequential after abby | WARN (5 findings) |
| bert | Yes | WARN findings — fix before precommit | All 5 resolved |
| prairie (re-run) | Yes | verify bert fixes | PASS |

## Docs Created/Updated

| File | Action |
|------|--------|
| `juggler-backend/docs/architecture/TASK-PROPERTIES.md` | Updated — removed date_pinned/prev_when/rigid; fixed placement_mode |
| `juggler-backend/docs/architecture/SCHEDULER-UI-STATE-MAP.md` | Updated — datePinned→fixed, ASCII→Mermaid |
| `juggler-backend/docs/use-cases/task.controller.md` | Updated — UC-3 removed, UC-2 drag-pin path removed |
| `juggler-backend/docs/architecture/SCHEDULER.md` | Updated — pinned→fixed terminology |
| `juggler-backend/docs/architecture/WHEN-MODE-REDESIGN.md` | Created — ADR for the simplification |

**Next: /oscar --precommit**

Signed: Oscar, Technology Director — 2026-05-25

---

## Pre-commit Re-Verification — 2026-05-25

**Reviewer:** Prairie Dawn
**Trigger:** Final pre-commit check before staging commit
**Standard:** `/Users/david/Obsidian-Vault.bak-20260522-125146/docs/DOCUMENTATION-STANDARD.md`
**Files read:** All 6 primary docs + 11 review artifacts (BUILD-REVIEW.md, CODE-REVIEW.md, DESIGN-REVIEW.md, DOCS-REVIEW.md, OSCAR-REVIEW.md, SECURITY-REVIEW.md, TEST-REVIEW.md, UX-REVIEW.md, ZOE-REVIEW.md, juggler-backend/ARCH-REVIEW.md, juggler-backend/CODE-REVIEW.md)

---

### Primary Docs — Re-Verification

#### Frontmatter

All five architecture/use-case docs retain valid frontmatter. Spot-checked against current file state:

| File | type | service | status | last_updated | tags |
|------|------|---------|--------|-------------|------|
| TASK-PROPERTIES.md | design | juggler | active | 2026-05-25 | present and complete |
| SCHEDULER-UI-STATE-MAP.md | design | juggler | active | 2026-05-25 | present and complete |
| task.controller.md | use-case | juggler | active | 2026-05-25 | present and complete |
| SCHEDULER.md | design | juggler | active | 2026-05-25 | present and complete |
| WHEN-MODE-REDESIGN.md | design | juggler | active | 2026-05-25 | present and complete |

No frontmatter violations introduced. PASS.

#### Diagram format

SCHEDULER-UI-STATE-MAP.md: Mermaid `flowchart TD` block confirmed at lines 27–43. No ASCII box-drawing characters found. PASS.

All other primary docs contain no diagrams requiring Mermaid. PASS.

#### Cross-references

Re-checked all cross-references from prior cycle — all still resolve on disk. No new cross-references introduced since the last verification pass. PASS.

#### Stale terminology — new findings in SCHEDULER.md

This is the focus of the re-verification. The prior PASS verdict on terminology was based on W-2/W-3/W-4 being resolved. Re-reading SCHEDULER.md against the current file reveals that **three stale-terminology occurrences were not caught in the earlier bert fix pass**:

**New finding RV-W-1 (WARN):**
`juggler-backend/docs/architecture/SCHEDULER.md` line 46, Secondary principles section:

> "Pinned tasks are placed first (Phase 0) and all subsequent phases respect their slots."

The prior re-verify marked W-2 as RESOLVED based on line 29 being corrected. Line 46 is a separate sentence in the Secondary Principles section that still uses "Pinned tasks." This was the exact fix required in the original W-2 finding ("Update line 46 to read 'Fixed tasks are placed first (Phase 0)'") — and it was not applied. The file currently reads "Pinned tasks" at line 46. This is a WARN.

**New finding RV-W-2 (WARN):**
`juggler-backend/docs/architecture/SCHEDULER.md` line 76 (Implementation note):

> "4a → Phase 0 (pinned + markers)"

This inline phase-label comment still uses the old "pinned" label. It should read "fixed + markers" to match the current architecture. This was not identified in the original W-2 finding and was not caught in the bert fix pass.

**New finding RV-I-1 (INFO):**
`juggler-backend/docs/architecture/SCHEDULER.md` line 424 (Manual regression checklist):

> "No pinned task blocks a P1 deadline task from placing"

Noted in the prior re-verify as an INFO/prose context. Confirmed INFO only — informal usage in a checklist, not a formal term definition.

**New finding RV-I-2 (INFO):**
`juggler-backend/docs/architecture/SCHEDULER.md` line 723 (Diamond DAG table, DD-3):

> "Chain where earliest slots are blocked by a pinned task."

Informal "pinned" usage in a test-case scenario description. Not a formal definition. INFO only.

#### DOC-REGISTRY.md — stale status entries (WARN)

**New finding RV-W-3 (WARN):**
`juggler-backend/docs/DOC-REGISTRY.md` was last updated at 2026-05-25 16:35 — before the bert fixes resolved W-1/W-2/W-3/W-4/W-5. The registry currently shows:

| File | Status in Registry | Actual Current Status |
|------|-------------------|-----------------------|
| SCHEDULER-UI-STATE-MAP.md | WARN (ASCII diagrams) | PASS — Mermaid block present |
| SCHEDULER.md | WARN (stale terminology) | PARTIALLY RESOLVED — W-2 line 29 and W-3 PE-1/PE-2/PE-3 fixed; W-4 UC-15.3 fixed; but line 46 and line 76 remain stale (RV-W-1/RV-W-2 above) |
| WHEN-MODE-REDESIGN.md | WARN (ADR missing sections) | PASS — Status and Consequences sections present |

The registry must be updated to reflect the current state. Leaving WARN status against a PASS file misleads the next reviewer. This is a WARN: the registry is a live tracking document and its accuracy is part of the documentation standard.

---

### Review Artifacts — Verification

The review artifacts (BUILD-REVIEW.md, CODE-REVIEW.md, DESIGN-REVIEW.md, OSCAR-REVIEW.md, SECURITY-REVIEW.md, TEST-REVIEW.md, UX-REVIEW.md, ZOE-REVIEW.md, juggler-backend/ARCH-REVIEW.md, juggler-backend/CODE-REVIEW.md) are staged as `.md` files. Checked against the documentation standard:

**Format compliance:**
- All files are `.md` format. PASS.
- No diagrams present in any artifact. No Mermaid requirement triggered.
- No frontmatter required — review artifacts are operational records, not project documentation. The standard's frontmatter requirement applies to `docs/` content. PASS.

**Stale terminology in review artifacts:**
Review artifacts intentionally preserve the history of findings at the time they were written. CODE-REVIEW.md contains references to `datePinned`, `prev_when`, `_dragPin`, and the `unpinTask` endpoint throughout — these are historically accurate records of what existed at review time. They are not live documentation and are not subject to the stale-terminology rule. PASS.

ARCH-REVIEW.md and juggler-backend/CODE-REVIEW.md similarly describe the pre-implementation state. Correct as historical records. PASS.

**UX-REVIEW.md — open WARN:**
UX-REVIEW.md ends with a re-verification verdict of WARN (UX-2 banner text for non-cal-managed recurring tasks with `placementMode='fixed'`). The review artifact accurately reflects that this finding is still open. This is a UX concern, not a documentation violation. The artifact is correct. PASS as a document.

**OSCAR-REVIEW.md — currency:**
The OSCAR-REVIEW.md currently on disk covers the earlier "isFixed bug fix + unpinTask placement_mode reset" review cycle, not the When-mode simplification. The DOCS-REVIEW.md Oscar Summary section (added above) covers the When-mode simplification doc review. No conflict. PASS.

---

### Summary of New Findings

| ID | Severity | File | Finding |
|----|----------|------|---------|
| RV-W-1 | WARN | SCHEDULER.md line 46 | "Pinned tasks are placed first (Phase 0)" — "Pinned" not replaced with "Fixed" |
| RV-W-2 | WARN | SCHEDULER.md line 76 | Phase 0 label still reads "(pinned + markers)" — should be "(fixed + markers)" |
| RV-W-3 | WARN | DOC-REGISTRY.md | Registry status rows for SCHEDULER-UI-STATE-MAP.md and WHEN-MODE-REDESIGN.md still show WARN; should be updated to PASS |
| RV-I-1 | INFO | SCHEDULER.md line 424 | "No pinned task" in manual regression checklist — informal usage, not a formal term |
| RV-I-2 | INFO | SCHEDULER.md line 723 | "blocked by a pinned task" in DD-3 test scenario — informal usage |

**BLOCK findings: 0**
**WARN findings: 3 (RV-W-1, RV-W-2, RV-W-3)**
**INFO findings: 2 (RV-I-1, RV-I-2)**

---

### Required Actions Before Commit

- [ ] **RV-W-1:** `SCHEDULER.md` line 46 — replace "Pinned tasks are placed first (Phase 0)" with "Fixed tasks are placed first (Phase 0)"
- [ ] **RV-W-2:** `SCHEDULER.md` line 76 — replace "Phase 0 (pinned + markers)" with "Phase 0 (fixed + markers)"
- [ ] **RV-W-3:** `DOC-REGISTRY.md` — update status for `SCHEDULER-UI-STATE-MAP.md` to PASS (Mermaid resolved) and `WHEN-MODE-REDESIGN.md` to PASS (ADR sections added); update `SCHEDULER.md` issue column to reflect only the residual RV-W-1/RV-W-2 items; update `Last Reviewed` and `File mtime` columns for all three

---

### Overall Verdict: WARN

Three WARN findings prevent a clean PASS. All three are in `SCHEDULER.md` and `DOC-REGISTRY.md`. Two are single-line terminology fixes (RV-W-1 and RV-W-2) missed in the bert pass. One is a registry housekeeping update (RV-W-3). No BLOCK findings. No broken cross-references. No frontmatter violations. No Mermaid violations. No stale terminology in TASK-PROPERTIES.md, SCHEDULER-UI-STATE-MAP.md, WHEN-MODE-REDESIGN.md, or task.controller.md.

Fix RV-W-1, RV-W-2, and RV-W-3, then re-run this verification.

Signed: Prairie Dawn — 2026-05-25
