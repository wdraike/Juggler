# Security Review — scheduler slice (H6 W3 persist-repoint + P1) — refactor — 2026-06-12

## Status: DONE

CO-LEAD data-integrity gate for H6 Wave 3: RunScheduleCommand wiring + the P1 timestamp
migration becoming EFFECTIVE. Verdict: **P1 is genuinely effective (0 live `fn.now()`)**, the
delta-write has **exactly one writer**, the repoint is **transaction- and retry-safe**, and the
now-live `writeChanged` path is **injection-safe** and **delta-skip-faithful** to W2. No
data-integrity regression found in the repoint. (Supersedes the H6 W2 review previously in this file.)

Scope: `src/slices/scheduler/application/` (RunScheduleCommand.js, index.js),
`src/scheduler/runSchedule.js`, plus the bound adapter `src/slices/scheduler/adapters/KnexScheduleRepository.js`
(the actual write sink — in scope by necessity for the persist-repoint verdict).

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode refactor, --depth deep, --files (scheduler/application/ + runSchedule.js) | present |
| Scope detect | find application/ + runSchedule.js + bound adapter | 4 files |
| Scanner pre-filter (Step 2.5) | gitleaks / semgrep / eslint OUTCOME | gitleaks=absent (no staged secrets surface; grep A02 is the only secret coverage), semgrep=absent (grep-only SAST), eslint=ran(rc=0 clean) |
| Scooter (prior knowledge) | --ask P1/ADR-0003 + single-writer + T-TX + retry; scheduler-rules | ADR-0003 CONFIRMED (DESIGN §8, Accepted, prior veto: circular-JSON break); scheduler-rules corroborates `new Date()` over `db.fn.now()`. No relitigation. |
| **P1 live-fn.now check** | grep `\.fn\.now` runSchedule.js (live, comment-stripped) + count clockNow | **0 LIVE fn.now** (3 comment mentions only, lines 106/500/1701); 16 `clockNow()` call sites; golden-master test pins total==0 |
| **_assertDates fail-loud** | read guard + contract tests | guard throws `P1 violation` on non-Date in {updated_at,created_at,completed_at,scheduled_at}; tests assert reject (`scheduleAdapters.contract.test.js:113,130`) — genuinely catches a regression |
| **Single-writer** | trace pendingUpdates flush → persistDelta → writeChanged | inline batched flush DELETED; ONE delta-write impl (the adapter). zoe W2 dual-impl divergence RESOLVED |
| **T-TX / retry safety** | read db.transaction wrapper + MAX_RETRIES path + `_repo(trx)` | repo bound to caller trx per-call; retry re-opens WHOLE txn recursively; no separate connection on delta path; no double-apply |
| **Delta-skip parity** | read placementMatchesDbRow skip (1411) | same W2 skip condition (DB-row-equals-placement, conservative), unchanged by the move |
| A01 scan | object-scope / ownership | userId threaded to every write; `requireUserId` in tasks-write; no new route surface (internal persist) |
| A02 scan | weak hash + hardcoded secrets | none in scope |
| A03 scan | SQLi in now-live writeChanged (trx.raw) + proto-pollution + path | all `trx.raw` CASE exprs `?`-bound; static col literals only; ZERO value interpolation; no proto/path surface |
| A04 scan | rate limit / validation | n/a (internal scheduler, no new endpoint) |
| A05 scan | cors / stack trace / CSRF | n/a (no HTTP surface added) |
| A06 scan | npm audit | 0 critical, 0 high (5 moderate pre-existing, out of scope) |
| A07 scan | jwt / auth | n/a (no auth surface) |
| A08 scan | deserialize | placement cache `JSON.stringify` of own computed object; no user-controlled deserialization |
| A09 scan | secrets/PII in logs | logs are counts/userId/perf-ms only — no secrets/PII |
| A10 scan | SSRF | none |
| Frontend scan | n/a | backend-only scope |
| Threat intel | refactor, narrow internal scope | skipped (no new dep / no external surface — Step 5 narrow-scope rule) |
| Refer-ins | CODE-REVIEW.md / ARCH-REVIEW.md | none present at review time |
| Output written | Write SECURITY-REVIEW.md + elmo-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode refactor, --depth deep, files present)
- [x] Scope confirmed — 4 files in scope
- [x] Mode-appropriate checks run: refactor — confirmed write topology / transaction binding / delta-skip intact after restructuring; no predicate or writer dropped
- [x] All OWASP A01–A10 categories scanned (data-integrity-focused; non-applicable categories marked n/a with reason)
- [x] Frontend/React security scan — n/a (backend-only)
- [x] Authz checked — userId/tenant scope threaded through every write; `requireUserId` in delegated tasks-write
- [x] BOLA/IDOR ownership-trace — every write scoped by `user_id`; persistDelta requires opts.userId (throws if absent); backfill/delete carry user_id predicate
- [x] BFLA / vertical authz — n/a (no role surface in scheduler persist)
- [x] Mass-assignment — n/a (dbUpdate objects are scheduler-computed fields, not req.body)
- [x] Cross-product/tenant authz — single-tenant per-user scope; no cross-product reach
- [x] CSRF — n/a (no HTTP route added)
- [x] JWT algorithm pinning — n/a (no jwt.verify in scope)
- [x] Prototype-pollution — n/a (no user-controlled merge in scope)
- [x] Path-traversal / file-upload — n/a (no fs/upload in scope)
- [x] Secrets scan — no hardcoded credentials
- [x] Secrets/PII-in-logs — logs carry counts/userId/perf only; no secret or whole-body dump
- [x] Supply-chain depth — npm audit run; no dep change in this leg
- [x] Threat model — refactor narrow scope, no new external surface (Step 5 skip justified)
- [x] npm audit run — 0 critical / 0 high
- [x] Refer-ins from ernie/cookie incorporated (0 present)
- [x] Grep matches triaged, not just counted — every fn.now / trx.raw / clockNow match READ and reasoned on the real path
- [x] Findings carry file:line + severity
- [x] Flag-and-refer lines emitted for out-of-column issues (none required)
- [x] Prior knowledge consulted via Scooter — ADR-0003 + scheduler-rules; no relitigation
- [x] Knowledge changes reported to Scooter — none (this leg ENFORCES ADR-0003; changes no standard/decision)
- [x] Rubric Coverage Map emitted
- [x] Output file written with Proof-of-Work table
- [x] Status line set DONE

