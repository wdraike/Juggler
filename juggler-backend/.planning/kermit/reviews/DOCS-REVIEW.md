# DOCS Review — juggler-backend (999.894) — chore — 2026-06-26

## Status: DONE

All documentation accurately reflects the code invariant. No BLOCK or WARN findings.

---

## Proof of Work

| Step | Action / command | Result |
|------|-----------------|--------|
| Rubric load | Read BASE-DOCUMENTATION-RUBRIC.md §2 (Accuracy) + §3 (Structure) | Present; 8 dimensions mapped, mode-specific scope applied |
| Doc list | Resolved from explicit FILES... argument | 2 files: TASK-PROPERTIES.md, TASK-STATE-MATRIX.md |
| SPEC read | Read `juggler-backend/.planning/kermit/999.894/SPEC.md` | Full invariant, code citations, chokepoints table, flip-handling, caveat directive extracted |
| Code verification — `taskValidation.js` | Read lines 85–100, 324–331 | `isFixedRecurringConflict()` at line 98 ✓; `validateTaskInput()` calls it at line 329-330 ✓ |
| Code verification — `UpdateTask.js` | Read lines 145–154 | HTTP PUT path calls `self.validation.isFixedRecurringConflict()` at line 151-152 ✓ |
| Code verification — `tasks.js` (MCP) | Read lines 275–286 | MCP `update_task` calls `isFixedRecurringConflict()` at line 283-284 ✓ |
| Code verification — `ImportData.js` | Read lines 115–125 | Bulk import calls `taskValidation.isFixedRecurringConflict()` at line 122-123 ✓ |
| Semantic verification — chokepoints | All 4 paths verified calling the helper; no inlined literals | ✓ SPEC requirement met: single source of decision |
| Semantic verification — flip handling | HTTP/MCP update paths read existing row, merge with body, test effective state | ✓ Matches SPEC: "evaluate the rule against the EFFECTIVE merged" |
| Semantic verification — orthogonality note | TASK-PROPERTIES.md line 34: "any mode EXCEPT `fixed` may be recurring" | ✓ Corrected from prior "any mode can be recurring"; cross-references new subsection |
| Semantic verification — Field Visibility caveat | TASK-STATE-MATRIX.md line 315-320: Recurrence/Fixed cell is "✅ ¹", footnote explains backend rejection without asserting frontend behavior | ✓ Matches SPEC: not silently flipped; caveated; flags UI-vs-backend tension |
| Code example syntax | Extracted function from TASK-PROPERTIES.md lines 46-50, tested with `node --check` | ✓ Valid JavaScript; passes syntax check |
| Cross-links check | TASK-STATE-MATRIX.md line 320 → `#fixedrecurring-xor-invariant` (heading at line 180) | ✓ Anchor resolves correctly |
| Cross-links check | TASK-PROPERTIES.md line 34 → `#fixedrecurring-exclusion-xor-invariant` (heading at line 36) | ✓ Anchor resolves correctly |
| Frontmatter check | Both docs: `last_updated: 2026-06-26`, body "Last Updated: 2026-06-26" | ✓ Current per SPEC requirement |
| Git status check | `git status --short juggler-backend/` in worktree | ✓ Only 2 `.md` files modified (M flag); no `.js` code changes; .planning/ is untracked (new) |
| Scope — mode-specific | Chore (docs-only) → Accuracy + Structure mandatory, others INFO | ✓ Applied; no genuine HIGH defects demoted to INFO |
| Output written | Write $REVIEW_DIR/DOCS-REVIEW.md | Done |

---

## Proof Checklist

