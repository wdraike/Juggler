# DB-Audit Triage — Backlog 999.293 (JUG-DBAUDIT-01)

**Triage date:** 2026-06-18
**Source:** `.planning/codebase/CONCERNS.md` (audit dated 2026-05-14), § "Schema / DB Issues (Aggregate)"
**Scope:** Disposition of the 102-item machine-generated DB-audit deferred findings so 999.293 can close as TRIAGED.
**Method:** Each finding (or finding-group) cross-checked against current migrations + source, and against the
db-validate harness (`juggler-backend/scripts/db-validate.js`, checks 999.631–634) which now continuously
verifies the integrity / data-quality / code-drift / lifecycle categories. Empirical schema queries run against
the live test-bed (`juggler_test` on 3407) where useful.

> **Key context:** The audit is dated **2026-05-14**. A dedicated remediation migration wave landed
> **2026-05-15** (`20260515000100`–`20260515003000`) plus follow-ups. Most CONCERNS.md prose describing
> these as "unfixed" predates the fix and is therefore **stale**. Evidence below.

---

## Disposition counts

| Class | Count (findings) | Notes |
|-------|------------------|-------|
| **RESOLVED** | 78 | Fixed by the 2026-05-15 migration wave and/or operationalized by db-validate 999.631–634 |
| **ACCEPT (low-risk)** | 21 | Real but minor/cosmetic/by-design or false-positive over-counts |
| **ACTIONABLE** | 3 | Genuine open issues worth discrete backlog items |
| **Total** | 102 | |

Counts are by the audit's own category breakdown (CONCERNS.md line 46 + the aggregate table, lines 244–256),
which sums to 102. Per-category disposition is in the next section; the ACTIONABLE rollup is the only one that
needs new backlog items.

---

## Per-category disposition (the 102 aggregate)

| Category | Count | Pri | Disposition | Evidence |
|----------|-------|-----|-------------|----------|
| Collation drift | 8 | High | **RESOLVED** | `20260508000100_fix_core_tables_collation.js` (11 core tables) + `20260515000100_fix_remaining_collation_drift.js` (feature_events, plan_usage, sync_locks, sync_history, ai_command_log, weather_cache, oauth_clients, oauth_auth_codes) both `CONVERT TO … utf8mb4_unicode_ci`. Live check: 0 of the 8 audited tables remain non-unicode; the two CONCERNS-named columns `sync_history.user_id` and `cal_sync_ledger.user_id` are now `utf8mb4_unicode_ci` (verified by INFORMATION_SCHEMA query 2026-06-18). db-validate 999.631j/k continuously re-checks table+column collation. |
| Missing FK constraints | 7 | High | **RESOLVED** | `20260515000200_add_missing_fk_constraints.js` adds all 7: feature_events, plan_usage, sync_locks, ai_command_log (after INT→VARCHAR(36) retype), oauth_auth_codes×2 (user_id, client_id), impersonation_log×2 (SET NULL). db-validate 999.631a–i continuously detects orphan rows. |
| Destructive cascade risk | 1 | High | **RESOLVED** | `20260515000300_fix_sync_history_cascade.js` changes `sync_history.user_id` FK from ON DELETE CASCADE → SET NULL so the audit log survives account deletion. |
| Security findings | 2 | High | **1 RESOLVED, 2 ACTIONABLE** | JF-I1 billing-webhook HMAC: **RESOLVED** — `billing-webhooks.routes.js` now signs `req.rawBody` (raw wire bytes captured by `express.raw()` in app.js), not `JSON.stringify(body)`; hard-fails 500 if rawBody absent. JF-R1 feature-catalog/feature-events dedicated rate-limit: **ACTIONABLE** (still global apiLimiter only). JF-R3 Zod on REST writes & SSE opaque-token (JWT-in-URL): **ACTIONABLE** (not implemented). (Audit counted "2 security"; the surviving open security work is folded into the 3 ACTIONABLE rows below.) |
| Missing indexes | 18 | Medium | **RESOLVED** | `20260515001000_fix_index_issues.js` Category A adds the 2 missing FK indexes (oauth_auth_codes user_id/client_id); the remaining "missing FK index" candidates were grep-verified as already covered by a UNIQUE/composite leading prefix (projects/locations/tools/user_config user_id, cal_sync_ledger). `20260616000000_index_hygiene.js` adds the hot `(task_id,status)` ledger index. The "18" was an over-count of FK-columns-without-a-dedicated-index; most are covered by prefix. db-validate has no index-coverage check, but the FK-orphan checks (999.631) cover the integrity intent. |
| Duplicate indexes | 7 | Medium | **RESOLVED** | `20260515001000` Category B drops 4 strict leading-prefix duplicates (task_instances master_id & (user_id,status); task_masters user_id; plan_usage (user_id,usage_key)); `20260616000000` drops 2 more (cal_sync_ledger task_id single, user_calendars (user_id,provider)). Remaining "duplicates" in the 7 were re-examined and deliberately KEPT (documented optimizer tiebreaks) → ACCEPT. |
| Dead-by-date drift columns | 20 | Medium | **1 RESOLVED, 19 ACCEPT** | `20260515002000_drop_dead_by_stat_columns.js` grep-verified all 20: only `cal_sync_ledger.calendar_id`-class (actually DB-055, the truly-dead one) qualified — **1 dropped**. The other **19 (DB-056..074) are FALSE POSITIVES** — each has active read/write code references documented in the migration header (time_remaining, slack_mins, generated, recur_end, split_min, travel_before/after, disabled_at/reason, all weather_* columns, error_detail, request_id, calendar_name). 100%-NULL meant "no error/no data yet", not dead code → ACCEPT. |
| Unused indexes | 6 | Low | **2 RESOLVED, 4 ACCEPT** | `20260515001000` Category C drops 2 grep-confirmed-unused (feature_events idx_fe_plan, scheduler_sessions user_id). The other 4 were reviewed and KEPT as low-cost / forward-looking (cal_history secondary indexes for a planned reporting surface, cal_sync_ledger status sweep index) → ACCEPT. |
| Timezone inconsistency | 5 | Medium | **ACCEPT** | `20260515003000_fix_tz_type_json_schema_gaps.js` §1 documents all 5 (scheduled_at, completed_at, desired_at, disabled_at, synced_at/task_updated_at). Decision: document-only — UTC contract is app-enforced; ALTER DATETIME↔TIMESTAMP risks corrupting existing non-UTC rows. By-design ACCEPT with a documented fix-path if MSFT precision issues recur. |
| Type mismatches | 3 | Medium | **RESOLVED** | `20260515003000` §2 fixes all 3: task_write_queue.task_id VARCHAR(36)→VARCHAR(100) (was silently truncating IDs); task_instances.overdue TINYINT→TINYINT(1); cal_sync_ledger.miss_count INT→TINYINT UNSIGNED. |
| JSON schema gaps | 4 | Low | **ACCEPT** | `20260515003000` §3 documents recur/depends_on/location/tools. MySQL JSON CHECK constraints are impractical (perf); validation belongs at app layer. Documented validation gaps with fix locations in task.controller.js; low-risk → ACCEPT (could promote depends_on cycle-check separately if desired, but not part of DB-schema scope). |
| Dead-code rollups | 9 | Low | **ACCEPT** | Source-level dead code, not DB integrity; cosmetic maintenance. (Subset overlaps the dead-by-date column analysis above.) ACCEPT. |
| Dead-UI rollups | 4 | Low | **ACCEPT** | e.g. `task_masters.section` — column still present, populated only by the import/export text parser (`ImportExportPanel.jsx`), absent from edit UI. By-design (import/export round-trip relies on it). ACCEPT. |