## Findings
| # | Severity | OWASP | File:Line | Description | Required Fix / Refer |
|---|----------|-------|-----------|-------------|----------------------|
| 1 | INFO | A03 | slices/scheduler/adapters/KnexScheduleRepository.js:127-180 | Now-live `writeChanged` builds batched CASE-update via `trx.raw`. CONFIRMED SAFE: every CASE expression appends only `' WHEN ? THEN ?'` placeholders + a static backtick-column `ELSE` literal; all values (`pu.id`, scheduled_at/dur/date/day/time) flow through bindings arrays. Zero value interpolation. `SELECT NOW(3)` is a static literal. No SQLi. | None — recorded as positive proof for the repoint gate. |
| 2 | INFO | A01 | slices/scheduler/adapters/KnexScheduleRepository.js:97-98 | `writeChanged` throws if `opts.userId` absent; backfill/delete carry `{user_id}` predicate; delegated `tasks-write` calls `requireUserId`. Tenant scope preserved through the repoint. | None — positive proof. |
| 3 | INFO | A09 | src/scheduler/runSchedule.js:1696-1719 | Persist-path logs emit counts + userId + perf-ms only; no secret/PII/whole-row dump. | None. |

**No BLOCK. No WARN.** No security-regression test referral needed (no BLOCK to encode);
the P1 fail-loud guard is already covered by `scheduleAdapters.contract.test.js` and the
`goldenMaster.h6.test.js` zero-fn.now pin (telly/zoe own test-quality verdict).

## CO-LEAD Verdicts (the four asked gates)

**1. P1 EFFECTIVE (ADR-0003) — CONFIRMED.**
Zero LIVE `fn.now()` in `runSchedule.js`. The 3 surviving mentions (lines 106/500/1701) are all
inside `//` comments; the comment-stripped grep returns ZERO executable `db.fn.now()`/`trx.fn.now()`,
and the golden-master test `goldenMaster.h6.test.js:954` pins `total === 0` (and `not.toMatch
updated_at: (db|trx).fn.now()`) — a re-introduced inline fn.now() fails CI. Every former fn.now()
write now stamps via `new Date()`: 16 `_runScheduleCommand.clockNow()` (→ ClockPort → `new Date()`)
call sites in runSchedule.js, plus the repository's own `this.clock.now()` on the batched CASE
`updated_at` and the rolling-anchor backfill. NO write path uses fn.now.
The `_assertDates` guard is GENUINE fail-loud, not decorative: it throws `P1 violation` if a non-Date
reaches `writeChanged` for any of {updated_at, created_at, completed_at, scheduled_at}, runs on EVERY
`pu.dbUpdate` before any SQL is built (`pendingUpdates.forEach(self._assertDates)`, line 105), and is
asserted by two contract tests (`scheduleAdapters.contract.test.js:113` non-Date updated_at rejects;
`:130` non-Date scheduled_at rejects on the real KnexScheduleRepository before db is touched). The
live `scheduled_at` value is a JS Date from `localToUtc` (runSchedule.js:1379) — if that ever
regressed to a string the guard catches it. A silent fn.now() regression cannot slip through.

