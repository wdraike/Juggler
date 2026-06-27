# Ernie Review — 999.892-tz-notnull (juggler-backend) — bugfix — 2026-06-26

## Status: DONE

## Scooter Consult
**Question asked:** "making users.timezone NOT NULL + removing redundant tz fallbacks; any prior decision/veto?" (--domain scheduler)

**Cited answer:** No veto. The original schema already declares the column with the same default —
`src/db/migrations/20260301000000_initial_schema.js:13`: `table.string('timezone', 100).defaultTo('America/New_York')` — so NOT NULL DEFAULT 'America/New_York' is a tightening of the existing contract, not a new policy. Brain fact #77683 supports `NOT NULL DEFAULT 'America/New_York'` for `users.timezone`. The scheduler-rules domain surfaced no decision/veto contradicting the NOT NULL constraint or the fallback-removal at direct-read sites. count's intake likewise found no veto.

**Binding constraint confirmed (NOT relitigated):** `KnexConfigRepository.getUserTimezone` has a *separate, intentional* contract — it returns `null` when unset (documented "A1: null when unset", `src/slices/user-config/adapters/KnexConfigRepository.js:143,152`). That repo and its downstream `|| _DEFAULT_TIMEZONE` guards (taskMappers RC2/R50.8, schedulerSession, runSchedule) must NOT be touched by this leg, and were correctly left in place. **Confidence: documented.**

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, 5 files positional | present |
| Scope detect | git diff + cat new migration | 5 files (4 call-site edits + 1 new migration) |
| Migration ordering | read up()/down() | backfill BEFORE NOT NULL ALTER — correct |
| Column precondition | grep initial_schema | col exists `string('timezone',100).defaultTo('America/New_York')` @ 20260301000000:13 |
| Error handling scan | read resolveTimezone try/catch | catch + final `return DEFAULT_TIMEZONE` preserved |
| Unapproved-fallback scan | git diff `||`/`??` | redundant `&& row.timezone` / `|| default` removed; no NEW fallback added |
| Guard-preservation scan | read 4 call sites | row-absence guard (`if(row)` / `user ?`) preserved at all 4 |
| Out-of-scope check | git diff --name-only \| grep ConfigRepo | NOT in diff (correct) |
| Downstream fallbacks | grep `timezone \|\|` src | KnexConfigRepository null-contract + downstream guards correctly untouched |
| Scooter consult | Skill(scooter) --domain scheduler | no veto; Brain #77683 supports NOT NULL DEFAULT |
| React logic scan | n/a — no .jsx/.tsx in scope | skipped |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 5 files in scope
- [x] Scope confirmed — 5 files (4 edits + new migration), printed above
- [x] Mode noted + gate — bugfix; failing condition = NULL timezone could bypass guard; fix tightens at DB
- [x] Complexity scan — migration 35 lines, call-site edits 1 line each; no threshold breach
- [x] Error handling scan — resolveTimezone retains try/catch + final default; MCP sites unchanged control flow
- [x] Floating-promise / forEach(async) scan — all reads `await`ed; none floating
- [x] Error-cause-preservation scan — catch in resolveTimezone is a deliberate fall-through to a documented default (DEFAULT_TIMEZONE), not a silent success-as-failure swallow; acceptable (pre-existing, unchanged)
- [x] Input validation scan — userId scoped query; no new entry point
- [x] Unapproved-fallback scan — diff REMOVES redundant fallbacks; no new `||`/`??` introduced; row-absence default at MCP sites is an approved/documented guard tied to migration comment
- [x] Numeric precision/boundary scan — n/a (string column)
- [x] ReDoS scan — n/a (no regex)
- [x] Date/TZ & DB-clock scan — timezone is an IANA string, not computed; no hand-rolled date math
- [x] Resource management scan — single awaited query per fn; no leaks
- [x] DB-transaction/atomicity scan — migration: backfill UPDATE then ALTER; ALTER is implicitly committed (MySQL DDL auto-commit) — single logical step, ordering correct; no multi-write atomicity gap
- [x] Concurrency scan — no shared mutable state
- [x] Idempotency-under-retry scan — migration ALTER MODIFY is re-runnable to same state; up→down→up safe
- [x] Grep matches triaged — every `||`/timezone match READ; KnexConfigRepository + downstream guards confirmed correctly OUT of scope, not over-removed
- [x] Type safety scan — no casts; `row.timezone` access guarded by `if(row)` / `user ?`
- [x] React logic scan — skipped (no frontend files)
- [x] Observability scan — no new console.log
- [x] Dead code scan — none introduced
- [x] Flag-and-refer emitted — telly (migration test verification)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed (referred to telly)
- [x] No security findings reviewed in depth
- [x] Requirements doc standards — n/a for bugfix call-site edits
- [x] Prior knowledge consulted via Scooter — see Scooter Consult block (no relitigation of KnexConfigRepository null-contract)
- [x] Knowledge changes reported — none (leg implements an already-recorded decision; no new INBOX notice needed)
- [x] Rubric Coverage Map emitted — below
- [x] Output file written

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | 20260626000000_users_timezone_not_null.js:26 | up() correctly backfills NULLs (line 22) BEFORE the NOT NULL ALTER (line 26) — ordering is right; ALTER preserves VARCHAR(100)/DEFAULT/COLLATE. No defect. | none — confirmation |
| 2 | INFO | 20260626000000_users_timezone_not_null.js:26 | The explicit `COLLATE utf8mb4_unicode_ci` changes the column collation from the knex/MySQL-8 default (`utf8mb4_0900_ai_ci`) set by the original `string()` migration to the project-mandated `utf8mb4_unicode_ci`. This is an intentional, beneficial alignment with the CLAUDE.md collation rule — not a regression. down() keeps the same collation, so up→down→up is collation-stable. | none — note the intentional collation normalization in the leg summary |
| 3 | INFO | deriveSchedulePlacements.js:48 | resolveTimezone: `if (row) return row.timezone;` inside try, with `catch{}` fall-through and final `return DEFAULT_TIMEZONE;` — both the DB-error guard and the row-absence default are PRESERVED; only the redundant `&& row.timezone` (now guaranteed non-null by the migration) was removed. Correct. | none — confirmation |
| 4 | INFO | data.js:15, schedule.js:14, tasks.js:91 | MCP getUserTimezone: `user ? user.timezone : 'America/New_York'` — row-absence guard retained, no `|| default` re-added, comment cites migration 20260626000000. These three have no surrounding try/catch (a thrown DB error propagates) but that is PRE-EXISTING and unchanged by this leg — not a regression. Correct. | none — confirmation |
| 5 | INFO | KnexConfigRepository.js:152 | OUT OF SCOPE and correctly NOT in the diff. It intentionally returns `null` when unset (contract A1), and downstream `\|\| _DEFAULT_TIMEZONE` guards (taskMappers.js:359/387/396, schedulerSession.js:56, runSchedule.js:501) depend on that null contract — correctly left untouched. Scope discipline verified. | none — confirmation |
| 6 | INFO | tests/migrations/20260626000000_users_timezone_not_null.test.js | A migration test exists; verifying it asserts backfill-before-ALTER and up→down→up reversibility is coverage ownership. | REFER→telly |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | backfill→ALTER ordering correct; guards preserved at all 4 sites; redundant fallback removal is semantically safe given NOT NULL | no defect |
| Readability | covered | each edit carries a comment citing the migration | clear |
| Maintainability | covered | migration uses raw MODIFY with documented rationale (preserve collation) | sound |
| Error Handling | covered | resolveTimezone try/catch + final default intact; MCP control flow unchanged | no swallow introduced |
| Coupling | covered | KnexConfigRepository null-contract + downstream guards correctly NOT coupled to this change | scope-clean |
| Type Safety | covered | `row.timezone`/`user.timezone` access guarded by row-presence checks | no unguarded access |
| API Design | n/a | no API surface changed | — |
| Resource Management | covered | single awaited query per fn; migration single DDL | no leaks |
| Concurrency Safety | covered | ALTER re-runnable to same state; no shared mutable state | idempotent up/down |

## Sign-off
No BLOCK, no WARN. Migration is correct (backfill precedes the NOT NULL ALTER; raw `ALTER … MODIFY timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci` is well-formed and preserves type/default/collation; down() loosens to NULL without dropping the column or losing data; up→down→up is stable). All four call-site edits preserve the row-absence/DB-error guards and introduce no new fallback — they remove only the now-redundant column-null check. `KnexConfigRepository.getUserTimezone` is correctly out of the diff. Scooter confirms no veto and Brain fact #77683 backs the constraint.

Signed: Ernie — 2026-06-26T22:39:11Z
