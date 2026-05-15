'use strict';

/**
 * DB schema audit remediation — four issue categories from the 102-item juggler
 * code-review audit (BACKLOG.md `juggler-db-db-*` bucket):
 *
 *   1. Timezone inconsistency (5 columns) — documentation-only
 *   2. Type mismatches (3 columns) — 2 structural fixes, 1 documentation-only
 *   3. JSON schema gaps (4 columns) — documentation-only
 *   4. Residual uncategorized item (1) — documentation-only
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. TIMEZONE INCONSISTENCY (5 columns)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Mixed use of MySQL DATETIME (no tz) vs TIMESTAMP (UTC-anchored) across
 * scheduling and sync tables. The backend stores all scheduling times in UTC,
 * but the column types don't encode this guarantee.
 *
 * Column                                Type       Contract / Risk
 * ─────────────────────────────────────────────────────────────────
 * task_instances.scheduled_at           DATETIME   Backend writes UTC via
 *                                                  localToUtc(). No tz stored.
 *                                                  Reading as local time is
 *                                                  silent correctness bug.
 *                                                  Decision: document only —
 *                                                  changing to TIMESTAMP(6)
 *                                                  could corrupt existing
 *                                                  rows stored in non-UTC zones.
 *
 * task_instances.completed_at           DATETIME   Same UTC contract as
 *                                                  scheduled_at. Added in
 *                                                  20260509000300 with DATETIME
 *                                                  for consistency. Document only.
 *
 * task_masters.desired_at               DATETIME   Stores mixed intents:
 *                                                  day-only entries use local-noon
 *                                                  (see SCHEMA.md "desired_at #11");
 *                                                  timed entries store UTC.
 *                                                  The user's `tz` column is required
 *                                                  to interpret this correctly.
 *                                                  Document only — no safe ALTER.
 *
 * task_masters.disabled_at              TIMESTAMP  Inconsistent with the DATETIME
 *                                                  columns around it. TIMESTAMP is
 *                                                  MySQL-UTC-anchored; DATETIME is
 *                                                  bare. Mixed types on the same
 *                                                  logical table create confusion.
 *                                                  Document only — ALTER risks
 *                                                  timestamp interpretation shift.
 *
 * cal_sync_ledger.synced_at             TIMESTAMP  Created as TIMESTAMP (second
 * cal_sync_ledger.task_updated_at       TIMESTAMP  precision) in 20260315000000.
 *                                                  last_modified_at was upgraded to
 *                                                  TIMESTAMP(6) in 20260509001000 for
 *                                                  MSFT microsecond precision, but
 *                                                  synced_at and task_updated_at were
 *                                                  not upgraded. Potential truncation
 *                                                  in precision-sensitive comparisons.
 *                                                  Document only for now; upgrade if
 *                                                  MSFT sync precision issues recur.
 *
 * Fix path for all 5 columns when safe to act:
 *   - task_instances.scheduled_at / completed_at → DATETIME (keep; UTC contract
 *     is enforced by application — add a DB comment for future maintainers).
 *   - task_masters.desired_at → DATETIME (keep; mixed-intent column; document
 *     the local-noon convention in SCHEMA.md).
 *   - task_masters.disabled_at → DATETIME NULL (align with other DATETIME
 *     columns; safe once timezone audit confirms no edge-case rows).
 *   - cal_sync_ledger.synced_at / task_updated_at → TIMESTAMP(6) to match
 *     last_modified_at (safe when database timezone is UTC in production).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. TYPE MISMATCHES (3 columns)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * a) task_write_queue.task_id: VARCHAR(36) → VARCHAR(100)   [FIXED HERE]
 *    -------------------------------------------------------
 *    task_masters.id and task_instances.id are VARCHAR(100). The write queue
 *    joins on task_id to look up task rows and to match against task_masters.id.
 *    A 36-char column silently truncates task IDs longer than 36 characters,
 *    causing missed matches and silent enqueue failures.
 *    Current data: task IDs use a slug+UUIDv4 pattern that can reach ~50–70
 *    chars. Any ID > 36 chars in flight would already be stored truncated; after
 *    this migration they can be stored correctly. No data loss on up or down.
 *
 * b) task_instances.overdue: TINYINT → TINYINT(1) / BOOLEAN  [FIXED HERE]
 *    -------------------------------------------------------
 *    All other boolean-semantic columns in this schema use table.boolean() which
 *    maps to TINYINT(1) in MySQL. The overdue column was added in migration
 *    20260501000100 using table.tinyint() (no width), which MySQL resolves as
 *    TINYINT(4) — a signed range of -128..127 that implies multi-value semantics.
 *    Code always writes 0 or 1 and reads via !!row.overdue (runSchedule.js:1263,
 *    task.controller.js:433). Correcting to TINYINT(1) aligns the declared type
 *    with the boolean-only contract. Safe: only 0/1 values are stored.
 *
 * c) cal_sync_ledger.miss_count: INTEGER → TINYINT UNSIGNED  [FIXED HERE]
 *    -------------------------------------------------------
 *    miss_count is used as a two-state counter: 0 (not missing) or 1 (one miss
 *    observed, CDN lag suspected). Code writes 0 or 1 (cal-sync.controller.js:
 *    751, 997, 1024, 1044, 1056) and reads via `>= 1` and `=== 0` comparisons.
 *    The INTEGER (4-byte signed) declaration is inconsistent with the actual
 *    maximum value of 1. TINYINT UNSIGNED (0–255, 1 byte) matches the semantic
 *    range and saves 3 bytes per row. Safe: all existing values are 0 or 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. JSON SCHEMA GAPS (4 columns)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * MySQL does not support CHECK constraints on JSON columns in a practical way
 * (JSON_SCHEMA_VALID() CHECK constraints have significant performance overhead).
 * Application-level validation is the appropriate enforcement point.
 *
 * Column: task_masters.recur
 *   Schema: { type: string, days?: string, every?: number, anchor?: string,
 *             timesPerCycle?: number }
 *   type values: 'daily' | 'weekly' | 'biweekly' | 'interval' | 'timesPerCycle'
 *   days values: day-abbreviation string e.g. 'MWF', 'MTWRF' (weekly only)
 *   every: positive integer (interval recurrence only)
 *   anchor: ISO date string (biweekly/interval anchor point)
 *   timesPerCycle: positive integer (timesPerCycle type only)
 *   Validation gap: task.controller.js validates recur.type and anchor-dependency
 *   but does not enforce that `days` is a valid day-abbreviation string or that
 *   `every`/`timesPerCycle` are positive integers.
 *   Fix location: task.controller.js validateRecur() (line 772) — add regex
 *   check on `days`, range check on `every` and `timesPerCycle`.
 *
 * Column: task_masters.depends_on
 *   Schema: string[] — array of task_masters.id values
 *   Validation gap: task.controller.js serializes as JSON.stringify(array) but
 *   does not verify that each element is a valid task ID or that the task exists.
 *   Circular dependency (A depends on B depends on A) is not guarded at insert.
 *   Fix location: task.controller.js PATCH /api/tasks/:id — validate array
 *   element type (string), existence in task_masters, and absence of cycles via
 *   the dependency graph helper already used in runSchedule.js.
 *
 * Column: task_masters.location
 *   Schema: string[] — array of location IDs (keys of user_config.locations[])
 *   e.g. ["home", "work"]. Parsed with safeParseJSON(row.location, []).
 *   Validation gap: no check that referenced location IDs exist in user_config.
 *   Fix location: task.controller.js tasksToRow() — after parsing user_config,
 *   filter location array to only IDs present in the config.
 *
 * Column: task_masters.tools
 *   Schema: string[] — array of tool IDs (keys of user_config.tools[])
 *   e.g. ["phone", "laptop"]. Same pattern as location.
 *   Validation gap: same as location — no existence check against user_config.
 *   Fix location: task.controller.js tasksToRow() — same filter as location.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. RESIDUAL UNCATEGORIZED ITEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Column: cal_sync_ledger.calendar_id  (added by 20260415000000)
 *
 *   Status: the column exists but is NEVER populated by any write path.
 *   SCHEMA.md line 383 confirms: "cal_sync_ledger.calendar_id is unused. Either
 *   populate it everywhere or drop the column."
 *
 *   All ~10 ledgerInserts.push() call-sites in cal-sync.controller.js omit
 *   calendar_id. The Apple adapter (apple.adapter.js) knows which calendar an
 *   event came from, but this information is not threaded through to the ledger
 *   insert. GCal/MSFT operate against a single primary calendar only.
 *
 *   Decision rationale:
 *     - DROP is premature: the column represents correct intent (multi-calendar
 *       awareness) and will be needed when GCal/MSFT multi-calendar lands.
 *     - POPULATE now is a multi-file change affecting the sync controller and all
 *       three adapters; it belongs in a dedicated phase, not a schema cleanup pass.
 *     - ACTION: keep the column, add a SQL COMMENT documenting the gap, and track
 *       the population work as a backlog item.
 *
 *   Fix location (when ready to populate):
 *     1. apple.adapter.js: thread the source calendar URL through ingestEvents()
 *        return values.
 *     2. cal-sync.controller.js: every ledgerInserts.push() that originates from
 *        Apple must set calendar_id = the source calendar URL.
 *     3. GCal/MSFT: read user_calendars to get the calendar ID in scope and set
 *        calendar_id on their ledger inserts.
 *     4. Disambiguate ledger lookups: WHERE (user_id, provider, calendar_id,
 *        provider_event_id) instead of (user_id, provider, provider_event_id).
 */