**2. SINGLE DELTA-WRITE IMPL — CONFIRMED (zoe W2 dual-impl divergence RESOLVED).**
The inline batched flush is DELETED: the entire `pendingUpdates` flush (batched scheduled_at/dur
CASE update chunked at 200 + per-row otherUpdates loop) is GONE from runSchedule.js and the single
live persist is `_runScheduleCommand.persistDelta(trx, userId, pendingUpdates, {instanceOnly:true})`
→ `KnexScheduleRepository.writeChanged` (runSchedule.js:1708). There is now exactly ONE delta-writer
(the adapter); no dormant W2 path runs in parallel, no inline remnant remains that could double-write
or diverge. Note (not a finding): the leg correctly scopes "single delta-writer" to the
*pendingUpdates delta flush only* — the separate, pre-existing drift-fix UPDATE (line 911), the
Phase-1 batch INSERT (line 1026), and the safety-net `unscheduled=1` write (line 886) are distinct
reconcile/insert phases W3 never claimed to collapse; they are unchanged and not a divergent copy of
the delta-write.

**3. TRANSACTION / RETRY DATA-SAFETY — CONFIRMED.**
T-TX holds: `RunScheduleCommand._repo(trx)` builds a fresh `KnexScheduleRepository` bound to the
caller's `trx` handle for EVERY primitive call (persistDelta/deleteTasksWhere/backfill/dbNow), so all
delta writes participate in the caller's `db.transaction(...)` and commit/roll back together. The
command never opens its own transaction (verified: no `db.transaction`/autocommit inside
RunScheduleCommand or the adapter's write path). The deadlock-retry (`MAX_RETRIES=3` on
ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT, runSchedule.js:1915) recursively re-invokes
`runScheduleAndPersist`, which opens a BRAND-NEW `db.transaction` and re-runs the whole
read+compute+write body — on retry, `_repo(trx)` rebinds to the new trx, so the repointed persist
participates correctly with no orphaned writes and no double-apply (the prior attempt's writes rolled
back atomically with its failed transaction). The one intentional non-trx write (line 886,
`db('task_instances')…update({unscheduled:1})`) is a PRE-EXISTING, documented safety-net (must
survive a rollback) — unchanged by W3, idempotent on retry (constant `unscheduled:1`), and its
`fn.now()` was correctly converted to `clockNow()`. No autocommit leak, no partial-commit on the
delta path.

**4. SYNC-SAFETY / DELTA-SKIP — CONFIRMED (unchanged from W2).**
The changed-vs-unchanged skip is the same W2 condition: `placementMatchesDbRow(dbUpdate,
rawRowById[taskId])` (runSchedule.js:1411) skips a write only when the DB row ALREADY EQUALS the
computed placement, falls through to a real write on any differing-or-uncertain field (conservative —
never skips a genuine change). It is computed by the CALLER and only the resulting `pendingUpdates`
(already filtered to changed rows) is handed to `writeChanged`; the adapter does not re-derive or
weaken the skip. The skip was relocated-not-rewritten; delta-write semantics are intact.

**5. INJECTION — SAFE (now-live writeChanged path).** See Finding #1. All `trx.raw` CASE expressions
are `?`-bound; no user/value string ever enters the SQL text.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Input Validation | covered | dbUpdate fields are scheduler-computed (not req.body); `_assertDates` validates date-column types fail-loud | Type-integrity guard on the write boundary |
| Authentication | n/a | No auth surface in scheduler persist | — |
| Authorization | covered | every write scoped by user_id; persistDelta throws without opts.userId; tasks-write `requireUserId` | Tenant scope preserved through repoint |
| Data Protection | covered | P1: timestamps via `new Date()` (serializable), never Knex now-builder (circular-JSON veto); transactional atomicity preserved | The core of this leg |
| Dependencies | covered | npm audit 0 critical/high; no dep change in leg | 5 moderate pre-existing, out of scope |
| Exposure Surface | covered | no new HTTP route/endpoint; internal persist refactor | No new attack surface |
| Session Security | n/a | no session/cookie surface | — |
| Audit Trail | covered | persist logs counts/userId/perf; no secret/PII leakage | A09 clean |
| Infrastructure Security | n/a | no infra/config change in scope | — |
| Secrets Management | covered | no hardcoded secrets; gitleaks absent but grep A02 clean on scope | gitleaks=absent recorded as reduced coverage |

## Sign-off
Signed: Elmo — 2026-06-12T15:50:52Z
