# Scooter INBOX

Change notices are appended here by agents.
Each notice follows the schema below. Scooter reconciles these into the KG.

## Schema

```
## <ISO timestamp> — <leg_id> — <agent>
- type: requirement | nfr | use-case | architecture | standard | approach | testing | product-decision | process-decision | gap | challenge
- artifact: <file:section, or "decision (no file)">
- change: <one line — what is now true>
- rationale: <why — the WHY, not the diff>
- supersedes: <prior triple id | none>
- challenge-id: <stable id — present ONLY on type: challenge>
- resolves: <challenge-id this notice closes | none>
```

## Notices

## 2026-06-26T00:00:00Z — 999.892-tz-notnull — abby
- type: standard
- artifact: juggler-backend/docs/TIMEZONE-RULES.md:TZ-SCHEMA-1
- change: users.timezone is now NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci (migration 20260626000000_users_timezone_not_null.js); all pre-existing NULLs were backfilled; column-null fallbacks removed at reader call sites (deriveSchedulePlacements + 3 MCP getUserTimezone helpers); remaining America/New_York fallbacks (TZ-DISPLAY-3, TZ-ERR-2) now cover only: absent user row, missing/invalid x-timezone header, or invalid IANA value — not null column. A1 getUserTimezone null contract (application-layer "unset" signal) is unchanged.
- rationale: Single-source UTC contract: schema enforces the America/New_York default so no reader code can diverge from it by omitting a null check. Application-layer null (A1 contract) is a separate signal from DB-null and is preserved.
- supersedes: none
- challenge-id: none
- resolves: none

## 2026-06-12T00:00:00Z — juggler-h5-fixes W3 — ernie
- type: process-decision
- artifact: KnexAIUsageRepository.commitQuota / ai.controller.handleCommand
- change: The atomic commitQuota deny path (re-count under FOR UPDATE finds count>=limit → skip INSERT → resolve void) is fail-open by design: the race-loser's AI result is still returned (200) un-counted. This is consistent with — and extends — the W1b WARN-2 decision (commit failure non-fatal to the response; under-count-by-one acceptable). The 50/day cap is enforced as "at most one concurrent caller commits the boundary slot" (row-count invariant, B11 criterion a), NOT as "every caller is told whether it won." commitQuota intentionally returns void with no allowed/denied signal.
- rationale: B11 acceptance (a) requires "exactly one passes" at the ROW level (finalCount<=50), which holds. Telling the loser it lost would require either denying a successful AI result (re-introduces the WARN-2 "lost result" regression) or a 2nd round-trip — neither is warranted for a sub-second boundary race that under-counts by at most one slot. Matches the W1b ledger's accepted "under-count by one is acceptable; losing the result is not."
- supersedes: none
- challenge-id: none
- resolves: none

