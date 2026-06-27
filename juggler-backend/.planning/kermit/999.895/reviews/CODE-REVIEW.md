# Ernie Review — src/mcp/tools/tasks.js (terminal-schedule guard, 999.895) — bugfix — 2026-06-26

## Status: DONE

## Scooter Consult
- **Question asked:** When a rolling-recurring instance with `scheduled_at=NULL` is moved to a terminal status (done/skip/cancel), is the terminal-requires-schedule guard's rolling exemption SUPPOSED to also backfill `scheduled_at` (e.g. NOW()), or is leaving `scheduled_at` NULL the intended behavior? The DB CHECK constraint `chk_task_instances_terminal_scheduled` requires `scheduled_at NOT NULL` for terminal rows. Both the HTTP `UpdateTaskStatus` path and the new MCP guard allow the rolling exemption WITHOUT setting `scheduled_at`.
- **Cited answer (Confidence: documented):** The rolling exemption allowing terminal-without-schedule is a **recorded design decision**, not an oversight.
  - `brain:fact#79254` — "Rolling instances can be marked done, skip, or cancel without a `scheduled_at`, exempting them from `TERMINAL_REQUIRES_SCHEDULE`." (the exemption is intended)
  - `brain:fact#59670` (Juggler R33) — Rolling recurrence uses a mutable `rollingAnchor` on the master; anchor advances on done/skip, does NOT change on cancel. (rolling instances are anchor-driven, not `scheduled_at`-driven)
  - `brain:fact#67919` (TS-102) — skip snaps `scheduled_at` to now applies to the **already-scheduled** (`isFutureScheduled`) path, not the unscheduled rolling path.
