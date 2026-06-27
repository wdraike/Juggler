# ABBY — juggler-frontend — new — 2026-06-26

## Status: DONE

## Mode: new
## Scope: juggler-frontend (change touches juggler-backend/docs/architecture/TASK-PROPERTIES.md — the canonical cross-layer task-field reference)

---

## Doc Inventory

| Doc file | Status | Action | Reason |
|----------|--------|--------|--------|
| `juggler-backend/docs/architecture/TASK-PROPERTIES.md` | exists, stale | updated | `dur` row said "Capped at 720m"; REST schema (task.schema.js) enforces min=5 max=480; body date was 2026-05-25 |
| juggler-frontend user/help docs | absent | none — deferred | No user-facing field-reference doc exists in juggler-frontend (only internal review .md files found). The change is documentable via the existing architecture reference only. |

---

## What Changed

**File updated:** `juggler-backend/docs/architecture/TASK-PROPERTIES.md`

**Section:** "Duration & Effective Time" table — `dur` row

**Before:** `int (minutes) | User | Capped at 720m. How much time the task occupies.`

**After:** `int (minutes), valid range 5–480 | User | How much time the task occupies. Unit is minutes. Valid range enforced by the REST API: min 5, max 480 (authority: src/schemas/task.schema.js taskUpdateSchema, PUT /api/tasks/:id). The task-sidebar "Duration (min)" field is free-typeable; values outside 5–480 are clamped to the nearest bound on blur with an amber notice. Cross-layer note (David follow-up): the hexagonal task facade (src/slices/task/facade.js) enforces min=1 max=1440, the MCP tool definition is unbounded, and an older doc cited 720m — all four caps disagree and should be reconciled into a single authoritative limit.`

**Frontmatter + body date:** bumped to 2026-06-26.

---

## Evidence Base

| Claim | Source |
|-------|--------|
| `dur` min=5 max=480 on PUT /api/tasks/:id | `juggler-backend/src/schemas/task.schema.js` line 17: `dur: z.number().int().min(5).max(480).optional()` |
| `taskUpdateSchema` extends `taskCreateSchema.partial()` — same range | `task.schema.js` line 37 |
| Frontend label "Duration (min)" + `DUR_MIN=5` + `DUR_MAX=480` | `juggler-frontend/src/components/tasks/sections/WhenSection.jsx` lines 26–29, 303, 330 |
| Free-typing now works; clamped on blur with amber notice | `WhenSection.jsx` lines 311–325 |
| Old doc said "720m" | `TASK-PROPERTIES.md` line 65 (pre-edit) |
| Facade disagrees: min=1 max=1440 | `juggler-backend/src/slices/task/facade.js` line 107 |
| MCP unbounded | `juggler-backend/src/mcp/tools/tasks.js` line 29 |

---

## David Follow-up (cross-layer cap disagreement — NOT resolved by abby)

Four distinct `dur` caps exist across the codebase; they should be reconciled to a single source of truth:

| Layer | File | Cap |
|-------|------|-----|
| REST API (sidebar save path) | `src/schemas/task.schema.js` `taskUpdateSchema` | min=5, max=480 |
| Hexagonal task facade | `src/slices/task/facade.js` | min=1, max=1440 |
| MCP tool | `src/mcp/tools/tasks.js` | unbounded |
| Prior doc | `TASK-PROPERTIES.md` (pre-edit) | 720m cap (source unclear) |

**No attempt was made to resolve this.** The updated TASK-PROPERTIES.md documents the REST-API cap (5–480) as the user-facing truth and calls out the disagreement explicitly for David to adjudicate.

---

## Proof of Work

| Step | Action | Result |
|------|--------|--------|
| Inputs check | --mode=new, --scope=juggler-frontend present | present |
| Rubric loaded | Read BASE-DOCUMENTATION-RUBRIC.md | loaded |
| Prior findings | DOCS-REVIEW.md not present in this leg's reviews dir | none |
| ARCH-REVIEW.md | checked for REFER→abby — not present in leg reviews dir | not triggered; no C4/ADR authored |
| Doc inventory | find juggler-frontend -name "*.md"; find juggler-backend -name "TASK-PROPERTIES.md" | 1 user-facing field doc found in backend; 0 user-facing docs in frontend |
| Staleness scan | dur row cited "720m"; task.schema.js enforces min=5 max=480; body date 2026-05-25 | stale → updated |
| Code extraction | Read task.schema.js, WhenSection.jsx, facade.js, mcp/tools/tasks.js | evidence gathered |
| Doc updated | Edit TASK-PROPERTIES.md dur row + frontmatter + body date | done |
| No user-facing frontend field doc | juggler-frontend/docs/ contains only internal review artifacts | recorded here; no fabricated doc tree |
| Persistent CHANGELOG | No juggler-frontend/CHANGELOG.md exists; TASK-PROPERTIES.md is an architecture reference, not a user changelog | n/a for this leg |
| Self-verify | No internal links added; no Mermaid blocks touched; no code fences added | no broken links or bad fences |
| Prairie | Running standalone — prairie not invoked (Oscar sequences separately) | deferred to Oscar |
| Knowledge changes | TASK-PROPERTIES.md is an architecture reference doc, not an ADR/requirements/NFR governing doc | n/a for Scooter INBOX |

## Proof Checklist

- [x] --mode and --scope present
- [x] BASE-DOCUMENTATION-RUBRIC.md loaded before authoring
- [x] Doc inventory built: TASK-PROPERTIES.md (update), juggler-frontend user docs (absent → deferred, recorded)
- [x] Staleness measured from evidence: dur row mis-stated 720m vs schema's 5–480; body date 2026-05-25 vs source newer
- [x] Mode-appropriate doc set authored: new feature → updated existing reference doc with new field semantics
- [x] All authored sections grounded in code/config evidence — no TBD or placeholder text
- [x] Frontmatter updated (last_updated field in YAML front matter + body date)
- [x] User-docs Diátaxis: TASK-PROPERTIES.md is an architecture/reference doc, not a user-facing tutorial — no quadrant-bleed
- [x] C4/ADR: not triggered (no REFER→abby in ARCH-REVIEW.md for this leg)
- [x] Runbook: not in scope for this change
- [x] Persistent CHANGELOG: no juggler-frontend CHANGELOG.md exists; architecture reference doc update does not warrant a user-facing changelog entry (no UI behavior observable outside the sidebar)
- [x] Self-verify: no links added, no Mermaid or code fences added — nothing to break
- [x] DOCS-CHANGELOG.md written
- [x] Prairie: deferred to Oscar's sequence (not standalone run)
- [x] BLOCKs: none yet (prairie not run)
- [x] Out-of-column issues: cross-layer cap disagreement noted as David follow-up, not acted on
- [x] Output file written with Proof-of-Work table
- [x] Status: DONE (all required doc work complete; prairie sequence pending Oscar)
- [x] Scooter: TASK-PROPERTIES.md is not a governing doc (ADR/requirements/NFR) — no INBOX write required

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | `juggler-backend/src/slices/task/facade.js:107` | Hexagonal task facade allows dur min=1 max=1440, disagreeing with REST schema min=5 max=480 | David follow-up — do not resolve autonomously |
| 2 | INFO | `juggler-backend/src/mcp/tools/tasks.js:29` | MCP tool `dur` is unbounded (no min/max), disagreeing with REST schema | David follow-up |
| 3 | INFO | juggler-frontend | No user-facing field-reference doc exists in juggler-frontend (docs/ contains only internal review files) | docs_deferred: Oscar to record as follow-up if user-help docs are desired |

## Sign-off

Signed: Abby — 2026-06-26T00:00:00Z