## 2026-06-12T12:05:00Z — juggler-h5-fixes — kermit
- type: product-decision
- artifact: docs/architecture/JUGGLER-HEX-ROADMAP.md:Phase H5 (post-ship hardening)
- change: H5 AI-enrichment hardened (leg juggler-h5-fixes, commit 29401dc) — 10 code-review findings closed. The call timeout now lives in trackedGeminiCall (env-tunable AI_CALL_TIMEOUT_MS, 45s default, covers ALL provider callers) not the adapter's 8s. Quota is atomic: commitQuota wraps SELECT COUNT FOR UPDATE in a txn (closes TOCTOU, multi-instance-safe via InnoDB next-key locks); check/commit split means a timed-out call never burns a slot. Timeout-abort no longer writes phantom billing telemetry. AI input-trust boundary cleared by elmo (no escalation: AI never writes DB, ops re-apply via JWT user-scoped endpoints). RedisAIUsageQueue stays de-scoped — atomicity achieved on the existing ai_command_log path.
- rationale: closes the production-impact findings from the H5 /code-review (slow calls 500'd + burned quota; phantom billing rows; quota cap leaked under concurrency).
- supersedes: none

## 2026-06-12T12:05:01Z — juggler-h5-fixes — kermit
- type: process-lesson
- artifact: decision (no file)
- change: A false-BLOCK was raised because a test ran against STALE code. telly reported the W3 race test FAILING (finalCount=51) while zoe + Oscar's direct re-run showed PASSING (50). Root cause: `make test-juggler` syncs a worktree to the COMMITTED HEAD, which lacks the uncommitted leg fix — so a pre-commit gate run via the worktree tests OLD code. Compounded by a DB-dependent test that SKIPS-and-passes (vacuous green ✓) when DB creds are absent. Lesson: pre-commit Oscar gates MUST test the working tree (direct DB_PORT=3407 jest with full creds), never the committed-HEAD worktree; and DB-required tests must HARD-FAIL (not skip-pass) when their DB is unreachable. Oscar resolved the muppet contradiction by re-running the test empirically himself — the right move when two muppets disagree on an empirical result.
- rationale: a stale-worktree run + a skip-passes-green guard nearly shipped a false verdict (either a false-BLOCK holding a correct fix, or—worse in another case—a false-PASS on broken code).
- supersedes: none

## 2026-06-12T12:42:00Z — juggler-hex-h6-scheduler — kermit
- type: challenge
- artifact: docs/architecture/JUGGLER-HEX-DESIGN.md §6 (invariant S5) vs juggler-backend/src/scheduler/runSchedule.js:1264-1267
- change: DESIGN §6 + ROADMAP §6 assert invariant S5 "delta-writes only (writeChanged) — only changed tasks written". Live code contradicts: runSchedule.js:1264 "NEW DESIGN: write scheduled_at and dur for EVERY placed task, every run. No minimal-diff optimization … eliminates stale-DB states the sync used to compensate for." Current scheduler does NOT delta-write.
- rationale: Caught by zoe+ernie during H6 W0 characterization (BLOCK-3). A behavior-identical refactor (H6) cannot re-introduce delta-write without changing observable behavior (DB write count + updated_at on unchanged rows), which would break the bit-for-bit golden-master by design. The "NEW DESIGN" comment indicates delta-write was deliberately reversed AFTER the DESIGN §6 invariant was written → S5 may be stale.
- supersedes: none (pending arbitration + human scope decision)
- challenge-id: h6-s5-deltawrite-contradiction
- resolves: none

## 2026-06-12T13:05:00Z — juggler-hex-h6-scheduler — kermit
- type: product-decision
- artifact: docs/architecture/JUGGLER-HEX-DESIGN.md §6 (invariant S5)
- change: S5 "delta-writes only (writeChanged)" is AFFIRMED as the H6 target. The live runSchedule.js:1264 write-all ("NEW DESIGN, no minimal-diff") is the deviation H6 corrects (delta-write lands in W2 KnexScheduleRepository). User ruled 2026-06-12: change to write-changed, not write-all.
- rationale: User scope decision on the contradiction zoe/ernie surfaced. H6 OUTPUT stays behavior-identical (bit-for-bit golden-master); the write-PATTERN is a deliberate behavioral change (S5/C-IDEM are RED-now/GREEN-after it.failing tests). BINDING RISK carried to W2/W3: delta-write must not reopen the stale-DB calendar-sync bug the write-all "NEW DESIGN" eliminated.
- supersedes: runSchedule.js:1264 write-all behavior (to be corrected in W2)
- challenge-id: none
- resolves: h6-s5-deltawrite-contradiction

## 2026-06-12T00:00:00Z — juggler-hex-h6-scheduler-W2 — ernie
- type: gap
- artifact: juggler-backend/src/slices/scheduler/adapters/KnexScheduleRepository.js:171-183
- change: KnexScheduleRepository.writeChanged adds a slack_mins CASE fold to the batched placement path that the legacy runScheduleAndPersist (runSchedule.js:1700-1773) does NOT emit — legacy silently drops slack_mins on scheduled_at-bearing placement rows. This is an undeclared behavioral change beyond the two approved W2 deviations (P1 db.fn.now()→new Date() and S5 delta-write).
- rationale: WBS scopes W2 to exactly P1 + S5; OUTPUT golden-master (slack as computed output) would not catch a slack_mins DB-write divergence. Adapter is dormant in W2 (runSchedule.js still flushes inline) so no live impact yet, but W3 wiring activates it. placementMatchesDbRow:379 already compares slack_mins, so the skip logic assumes slack is persisted — inconsistent with the legacy drop. Needs explicit approval (intended latent-bug fix) or removal (stay within P1+S5 scope).
- supersedes: none
- resolves: none

## 2026-06-12T15:00:00Z — juggler-hex-h6-scheduler — kermit
- type: process-decision
- artifact: characterization-test gate discipline (BASE-ADVERSARIAL / muppet practice)
- change: A green characterization suite is NOT trustworthy until each preserved-behavior invariant has a proven mutation→RED. H6 W0 shipped 43/43 green but zoe broke 4 invariants (same-day-lock, weather-fail-open, delta-write, score) while the suite stayed green — fixtures never exercised the mechanism. The S8 extraction gate was only declared cleared after each zoe mutation (isDayLocked/weatherOk/slack-sort) forced ≥1 RED.
- rationale: green-but-hollow characterization is the worst failure mode for a behavior-identical refactor — it greenlights a corrupting extraction. Mutation-proof every invariant before trusting the gate.
- supersedes: none
- resolves: none

## 2026-06-12T15:00:00Z — juggler-hex-h6-scheduler — kermit
- type: process-decision
- artifact: muppet revert discipline (zoe/telly mutation testing)
- change: When a muppet mutates SOURCE to prove a test bites, it MUST back up via /tmp and restore from the backup — NEVER `git checkout -- <file>`. In H6 W3 a zoe `git checkout` discarded the entire UNCOMMITTED W3 repoint (HEAD was W2); it was reconstructed byte-for-byte from the diff, but the work was nearly lost. Uncommitted leg work is invisible to `git checkout` safety.
- rationale: subagents routinely mutate-and-revert during adversarial audits; on a multi-wave leg with uncommitted work, git checkout is destructive. /tmp-backup-and-restore is the only safe revert.
- supersedes: none
- resolves: none

## 2026-06-12T15:00:00Z — juggler-hex-h6-scheduler — kermit
- type: process-decision
- artifact: hex slice-extraction dual-writer trap (relates to H4 cache-coherence trap)
- change: When extraction builds a new adapter (KnexScheduleRepository.writeChanged) while the legacy inline path stays live, there are temporarily TWO impls — the gate must (a) confirm which one is LIVE and target mutations at it, and (b) the wave that wires the adapter must DELETE the inline path (collapse to one). H6 W2 built the adapter dormant; zoe flagged the dual-impl divergence risk; W3 collapsed to the adapter and re-conf�irmed S5/C-IDEM mutate against the live (adapter) path. Mirrors the H4 hex-extraction-cache-coherence-trap (slice extraction silently shipping dead code).
- rationale: a dormant duplicate impl can diverge from the live one; tests passing against the dead path give false confidence.
- supersedes: none
- resolves: none

## 2026-06-12T00:00:00Z — juggler-chore-requirements-register — abby
- type: requirement
- artifact: juggler/docs/REQUIREMENTS.md (all sections)
- change: First living per-service requirements register authored for juggler. Assigns stable R1–R17 IDs to all KG `has_requirement` facts. R1–R5 task/project CRUD, R6 time tracking (partial), R7 calendar sync, R8 calendar visualization, R9 drag-and-drop scheduling (partial), R10 dependency management, R11 scheduler placement algorithm, R12–R14 reports (planned), R15 AI enrichment, R16 JWT auth, R17 MCP server (partial). Status reflects code reality: 10 implemented, 4 partial, 3 planned.
- rationale: BASE-REQUIREMENTS-STANDARD §9 mandates a living cumulative SRS per service. This is the first instantiation for juggler; prior to this leg the KG held facts but no browsable requirements document existed.
- supersedes: none
- resolves: none

---
type: process-lesson
leg: juggler-knexfile-tls-deadbranch
date: 2026-06-12T22:49:05Z
lesson: Kermit leg lock guards session.json but NOT git HEAD. A concurrent non-Kermit session (abby docs-sync, commit 479b7e9) ran `git checkout main` mid-leg, so this leg's commit landed on main instead of leg/<id>. Recovered (commit was isolated + correct).
agent_edit: ~/.claude/skills/kermit/SKILL.md Step 7.1 — added a HEAD-drift guard that re-verifies `HEAD == session.json.branch` and re-checks-out the leg branch (or BLOCKs) before `git add`/commit. Structural lint PASS.
project_fact: juggler prod DB connects via socketPath (CLOUD_SQL_CONNECTION_NAME set) through the Cloud SQL Proxy sidecar — NOT the TCP+TLS knexfile branch (that branch was dead, removed in 999.436). Same dead-footgun still in payment + bug-reporter knexfiles → 999.440.

---
type: process-lesson
leg: sibling-knexfile-tls-deadbranch
date: 2026-06-12T23:05:01Z
lesson: The Step-7.1 HEAD-drift guard (added prior retro) is single-repo only; multi-service legs commit per-submodule and lacked the equivalent branch-verify.
agent_edit: ~/.claude/skills/kermit/SKILL.md Multi-Service "Commit order" bullet — added a per-submodule "verify on leg/<leg_id> before git add" check (multi-service analog of the Step-7.1 guard). Lint PASS.
project_fact: payment + bug-reporter prod DB also connect via socketPath (CLOUD_SQL_CONNECTION_NAME); their TCP+TLS knexfile branches were dead, removed in 999.440. Same socketPath pattern now confirmed across juggler/payment/bug-reporter; auth + resume-optimizer use rejectUnauthorized:true (CA-verified / system trust).

## 2026-06-26T13:00:00Z — juggler-sweep-overdue — oscar
- type: decision
- artifact: juggler-backend/src/scheduler/runSchedule.js computeEffectiveDeadline
- change: effective-deadline for a recurring instance = MAX(period-boundary, window-close), not min. Overdue only when past BOTH (De Morgan dual of the original two independent OR early-return guards). Preserves R50.0 period-boundary extension for flexible-TPC recurring instances.
- rationale: backlog 999.840(4) text said "min" but ernie proved min() makes the period-boundary extension dead (time_flex capped 0..480 → windowClose always earlier) and flags flexible-TPC recurring instances overdue mid-cycle — a R50.0 regression. max() is behavior-preserving (full scheduler regression stayed green).
- supersedes: none

## 2026-06-26T13:00:01Z — juggler-sweep-overdue — oscar
- type: decision
- artifact: juggler-backend/src/slices/task/domain/mappers/taskMappers.js overdue IIFE (339-371)
- change: AFFIRMED (not changed) — a floating one-off (no recurrence, no deadline, not FIXED) past its date stays roll-forward / NOT overdue (999.671 contract); it belongs in the stale "past scheduled date" Issues bucket, not the overdue bucket. R50 governs visibility/pinning, not the overdue label. Treating such items as overdue (backlog 999.879 (1)(2)(3)) is a settled-decision REVERSAL requiring a David ruling (AMB-A) — deferred, not done this leg.
- rationale: Scooter consult + in-code provenance (taskMappers.js:370 comment). Prevents future relitigation of the 999.671 floating-one-off exclusion.
- supersedes: none