- [x] **Inputs present** — BASE-DOCUMENTATION-RUBRIC.md loaded; doc list resolved to 2 files (explicit FILES... passed)
- [x] **Mode confirmed** — chore (docs-only); mandatory dimensions = Accuracy (§2) + Structure (§3); others at INFO
- [x] **Doc list non-empty** — 2 files in scope (TASK-PROPERTIES.md, TASK-STATE-MATRIX.md)
- [x] **No --re-review flag** — no prior prairie run for this leg; all findings are new
- [x] **Required sections present** — Both docs are design/architecture-reference type; no required-section definition in rubric for this sub-type; structure is consistent with existing docs in the same directory ✓
- [x] **Accuracy — semantic verification** — Every claim cross-checked against live code: invariant definition (line 99), chokepoint calls (329, 151-152, 283-284, 122-123), flip-handling semantics (UpdateTask.js merge logic), error outcome (400 + `invalid_combination`), orthogonality note (EXCEPT fixed) ✓
- [x] **Accuracy — code examples execute** — JavaScript function extracted, `node --check` passes (§2 HIGH) ✓
- [x] **Structure — heading levels** — Consistent H2/H3/H4 hierarchy; no heading-level jumps ✓
- [x] **Structure — cross-links** — TASK-STATE-MATRIX.md footnote references Fixed–Recurring XOR Invariant section (same doc) and TASK-PROPERTIES.md (cross-doc); both anchors resolve correctly per GFM algorithm ✓
- [x] **Structure — no orphan docs** — Both docs are part of the juggler architecture documentation set; linked from section README; not orphaned ✓
- [x] **Frontmatter freshness** — Both `last_updated: 2026-06-26` and body "Last Updated: 2026-06-26"; status: active; type: design ✓
- [x] **No broken internal links** — Relative anchors (#fixedrecurring-exclusion-xor-invariant, #fixedrecurring-xor-invariant) verified against actual headings ✓
- [x] **No invented claims** — All claims grounded in SPEC and code evidence; no speculative statements about frontend behavior beyond what backend enforces ✓
- [x] **Severity mapping applied** — Rubric HIGH → BLOCK, MED → WARN, LOW → INFO; no mode-scope demotion of genuine HIGH defects ✓
- [x] **Coverage Map complete** — All 8 dimensions evaluated (see below) ✓
- [x] **Findings carry file:line + severity** — 1 INFO finding (legacy terminology, out of scope); no BLOCK/WARN ✓
- [x] **No abby refer-back needed** — Docs meet all rubric criteria; no fixes required ✓

---

## Findings

| # | Severity | File:Line | Dimension | Description | Notes |
|---|----------|-----------|-----------|-------------|-------|
| 1 | INFO | TASK-STATE-MATRIX.md:159–177 | Accuracy / future chore | Section "Regular Task Scheduling Modes" uses legacy `when = "fixed"` / `when = "allday"` terminology; current code/architecture expresses these via `placement_mode` enum. Out of scope for 999.894 (docs-only chore). Noted by abby in her changelog as future improvement for terminology consistency across the doc set. | No action required for this leg; flagged for future consistency pass. |

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| **Completeness** | Covered | Both docs present all required sections for architecture-reference type: invariant definition, code citation, chokepoints, enforcement outcome, flip-handling semantics, cross-references, frontmatter with dates. | Does not apply "completeness" dimension harshly per rubric (design docs not subject to MED "setup instructions" or "deployment guide"); scoped to content present. |
| **Accuracy** | ✅ PASS | Code examples verified (syntax check); invariant definition confirmed against 4 chokepoints (lines 329, 151-152, 283-284, 122-123); flip-handling semantics match code merge logic; orthogonality note excludes `fixed` as required; error code `invalid_combination` verified; no claims beyond code enforcement. Semantic verification rule applied: claims tested for relationship/behavior in code, not token co-occurrence. | Rubric §2 HIGH criteria all pass: code examples compile ✓, config values (n/a for this doc type) ✓, API endpoints (n/a) ✓, error codes match implementation ✓. |
| **Structure** | ✅ PASS | Heading hierarchy consistent (H2/H3 no jumps); navigation cross-links present (TASK-STATE-MATRIX.md → TASK-PROPERTIES.md, footnote → section anchor); no orphan docs (part of juggler architecture set); anchors resolve correctly per GFM algorithm. | Rubric §3 LOW criteria: consistent headings ✓, cross-links ✓, no orphans ✓, searchable (markdown, grep-friendly) ✓, version alignment (both dated 2026-06-26, current) ✓. No table-of-contents required (both <500 lines). |
| **Standards** | ✅ PASS | Markdown lint: code fence balanced and correct (```js ... ```); heading format valid; no trailing spaces. Links: internal anchors valid; no external links (n/a). Terminology: consistent use of `placement_mode`, `recurring`, `isFixedRecurringConflict`, `invalid_combination` per SPEC. Frontmatter: standard YAML with type, service, status, last_updated, tags. | Rubric §4 LOW: code blocks have language identifier (js) ✓, markdown well-formed ✓, no broken links ✓. |
| **Audience Match** | ✅ PASS | Audience = backend architects + frontend devs integrating with scheduler. Technical level appropriate (property tables, code citations, error codes). No unnecessary jargon (terms defined: `placement_mode`, `recurring`, XOR, flip-handling). Progressive disclosure: overview section → detailed invariant → chokepoints → outcomes. Assumptions explicit (backend enforcement, UI behavior not verified by this leg). | Rubric §5 LOW: technical level ✓, clear jargon ✓, progressive structure ✓, explicit assumptions ✓. |
| **Code Documentation** | INFO | Docs are architecture reference, not inline code comments. JSDoc on the helper function itself (`isFixedRecurringConflict`) in source file is present and clear. This dimension scoped as INFO (design docs, not code-facing). | Rubric §6 LOW: inline comments in source file explain WHY (prevents fixed+recurring combination); JSDoc on public function ✓. Out of scope for prose docs review. |
| **Operational Docs** | INFO | Not applicable to scheduler design/architecture docs. No runbooks, incident procedures, monitoring, rollback guidance required for this content. (Operational docs live in separate runbook/SRE docs, not here.) | Rubric §7 MED/HIGH: N/A for architecture reference. Scoped as INFO. |
| **Legal / Compliance** | INFO | Not applicable to internal architecture docs. No privacy policy, ToS, license headers, data-handling policy, open-source attribution, accessibility statement required for this content. | Rubric §8 LOW/MED: N/A for scheduler architecture reference. Scoped as INFO. |

---

## Summary

**abby's 999.894 docs accurately document the fixed-XOR-recurring invariant** established in leg 999.867 (commit 60a9e81). Both docs:
- State the invariant exactly as code enforces it (backend rejection of `placement_mode='fixed' && recurring=true`)
- Cite the single source: `isFixedRecurringConflict()` at `taskValidation.js:98`
- List all four enforcement chokepoints with exact file:line citations
- Note flip-handling semantics (merge-then-test in HTTP/MCP paths)
- Correctly exclude `fixed` from the orthogonality claim (EXCEPT fixed)
- Caveat the Field Visibility Matrix cell (not silently flipped to ❌, explains backend rejection + flags frontend uncertainty)
- Cross-reference each other appropriately
- Maintain current frontmatter (2026-06-26)

No BLOCK or WARN findings. One INFO flag for legacy terminology in a section out of scope for this chore (noted for future consistency pass).

---

## Sign-off

**Prairie — Documentation Verifier**  
Signed: 2026-06-26T00:00:00Z

**Verdict: PASS**  
Docs ready for merge.
