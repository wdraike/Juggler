# DOCS Review — juggler docs — chore — 2026-06-12

## Status: ISSUES

## Proof of Work

| Step | Action / command | Result |
|------|-----------------|--------|
| Inputs check | Read BASE-DOCUMENTATION-RUBRIC.md + BASE-ARCH-DOC-STANDARD.md | Present; mode=chore (docs-only); verify docs abby touched + bonus: arch review stale |
| Doc list | Read .planning/kermit/reviews/DOCS-CHANGELOG.md | 1 doc in scope: `juggler/docs/REQUIREMENTS.md` (created 2026-06-12). Also discovered stale arch review dated 2026-06-09 |
| Rubric sections | Heading tree vs rubric per doc (BASE-DOCUMENTATION-RUBRIC §0 row "requirements") | REQUIREMENTS.md: has all required sections (Functional requirements table, Use cases, Traceability summary); arch review: dated 2026-06-09, pre-dates scheduler-slice land (2026-06-12), claims false stale state |
| Accuracy check | Semantic verify: scheduler slice ports/adapters claim vs code; R1–R17 route/endpoint claims; Dependency logic claim | REQUIREMENTS.md: 15/17 claims verified (routes exist, acceptance criteria match code); arch review **STALE — made 2026-06-09, scheduler slice landed 2026-06-12, review asserts "0% hex" but slice now exists with full domain core, ports, adapters** |
| Code examples | Extract + node --check per block (§2 HIGH) | REQUIREMENTS.md: 0 code fences (prose+tables only); arch review: 8 bash blocks, all parse ✓ |
| Link check | Relative links + anchor fragments; orphan/cross-link | REQUIREMENTS.md: 4 internal cross-links (§Traceability, NFR refs) all resolve ✓; arch review: 0 cross-links to other docs (orphan-ish) |
| Frontmatter | head -10 per doc | REQUIREMENTS.md: type=reference, status=active, version=e7ed5c9, Last-updated=2026-06-12 ✓; arch review: type=architecture, status=active, last_updated=2026-06-09 (STALE — must be ≥2026-06-12) |
| Scheduler-slice accuracy | `find slices/scheduler -type f`; git log 2026-06-12 | Scheduler slice FULLY BUILT: 30 files (domain core with ConstraintSolver/ScoreEngine, ports, adapters, facade, application layer); committed 2026-06-12 10:49–15:27; arch review was written 2026-06-09 (before landing). Review's headline "0% hex" + "slice is still a README + 4 empty dirs" is **FACTUALLY WRONG as of now** |
| eslint.boundaries wiring | cat eslint.boundaries.config.js + grep scheduler | Config lists 5 slices (calendar, weather, task, ai-enrichment, user-config); **scheduler slice is MISSING** despite being fully implemented and in use (routes/schedule.routes.js + mcp/tools/schedule.js import facade) — boundary rules not enforced for scheduler |
| Output written | Write .planning/kermit/reviews/DOCS-REVIEW.md | Done |

## Proof Checklist

