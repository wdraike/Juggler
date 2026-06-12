# Oscar Review — juggler-knexfile-tls-deadbranch — chore — 2026-06-12

## Verdict: PASS

## Summary
Dead `ssl:{rejectUnauthorized:false}` TCP-fallback branch removed from juggler knexfile prod config (closes 999.436). elmo confirmed the branch was unreachable in all live configs; removal does not worsen live prod (prod uses socketPath). 0 BLOCK / 0 WARN / 2 INFO.

## Pipeline
Mode: chore · Lane: --ops (security surface). Dispatched: **elmo** (mandatory security owner). Skipped per --ops lane: telly, ernie-logic, zoe, abby (logged). cookie skipped — no `.tf`/`deploy/`/`terraform/` change.

## Agent Findings
### elmo — DONE
| # | Severity | File:Line | Finding | Fix/Refer |
|---|----------|-----------|---------|-----------|
| INFO-1 | INFO | knexfile.js (TCP branch) | Reverse footgun: future `DB_SSL=true` on TCP path now yields plaintext (vs prior unverified-TLS). Latent, unreachable branch, unset/undocumented var. Optional clarifying comment recommended, not required. Secure ref: auth-backend/knexfile.js:80. | accept (INFO) |
| INFO-2 | INFO | sibling services | Same `rejectUnauthorized:false` in payment-backend & bug-reporter-backend knexfiles → backlog candidate. (Oscar correction: resume-optimizer-backend already `rejectUnauthorized:true` — NOT vulnerable; elmo over-counted it.) | refer → Kermit backlog |

## Fix Loop
None — 0 BLOCK.

## Completeness
_This table is the leg DoD. WBS acceptance-criterion → DoD-check mapping below._
| Check | Result |
|-------|--------|
| All WBS items reviewed (W1) | PASS (elmo) |
| DoD reconciled — every WBS acceptance criterion maps to a check | PASS |
| Tests exist / passing | PASS — `--ops` lane: live-verification substitutes for telly. `node -e require('./knexfile')` loads; production object well-formed; dead-code removal on an unreachable branch cannot alter runtime/test behavior; `grep rejectUnauthorized juggler-backend` → 0 (incl. tests) |
| Traceability complete (forward) | PASS — 999.436 row → Code + verification + verified |
| Backward traceability (no orphan work) | PASS — only knexfile.js changed; traces to 999.436 |
| Gated set == commit set (WBS-scoped) | PASS — `git diff --name-only` = juggler-backend/knexfile.js only ⊆ WBS |
| Security reviewed (security surface) | PASS — SECURITY-REVIEW.md DONE |
| Docs (Phase E) | PASS — code-only chore, no public/user/runbook surface; `leg-meta.docs_deferred.deferred=true` recorded |
| All proof checklists checked | PASS — elmo all [x] |

**WBS acceptance-criterion → DoD mapping:**
1. `grep rejectUnauthorized → 0` → Tests/verification row (verified: 0).
2. `require('./knexfile')` loads, production well-formed, socketPath untouched → Tests row (node load passed).
3. elmo confirms dead-branch + reverse-footgun acceptable → Security reviewed row (elmo DONE, INFO-1).
4. dev+test byte-identical → Gated set / diff (zero changes outside production.connection).

## Traceability Check
Complete — `.planning/kermit/juggler-knexfile-tls-deadbranch/TRACEABILITY.md` row 999.436 verified.

## Proof Checklist
- [x] Required inputs present — --mode chore + scope juggler resolved
- [x] WBS + TRACEABILITY loaded
- [x] Pipeline selected from --mode (chore/--ops, not file-guessed)
- [x] Mode entry-gate checked (chore: scope + behavior-preserved note present)
- [x] Every required muppet dispatched — elmo (mandatory on --ops security surface) ran; others skipped per --ops lane + logged
- [x] Each muppet Status + proof_checklist read — elmo DONE, all boxes [x]
- [x] Spot-verified ≥1 evidence claim — re-read deploy/juggler-backend.yaml:63 (CLOUD_SQL set → dead-branch holds); re-grepped sibling knexfiles (INFO-2 corrected)
- [x] Fix loop ran for fixable BLOCKs — N/A, 0 BLOCK
- [x] Fix loop converged — N/A
- [x] Fix-induced security surface handled — removal adds no surface (reverse footgun ruled INFO)
- [x] Partial-wave failure handled — single reviewer, N/A
- [x] Completeness gate ran — config-load verification (substitutes for telly on --ops); grep guard; diff scope
- [x] Scooter consult — N/A for chore
- [x] UAT — N/A (no user-facing surface)
- [x] DoD named + reconciled — completeness table = DoD; all 4 criteria mapped
- [x] Traceability verified (forward) — row 999.436 Code + verified
- [x] Backward traceability — knexfile.js traces to 999.436; no orphan
- [x] Gated set == commit set — knexfile.js only ⊆ WBS
- [x] Verdict written with Kermit Report block

## Backlog Items (referred → Kermit)
| Finding | File |
|---------|------|
| INFO-2: harden `rejectUnauthorized:false` (same footgun) | payment-backend/knexfile.js:80, bug-reporter-backend/knexfile.js:80 (resume-optimizer already `true` — exclude) |
| INFO-1: optional clarifying comment on TCP-path TLS expectation | juggler-backend/knexfile.js |

## Kermit Report
Verdict: PASS | Mode: chore (--ops) | Completeness gaps: none | WARNs: 0 | Backlog: 2 INFO (optional) | Ready to commit: yes

## Status: PASS
_Signed: Oscar — 2026-06-12T22:40:00Z_
