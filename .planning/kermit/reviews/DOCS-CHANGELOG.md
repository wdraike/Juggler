# ABBY — juggler — chore (requirements register) — 2026-06-12

## Status: DONE

## Mode: chore
## Scope: juggler (service-level docs)

| Doc file | Action | Sections authored/updated |
|----------|--------|---------------------------|
| `juggler/docs/REQUIREMENTS.md` | created | Frontmatter · Functional requirements table (R1–R17 with acceptance criteria, status, code+test traceability, source) · Use cases (UC-1 individual contributor, UC-2 team lead, UC-3 freelancer) · Traceability summary (implemented/partial/planned counts, partial-gap table, NFR cross-references) |

---

## Proof of Work

| Step | Action | Result |
|------|--------|--------|
| Inputs check | --mode chore, --scope juggler present | present |
| Rubric loaded | Read BASE-DOCUMENTATION-RUBRIC.md + BASE-REQUIREMENTS-STANDARD.md §9 | Both loaded |
| Prior findings | Read .planning/kermit/reviews/DOCS-REVIEW.md | No prior DOCS-REVIEW.md exists |
| ARCH-REVIEW check | Grep for REFER→abby in ARCH-REVIEW.md | Not triggered (H6 cookie review has no REFER→abby line) |
| Scooter consulted | `Skill("scooter") --ask "juggler functional requirements and use cases"` | MCP offline — federated from authoritative docs + scheduler-rules (degraded mode, labelled partial confidence; cross-checked against KG-supplied R-list in prompt) |
| Doc inventory | `find juggler/docs -name "*.md"` | `juggler/docs/REQUIREMENTS.md` missing → action: create |
| Staleness scan | N/A — file did not exist; all content new | n/a |
| Code extraction | Grepped routes (task, project, schedule, ai, cal-sync, gcal, msft-cal, apple-cal, my-plan, data), MCP index.js (20 tools), ai.controller.js, scheduler/unifiedScheduleV2.js, slices/scheduler/, slices/task/, slices/ai-enrichment/, slices/user-config/, frontend CalendarGrid.jsx / AppLayout.jsx, DB migrations for schema fields | Evidence gathered for all 17 requirements |
| Status determination | Each requirement status determined from code existence + test existence — not guessed | 10 implemented, 4 partial, 3 planned |
| Docs authored | juggler/docs/REQUIREMENTS.md created with frontmatter type=reference, status=active, version=e7ed5c9, Last-updated=2026-06-12 | 1 created |
| Diátaxis quadrant | `reference` — requirements table is information-oriented lookup | Correct quadrant, no bleed |
| C4/ADR | No REFER→abby in ARCH-REVIEW.md | Not authored |
| Persistent CHANGELOG | No user-observable feature change this leg | n/a |
| doc-lint | `python3 ~/.claude/skills/_doclint/doc-lint.py juggler/docs/REQUIREMENTS.md --type requirements` | verdict: PASS, 0 findings |
| Self-verify links | grep for relative links | Anchor links (#section) only — no broken file-path links |
| Self-verify fences | awk fence-balance check | FENCES OK: 0 fences (doc is prose+tables, no code blocks) |
| DOCS-CHANGELOG | Written | Done |
| Scooter INBOX | Knowledge change notice written for new governing doc | Done |
| Prairie invoked | Running under Oscar dispatch model | Oscar dispatches prairie |

## Proof Checklist

- [x] --mode and --scope are present
- [x] BASE-DOCUMENTATION-RUBRIC.md loaded before authoring begins
- [x] Doc inventory built: juggler/docs/REQUIREMENTS.md missing → create; all other docs present → skip
- [x] Staleness measured from evidence: n/a (file was absent — new creation)
- [x] Mode-appropriate doc set authored (chore + WBS intent = the requirements register)
- [x] All sections grounded in code/config evidence — no [TBD] or placeholder text; planned Rs honestly flagged
- [x] Frontmatter authored (type: reference / status: active / version: e7ed5c9 / Last-updated: 2026-06-12)
- [x] Diátaxis quadrant: `reference` — requirements table is information-oriented; no quadrant bleed
- [x] C4/ADR: no REFER→abby trigger in ARCH-REVIEW.md — not authored
- [x] Runbook: n/a (not a runbook leg)
- [x] Persistent project CHANGELOG.md: n/a (no user-observable change this chore)
- [x] Authored docs self-verified: anchor links valid (not file paths); zero code fences to balance; doc-lint PASS
- [x] DOCS-CHANGELOG.md written
- [x] Prairie: Oscar dispatches (not standalone)
- [x] BLOCKs fixed: n/a — awaiting prairie run
- [x] Out-of-column issues: none requiring REFER
- [x] Output file written with Proof-of-Work table
- [x] Status: DONE
- [x] Scooter asked before authoring (degraded — MCP offline; federated from authoritative docs; labelled partial confidence)
- [x] Knowledge changes reported to Scooter INBOX (governing doc authored: requirements register)

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | WARN | `juggler/docs/REQUIREMENTS.md` R6 | Partial: time_remaining/WIP status implemented; dedicated clock-in/clock-out endpoints and actual-vs-estimated reporting not found in codebase. The PROJECT-BRIEF claims "clock in/out, log+compare actual vs estimated time" as a capability. | No fix needed in this doc leg; gap should be tracked in backlog as planned feature. |
| 2 | WARN | `juggler/docs/REQUIREMENTS.md` R9 | Partial: drag-and-drop UI implemented (CalendarGrid.jsx, AppLayout.jsx handleGridDrop) but no unit test for handleGridDrop scheduling logic. | REFER→telly: test coverage gap for drag-and-drop scheduling handler. |
| 3 | WARN | `juggler/docs/REQUIREMENTS.md` R17 | Partial: MCP server 20 tools implemented; per-client authorization tested at backend level but no dedicated MCP-layer isolation test. | REFER→telly: MCP per-client auth isolation test. |
| 4 | INFO | `juggler/docs/REQUIREMENTS.md` R12/R13/R14 | Planned: time reports, burn-down reports, capacity planning reports — zero code and zero tests as of 2026-06-12. Correctly documented as `planned`; not a doc defect. | Track in backlog when scheduling. |

## Sign-off
Signed: Abby — 2026-06-12T00:00:00Z