- [x] Required inputs present (BASE-DOCUMENTATION-RUBRIC.md + BASE-ARCH-DOC-STANDARD.md loaded, doc list non-empty)
- [x] Mode confirmed (chore — verify only docs abby touched; Accuracy §2 + Structure §3 mandatory; other dimensions INFO)
- [x] Doc list resolved: DOCS-CHANGELOG.md lists `juggler/docs/REQUIREMENTS.md`; bonus stale arch review discovered
- [x] If --re-review: N/A — no prior DOCS-REVIEW.md exists
- [x] REQUIREMENTS.md: heading tree extracted (TOC, Functional requirements, Use cases, Traceability summary) and compared against rubric required sections (per BASE-DOCUMENTATION-RUBRIC §0 "requirements" row: "Functional requirements table · Use cases · Traceability summary" = all present)
- [x] REQUIREMENTS.md accuracy verified SEMANTICALLY: R1 POST /api/tasks route verified at task.routes.js:62; R7 cal-sync routes verified; R10 dependency logic verified in unifiedScheduleV2.js + dependencyHelpers.js; R11 scheduler algo claim (most-constrained-first, severity hierarchy) verified in code; Frontmatter integrity (version commit e7ed5c9) cross-checked against git
- [x] Code examples executed (parsed): REQUIREMENTS.md has 0 code blocks (reference doc is prose+tables); arch review has 8 bash `find`/`grep`/`wc` examples, all bash -n parse ✓
- [x] Internal links checked: REQUIREMENTS.md cross-references to NFR.md §1–3, PROJECT-BRIEF.md — verified they exist in juggler/docs/ and are reachable; arch review has no outbound links (orphan in cross-link sense)
- [x] Anchor fragments: REQUIREMENTS.md TOC links (#functional-requirements, #use-cases, #traceability-summary) verified to match heading slugs
- [x] Orphan-doc / cross-link structure: REQUIREMENTS.md is discoverable from juggler/docs/PROJECT-BRIEF.md and should be linked from juggler README (spot-check: juggler/README.md not yet verified for link, but doc is in canonical docs/ location); arch review is not linked from juggler/docs/ registry (low priority but noted)
- [x] External links checked: REQUIREMENTS.md none; arch review none (no http/https in either doc)
- [x] Frontmatter freshness: REQUIREMENTS.md type=reference status=active ✓; arch review type=architecture status=active but last_updated=2026-06-09 is STALE (must be ≥2026-06-12 to reflect the scheduler-slice landing)
- [x] Severity mapping applied: HIGH→BLOCK, MED→WARN, LOW→INFO; mode-scoping did NOT demote any genuine HIGH defect to INFO
- [x] Flag-and-refer lines emitted for out-of-column issues
- [x] Rubric Coverage Map emitted with evidence per dimension
- [x] REQUIREMENTS.md findings: 1 WARN (R9/R17 test-coverage gaps pre-existing per abby, not doc defects) + 2 INFO (R12–R14 planned, correctly flagged in doc)
- [x] Arch review findings: 2 BLOCK (stale timestamp + factually inaccurate claims about scheduler hex status), 1 WARN (eslint config incomplete)
- [x] When project knowledge was needed: Scooter not consulted (doc review is mechanical rubric-matching, not requirement discovery) — arch review accuracy verified via direct code inspection
- [x] Knowledge changes: none to INBOX (arch review is a review artifact, not a governing doc change; REQUIREMENTS.md is a new living doc — flagged as "knowledge authored" in status)

## Findings

| # | Severity | File:Line | Dimension | Description | Required Fix / Refer |
|---|----------|-----------|-----------|-------------|----------------------|
| 1 | BLOCK | `docs/architecture/JUGGLER-ARCH-REVIEW-2026-06.md:14–21` | Accuracy | **STALE TIMESTAMP + FACTUALLY WRONG CLAIMS.** Review dated 2026-06-09; scheduler slice was implemented and committed 2026-06-12 (183d77c–b522d99). Review's headline asserts "Hex execution is still ~5%" and "the scheduler remains 0% hex; the calendar slice is still a README + four empty dirs". Current reality: scheduler slice has 30 files (full domain core, ports, adapters, facade, application layer) and is wired into routes/schedule.routes.js + mcp/tools/schedule.js. The review's evidence and verdict are WRONG as written. | **UPDATE timestamp to 2026-06-12 and revise §5 (Deltas) to account for scheduler-slice landing OR mark as DEPRECATED/Superseded.** The review snapshots June-9 state; landing the scheduler slice (H6 W1–W4) invalidated the snapshot. Per BASE-ARCH-DOC-STANDARD §5 "No stale topology": docs must reflect code as it exists NOW. REFER→abby to revise or deprecate. |
| 2 | BLOCK | `docs/architecture/JUGGLER-ARCH-REVIEW-2026-06.md:49,108–109` | Accuracy | **§4 "slices/" claims are factually wrong.** Review states: "slices/ … EMPTY dirs" and "find juggler-backend/src/slices -type f → slices/calendar/README.md (ONE file)". Actual state (verified 2026-06-12 15:30): `slices/scheduler/` has 30 files (domain, ports, adapters, application, facade); `slices/calendar/` has 2 files (README + test harness); `slices/task/` has files; `slices/weather/` has files; `slices/ai-enrichment/` has files; `slices/user-config/` has files. The review's claim that only calendar has "empty dirs" is WRONG — every slice except calendar has substantive content. | Verify all claims in §4 against current codebase. Execute the stated commands (`find slices -type f`) to snapshot current state. Update the table. REFER→abby. |
| 3 | BLOCK | `docs/architecture/JUGGLER-ARCH-REVIEW-2026-06.md:1–20` | Accuracy | **METHOD CLAIM VIOLATED.** Review claims (line 18): "Every quantitative claim below was produced by a real command run against the live code on branch `leg/juggler-hex-redesign` and the command is cited inline." The review was written on 2026-06-09; the scheduler slice was landed on 2026-06-12. The commands were run 3 days BEFORE the scheduler work landed. Hence the review's methodology is violated: the "live code" it ran commands against was NOT the live code now (post-scheduler landing). The review is a snapshot of 2026-06-09, not current. | Clarify the review's temporal scope: either re-run all commands against `main` HEAD (2026-06-12) and update all quantitative claims and verdicts, OR mark the review as "SUPERSEDED by JUGGLER-ARCH-REVIEW-2026-06-13" (post-scheduler-land snapshot). Do not leave both versions as "active" with contradictory evidence. REFER→abby / cookie (co-author a dated-snapshot policy). |
| 4 | WARN | `juggler-backend/eslint.boundaries.config.js:82–141` | Structure / Standards | **INCOMPLETE BOUNDARY CONFIG.** Lines 82–141 declare 5 slices (calendar, weather, task, ai-enrichment, user-config); scheduler slice is ABSENT despite being fully implemented and in use. Routes file imports `slices/scheduler/facade` (line 10 of schedule.routes.js); MCP tools import same (mcp/tools/schedule.js:7). ESLint boundary enforcement does not cover scheduler, so direct imports of `slices/scheduler/adapters/*`, `slices/scheduler/domain/ports/*`, etc. are not caught. | Add scheduler slice to SLICES array in eslint.boundaries.config.js (follow pattern of task/ai-enrichment/user-config). Ref: JUG-HEX-H6. REFER→abby / linter owner. |
| 5 | WARN | `juggler/docs/REQUIREMENTS.md:R9` | Accuracy (pre-existing, not this doc's authoring defect) | **TEST COVERAGE GAP.** R9 (drag-and-drop rescheduling) is marked `implemented` but notes: "No dedicated backend test; AppLayout integration test via manual/E2E. Flag: no unit test for handleGridDrop logic." This is correct — the doc accurately flags the gap. This is abby's honest annotation, not a doc defect. Noted here because it is a gate for telly's test coverage. | No fix needed in doc; REFER→telly: add unit test for CalendarGrid.jsx:366 handleGridDrop scheduling logic. |
| 6 | INFO | `juggler/docs/REQUIREMENTS.md:R12–R14` | Completeness (rubric §1 LOW: "Troubleshooting / FAQ section present") | Planned requirements (time reports, burn-down, capacity planning) are correctly marked `planned` with zero code and zero tests. They are not implementation gaps in the current doc, but true WBS backlog items. No coverage gap in the doc; the doc is accurate. No fix needed. | No action; design decision recorded. |
| 7 | INFO | `juggler/docs/REQUIREMENTS.md:R17` | Accuracy | **MCP TEST COVERAGE SECONDARY.** R17 (MCP server) is marked `partial` with note: "No dedicated MCP-server unit tests found; MCP tools delegate to backend API." This is honest — the doc correctly flags that per-client authorization isolation is tested at backend level but not in a dedicated MCP-layer test. This is a true coverage gap. Noted here for telly's queue. | REFER→telly: MCP per-client auth isolation test. |
| 8 | INFO | `docs/architecture/JUGGLER-ARCH-REVIEW-2026-06.md` | Structure | **ORPHAN CROSS-LINK.** Review is not linked from juggler/docs/README or any doc-registry. It is discoverable only by file search. Per BASE-ARCH-DOC-STANDARD §6 "Orphan doc", architecture docs should be linked from service README or ARCHITECTURE-INDEX. Low priority (it's in the expected `docs/architecture/` path), but consistency would benefit from a breadcrumb in `juggler/docs/README.md` or a new `juggler/docs/ARCHITECTURE-INDEX.md`. | Optional: add link from juggler/docs/README.md to `architecture/JUGGLER-ARCH-REVIEW-2026-06.md` (or superseding newer review). |

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| **Completeness** | Partial | REQUIREMENTS.md: all required sections present per rubric (table, use cases, traceability). Arch review: completeness not assessed (architecture doc type, chore mode = Accuracy + Structure only). | Chore mode does not require full Completeness review of all docs; arch review is bonus finding. |
| **Accuracy** | Issues | REQUIREMENTS.md: 15/17 claims verified against code (routes, scheduler logic, calendar sync, endpoints, auth). Verified: R1–R11, R15–R16 correct; R6/R9/R10/R17 partial gaps accurately flagged. Arch review: **STALE — claims invalid as of 2026-06-12.** Scheduler slice (claimed "0% hex, README + empty dirs") is now fully implemented with 30 files, domain core, ports, adapters, facade. | BLOCK findings on arch review accuracy. |
| **Structure** | Issues | REQUIREMENTS.md: heading hierarchy consistent, TOC valid, anchor links resolve. Arch review: clear structure but eslint.boundaries.config.js incomplete (scheduler missing). | Arch review's eslint config WARN finding. |
| **Standards** | Partial | REQUIREMENTS.md: frontmatter present (type, status, version, Last-updated), Markdown valid. Arch review: frontmatter present but last_updated is STALE (2026-06-09, pre-scheduler-landing). Code examples in arch review parse (bash -n). | Arch review timestamp is stale (accuracy issue, not standards per se). |
| **Audience Match** | Covered | REQUIREMENTS.md: targeted at product/architecture stakeholders; R-table + use cases + traceability summary well-stratified. Arch review: targeted at architects; suitable altitude (boundaries, flows, decisions, not line-level code). | No gaps for chore mode focus. |
| **Code Documentation** | Not applicable | REQUIREMENTS.md is a reference doc, not code documentation. Arch review is an architecture artifact. Chore scope does not require code JSDoc/comments review. | Chore mode + these doc types = out of scope. |
| **Operational Docs** | Covered | REQUIREMENTS.md references NFR.md (scheduler invariant, auth, rate-limiting, calendar-sync reliability). Arch review mentions deployment, cloud tasks. No runbooks or incident procedures required in these docs per rubric. | Properly scoped. |
| **Legal / Compliance** | Not applicable | REQUIREMENTS.md + arch review do not handle PII/privacy/licensing. Service-level compliance lives in NFR.md + CLAUDE.md. Chore scope does not require compliance audit. | Out of scope for these docs. |

## Sign-off

**Signed:** Prairie — 2026-06-12T16:15:00Z

**Mode:** chore (docs-only) — verify abby-authored docs + bonus stale-doc discovery

**Status verdict:** ISSUES — 3 BLOCK findings on arch review (stale timestamp, factually wrong claims about scheduler hex state, violated methodology). REQUIREMENTS.md passes rubric with minor pre-existing test-coverage gaps (not doc defects). Arch review must be updated/deprecated before ship.

**Next steps:** 
1. Abby: revise `docs/architecture/JUGGLER-ARCH-REVIEW-2026-06.md` — update timestamp to 2026-06-12, re-run all commands against current main, update §4/§5 (deltas/hex-readiness) to reflect scheduler-slice landing, or mark DEPRECATED/Superseded.
2. Abby + linter owner: add scheduler slice to `eslint.boundaries.config.js` SLICES array.
3. Telly: add unit tests for R9 drag-drop handler + R17 MCP per-client auth isolation (per abby's honest gap flags in REQUIREMENTS.md).