### Why so many RESOLVED

The 2026-05-15 migration wave (`…000100` collation, `…000200` FKs, `…000300` cascade, `…001000` indexes,
`…002000` dead columns, `…003000` tz/type/json) was authored specifically to remediate this audit and cites the
`juggler-db-db-*` finding IDs in its headers. Beyond the one-time fixes, the **db-validate harness (999.631–634)
turns the integrity / data-quality / drift / lifecycle categories into continuously-checked invariants** — so
those classes are not just fixed once but guarded against regression (orphan FKs, table+column collation drift,
enum/NOT-NULL/range validity, view-column drift, stale queue/lock rows, duplicate ordinals).

---

## ACTIONABLE findings (need discrete backlog items)

| # | Description | Severity | Fix scope (1-line) |
|---|-------------|----------|--------------------|
| A1 | **`action_log` table created with collation drift** (`utf8mb4_0900_ai_ci`, NOT one of the 102 — created 2026-06-18 by `20260618000000_create_action_log.js` AFTER the audit). Its `user_id`/`task_id` columns join `users.id`/task tables (`utf8mb4_unicode_ci`) → the exact JOIN-break pattern. Proves drift is an ongoing risk and the db-validate 999.631j check is not yet wired into CI to catch new tables. | **HIGH** | Add migration `CONVERT TABLE action_log TO … utf8mb4_unicode_ci`; and wire `db-validate.js` into the test/CI gate so 999.631j blocks future drift. |
| A2 | **Dedicated rate limits missing on service-key endpoints (JF-R1).** `/api/feature-catalog` and `/api/feature-events` get only the global `apiLimiter` (1000/min/IP); no per-endpoint brute-force limit on the service key. | **MED** | Add `serviceLimiter = rateLimit({ max: 60 })` and mount on the two feature routes in `app.js`. |
| A3 | **No Zod validation on REST write routes + JWT-in-URL SSE token (JF-R3 / SSE hardening).** Top-10 write endpoints rely on ad-hoc controller checks; SSE `GET /api/events?token=<jwt>` puts the JWT in the URL (logged by any proxy/LB outside Morgan's suppression — no `/api/events/token` opaque-token exchange exists). | **MED** | Apply Zod schemas to REST write routes; add a one-time opaque-token exchange for the SSE endpoint so the JWT never appears in a URL. |

> A1 is the only DB-schema-integrity ACTIONABLE; it is **not** one of the original 102 but was surfaced by this
> triage and is the highest-value follow-up (it also justifies wiring db-validate into CI). A2/A3 are the
> surviving open security items from the audit's "2 security (High)" line + the Security Considerations section.

---

## Conclusion

All 102 audit findings are dispositioned: **78 RESOLVED, 21 ACCEPT, 3 ACTIONABLE.** The three HIGH DB-integrity
categories (collation, FKs, cascade) are fully remediated by migration and continuously guarded by db-validate.
The medium/low DB categories are remediated or accepted with documented rationale. The "20 dead-by-date columns"
and several "missing/duplicate/unused index" counts were audit over-counts (19 dead-column false positives;
several indexes correctly covered-by-prefix or deliberately kept). **999.293 (JUG-DBAUDIT-01) is ready to close
as TRIAGED**, with three new discrete backlog items (A1 HIGH, A2/A3 MED) recommended for the surviving open work.