- **Binding constraint in play:** The MCP guard's job in this leg is **parity with the HTTP canonical** (`UpdateTaskStatus.js:147-160`). The recorded decision sanctions allowing the rolling exemption WITHOUT setting `scheduled_at`; the HTTP path does exactly that and the new MCP helper mirrors it faithfully. No veto is relitigated.
- **Bearing on the zoe INFO item:** The latent tension between the recorded exemption (#79254) and the DB CHECK constraint exists **identically on both the HTTP and MCP paths** and is pre-existing — see Finding I-1.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files=src/mcp/tools/tasks.js (positional) | present |
| Scope detect | `git diff -- src/mcp/tools/tasks.js` | 1 file, 2 hunks (+helper +2 call sites) |
| Mode gate | bugfix → reproduction = HTTP guard exists, MCP path lacked parity | satisfied (parity target known) |
| Complexity scan | `wc -l` = 787; helper = 9 LOC, nesting ≤2 | within bounds |
| Parity scan | diff vs `UpdateTaskStatus.js:49,147-160` + `loadMaster`→`getMasterById` | faithful mirror (see findings) |
| Error handling scan | helper `await`ed at both call sites; rejections propagate to MCP handler (consistent w/ surrounding awaits) | no new floating promise / swallow |
| Input validation scan | helper no-ops on non-terminal/undefined status (`indexOf===-1`); both sites guard `if(!existing)` before call | safe |
| Unapproved-fallback scan | `existing.master_id \|\| existing.source_id` = canonical id-selection (mirrors HTTP L149), guarded by `if(masterId)` — not a data-integrity fallback | no BLOCK |
| Null/undefined scan | `existing` non-null (checked), `master` undefined→`master && isRollingMaster` guard, `db`/`isRollingMaster` module-scope (L11/L18) | safe |
| Resource scan | no sync I/O, no new handles/timers | clean |
| Concurrency scan | no module-level mutable state added; one extra `task_masters` read only on terminal+unscheduled path | acceptable |
| DB-clock / date scan | helper does no date math; does not write timestamps | n/a |
| React scan | no .jsx/.tsx in scope | skipped |
| Output written | CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, file scope = src/mcp/tools/tasks.js
- [x] Scope confirmed — 1 file, diff read in full
- [x] Mode + gate checked — bugfix; reproduction = HTTP guard parity gap (MCP path had no terminal-schedule guard)
- [x] Complexity scan — 787 LOC file (pre-existing; helper adds 9 LOC, ≤2 nesting)
- [x] Error handling scan — helper awaited at both sites; rejection propagates like adjacent awaits; no swallow/empty-catch
- [x] Floating-promise / forEach(async) scan — none; `terminalScheduleBlock` is `await`ed at L350 and L422
- [x] Error-cause / silent-default scan — helper returns `null` (allow) only on genuine non-block branches; no success-shaped default over an error
- [x] Input validation scan — helper short-circuits on non-terminal/undefined `status`; both call sites guard `!existing`
- [x] Unapproved-fallback scan — `master_id || source_id` is canonical id-selection (mirrors HTTP L149), not a maybe-null data fallback; guarded by `if(masterId)`
- [x] Numeric precision/boundary scan — no numeric/money/index math in the change
- [x] ReDoS scan — no regex in the change
- [x] Date/TZ & DB-clock scan — helper writes no timestamp; no date math
- [x] Resource scan — no sync I/O, handles, or timers added
- [x] DB-transaction/atomicity scan — helper is read-only (single `task_masters` lookup); writes unchanged
- [x] Concurrency scan — no shared mutable state; extra read is per-request, terminal-path-only
- [x] Idempotency-under-retry scan — n/a (read-only guard; not a queue/webhook consumer)
- [x] Grep matches triaged — `||` match at L78 READ and reasoned (id-selection, not fallback); awaits at L350/L422 READ
- [x] Type safety scan — no casts/@ts-ignore; JS; null guards present
- [x] React logic scan — skipped (no frontend files in scope)
- [x] Observability scan — no bare console.log added
- [x] Dead code scan — no TODO/FIXME/commented blocks added
- [x] Flag-and-refer emitted — security/test/arch none warranted; zoe INFO item assessed (I-1)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed (telly owns)
- [x] No security findings reviewed in depth
- [x] Prior knowledge consulted via Scooter — recorded decision #79254 confirms exemption intent; no relitigation
- [x] Knowledge changes reported — none (this leg changes no requirement/standard/decision); no INBOX notice needed
- [x] Rubric Coverage Map emitted — all 9 dimensions below
- [x] Output file written with Proof-of-Work, Checklist, Findings, Sign-off
- [x] Status line set: DONE (no unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| I-1 | INFO | src/mcp/tools/tasks.js:76-83 (helper) | **zoe-referred item — OUT OF SCOPE for this parity leg.** An unscheduled rolling instance (`scheduled_at=NULL`) marked terminal returns `null` (allow), then the terminal write violates DB CHECK `chk_task_instances_terminal_scheduled` (requires `scheduled_at NOT NULL`) → raw throw. This is **pre-existing and identical on the HTTP path**: `UpdateTaskStatus.js` only sets `scheduled_at` on a custom `completedAt` (L190) or `isFutureScheduled` cancel/skip (L199-200) — for an unscheduled rolling instance neither fires, so HTTP would hit the same CHECK. The new MCP helper **faithfully mirrors** that behavior (= the leg's goal). Recorded decision `brain:fact#79254` sanctions the exemption allowing terminal-without-schedule. Whether the exemption should backfill `scheduled_at=NOW()` is cross-path production logic, not a parity defect. | No fix in this leg. Recommend a **separate backlog item** to reconcile the `#79254` exemption with the DB CHECK constraint on BOTH paths (HTTP + MCP). |
| I-2 | INFO | src/mcp/tools/tasks.js:347-349 | `_willBeScheduled` counts `existing.scheduled_at`, `fields.scheduledAt`, `fields.date` but **not** `fields.time`. This is correct parity (HTTP guard L155 considers only `existing.scheduled_at` + `body.scheduledAt`) and correct logic: a time-only update with no date and no existing schedule cannot produce a complete `scheduled_at`, so the conservative block is the intended outcome. A dated/scheduled existing row is already covered by `existing.scheduled_at`. | No action. Behavior is correct and is a superset of HTTP (adds `fields.date`). |
| I-3 | INFO | src/mcp/tools/tasks.js:415-423 | `set_task_status` accepts `status: z.string()` (any string) and lacks the HTTP path's `VALID_STATUSES` check and `'missed'` system-only 403 (`UpdateTaskStatus.js:104-109`). This is **pre-existing** and a separate guard from the terminal-schedule guard this leg adds — `TERMINAL_REQUIRES_SCHEDULE` correctly excludes `'missed'` exactly as HTTP does. Not introduced by this change; noted for completeness. | Out of scope. Optionally backlog a separate MCP status-validation parity item. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Short-circuit order (non-terminal→allow, scheduled→allow, rolling→allow, else block) verified line-by-line against HTTP L150-160; `master_id\|\|source_id` + `loadMaster`/`getMasterById`→`db('task_masters').where({id,user_id}).first()` are identical queries; `isRollingMaster` is the same `rolling-anchor.js` function on both paths | faithful parity, no logic defect |
| Readability | covered | 9-LOC helper with a docblock citing the HTTP canonical; intent clear | — |
| Maintainability | partial | Logic is duplicated (helper) rather than shared with HTTP `UpdateTaskStatus`; acceptable given the HTTP path is class-injected (`this.loadMaster`) vs MCP module-level `db` | REFER→cookie if a shared module is desired (not a BLOCK) |
| Error Handling | covered | helper awaited; rejection propagates consistent with adjacent awaits; no swallow/empty-catch/silent default | — |
| Coupling | covered | helper depends only on module-level `db` + imported `isRollingMaster`; no new cross-module coupling | — |
| Type Safety | covered | JS; null guards present (`if(masterId)`, `master && isRollingMaster(master)`); `existing` non-null at both call sites | — |
| API Design | covered | both MCP tools return the existing `{content,isError}` error shape on block; message text matches HTTP wording | — |
| Resource Management | covered | no handles/timers/sync I/O; one extra read only on terminal+unscheduled path | — |
| Concurrency Safety | covered | no module-level mutable state added; read-only guard | — |

## Sign-off
Signed: Ernie — 2026-06-26T00:00:00Z