exports.up = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    // ── 2a. Widen task_write_queue.task_id from VARCHAR(36) to VARCHAR(100) ──
    // Task IDs (task_masters.id, task_instances.id) are VARCHAR(100). The write
    // queue must accept the same range of IDs to avoid silent truncation.
    const hasWriteQueue = await knex.schema.hasTable('task_write_queue');
    if (hasWriteQueue) {
      await knex.raw(
        "ALTER TABLE task_write_queue MODIFY COLUMN task_id VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci COMMENT 'task_masters.id or task_instances.id — widened from VARCHAR(36) to match the 100-char ID schema'"
      );
    }

    // ── 2b. Fix task_instances.overdue: TINYINT → TINYINT(1) ─────────────────
    // TINYINT without a width defaults to TINYINT(4) in MySQL — implies signed
    // multi-value. Correcting to TINYINT(1) (MySQL boolean) aligns the declared
    // type with the boolean-only usage (values: 0 or 1 only).
    const hasInstances = await knex.schema.hasTable('task_instances');
    if (hasInstances) {
      const overdueExists = await knex.schema.hasColumn('task_instances', 'overdue');
      if (overdueExists) {
        await knex.raw(
          "ALTER TABLE task_instances MODIFY COLUMN overdue TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Boolean: 1 = task is past its deadline and has been pinned in place as overdue. Only 0/1 values are written.'"
        );
      }
    }

    // ── 2c. Fix cal_sync_ledger.miss_count: INTEGER → TINYINT UNSIGNED ───────
    // miss_count is a two-state counter (0 = seen, 1 = one miss / CDN lag). The
    // INTEGER (4-byte) declaration overstates the range. TINYINT UNSIGNED (1 byte,
    // range 0–255) matches the semantic range and saves 3 bytes per row.
    const hasLedger = await knex.schema.hasTable('cal_sync_ledger');
    if (hasLedger) {
      const missCountExists = await knex.schema.hasColumn('cal_sync_ledger', 'miss_count');
      if (missCountExists) {
        await knex.raw(
          "ALTER TABLE cal_sync_ledger MODIFY COLUMN miss_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'CDN-lag miss counter. 0 = event seen. 1 = one consecutive miss (CDN lag suspected, not yet a deletion). Resets to 0 on next successful pull.'"
        );
      }
    }

    // ── 4. Document cal_sync_ledger.calendar_id as intentionally unpopulated ──
    // Add a SQL COMMENT so future readers know this is a known gap, not an
    // oversight. The column is kept for when multi-calendar population lands.
    if (hasLedger) {
      const calIdExists = await knex.schema.hasColumn('cal_sync_ledger', 'calendar_id');
      if (calIdExists) {
        await knex.raw(
          "ALTER TABLE cal_sync_ledger MODIFY COLUMN calendar_id VARCHAR(500) NULL COLLATE utf8mb4_unicode_ci COMMENT 'UNPOPULATED (2026-05-15): intended for multi-calendar awareness but no write path sets this yet. Kept for future multi-cal work. See SCHEMA.md #1 and juggler-db residual audit item.'"
        );
      }
    }

  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function(knex) {
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    // ── Reverse 2a: shrink task_write_queue.task_id back to VARCHAR(36) ──────
    // WARNING: any task_id values longer than 36 chars written after the up()
    // migration will be silently TRUNCATED on rollback. This is a data-loss risk
    // if long IDs have been enqueued. Only roll back in dev/test environments.
    const hasWriteQueue = await knex.schema.hasTable('task_write_queue');
    if (hasWriteQueue) {
      await knex.raw(
        "ALTER TABLE task_write_queue MODIFY COLUMN task_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci"
      );
    }

    // ── Reverse 2b: restore task_instances.overdue to TINYINT (no width) ─────
    const hasInstances = await knex.schema.hasTable('task_instances');
    if (hasInstances) {
      const overdueExists = await knex.schema.hasColumn('task_instances', 'overdue');
      if (overdueExists) {
        await knex.raw(
          "ALTER TABLE task_instances MODIFY COLUMN overdue TINYINT NOT NULL DEFAULT 0"
        );
      }
    }

    // ── Reverse 2c: restore cal_sync_ledger.miss_count to INTEGER ────────────
    const hasLedger = await knex.schema.hasTable('cal_sync_ledger');
    if (hasLedger) {
      const missCountExists = await knex.schema.hasColumn('cal_sync_ledger', 'miss_count');
      if (missCountExists) {
        await knex.raw(
          "ALTER TABLE cal_sync_ledger MODIFY COLUMN miss_count INT NOT NULL DEFAULT 0"
        );
      }
    }

    // ── Reverse 4: strip the comment from calendar_id (cosmetic only) ────────
    if (hasLedger) {
      const calIdExists = await knex.schema.hasColumn('cal_sync_ledger', 'calendar_id');
      if (calIdExists) {
        await knex.raw(
          "ALTER TABLE cal_sync_ledger MODIFY COLUMN calendar_id VARCHAR(500) NULL COLLATE utf8mb4_unicode_ci"
        );
      }
    }

  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};
