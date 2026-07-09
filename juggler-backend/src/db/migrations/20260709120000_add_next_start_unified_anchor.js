'use strict';

/**
 * juggler-recur-lifecycle-redesign W1 — FR-1 (Unified anchor) / AC1.
 *
 * Adds a single nullable `next_start` DATE column to `task_masters`: the first
 * non-terminal instance date for that master. This REPLACES the two separate
 * anchor columns (`rolling_anchor` — only ever populated for recur.type==='rolling',
 * added by `20260520000100_add_rolling_anchor.js` — and `next_occurrence_anchor` —
 * the generalized "next occurrence in this master's own pattern" pointer for ALL
 * other recur types, added by `20260703210000_add_next_occurrence_anchor.js`) with
 * one unified concept, per SPEC.md FR-1.
 *
 * Scope of THIS migration (W1 only — see WBS-juggler-recur-lifecycle-redesign.md):
 *   1. Add nullable `task_masters.next_start` DATE column.
 *   2. Backfill EXISTING rows: next_start = COALESCE(rolling_anchor, next_occurrence_anchor)
 *      is the shape of the RESULT, but the exact tie-break when BOTH are set is NOT a
 *      generic "first non-null" coalesce — telly's step-0 test (test #4,
 *      tests/task_masters_next_start_unified_anchor.regression.test.js) pins
 *      `rolling_anchor` as the winner when both are non-null, because it is the
 *      older/more-specific mechanism (the original anchor column; next_occurrence_anchor
 *      was added later, 999.1091, as a generalization — see that migration's header).
 *      Backfill SQL: `next_start = COALESCE(rolling_anchor, next_occurrence_anchor)`
 *      — MySQL's COALESCE returns the first non-NULL argument, so listing
 *      rolling_anchor first already encodes "rolling_anchor wins when both are set"
 *      (COALESCE does not average/merge — it short-circuits on the first non-null).
 *      This one-time UPDATE only reaches rows that exist AT MIGRATION TIME; it is a
 *      ONE-TIME backfill, not an ongoing derivation mechanism (see next note).
 *   3. Recreate `tasks_v` / `tasks_with_sync_v` to project `next_start`, injected next
 *      to the existing `rolling_anchor` projection (same anchor-injection technique as
 *      the two sibling migrations below).
 *
 * NO DB-side ongoing derivation (bert fix, per cookie W1-ARCH-1/W1-ARCH-2 + ernie
 * ernie-w1-trigger-convention/ernie-w1-w2-column-drop-landmine, both WARN, both
 * converging on the same remediation): an earlier draft of this migration also added a
 * `BEFORE INSERT` trigger (`task_masters_before_insert_next_start`) that re-applied the
 * same COALESCE rule to every row inserted after this migration ran. Both reviewers
 * independently flagged it and it has been REMOVED:
 *   (a) it duplicated the tie-break rule in a second, DB-side home when every sibling
 *       anchor column (`rolling_anchor`, `next_occurrence_anchor`) is derived and
 *       written ONLY in Node (src/slices/task/facade.js:581-594,
 *       src/lib/rolling-anchor.js, src/lib/next-occurrence-anchor.js) — the established
 *       convention in this codebase is app-layer derivation, not DB triggers (the only
 *       prior triggers, 20260415010200, were transitional dual-write bridges, explicitly
 *       dropped with the table they bridged — not a precedent for permanent business
 *       logic in a trigger); and
 *   (b) the trigger body referenced `NEW.rolling_anchor` / `NEW.next_occurrence_anchor`,
 *       both of which W2 (the very next work item in this leg) is scoped to DROP — a
 *       trigger referencing a dropped column fails every subsequent INSERT with
 *       "Unknown column", a landmine gated on a downstream migration remembering to
 *       also drop this trigger in lockstep, a dependency that was tracked only in a
 *       build-log note, not the WBS.
 * W2's own task_masters INSERT / anchor write path (src/lib/tasks-write.js and
 * friends) now owns the COALESCE(rolling_anchor, next_occurrence_anchor) tie-break as
 * the SINGLE source of truth for ongoing derivation; this migration is backfill-only.
 * A `task_masters` row created in the W1->W2 window with `next_start` left NULL is
 * expected, spec-legal state per FR-1 (next_start is nullable-until-first-anchor-event;
 * rolling masters have no anchor until first completion; the scheduler-run sweep /
 * terminal-write paths advance it going forward) — not a data-integrity gap.
 *
 * Explicitly OUT OF SCOPE for this migration (deferred to W2, a LATER work item per the
 * WBS): dropping `rolling_anchor` / `next_occurrence_anchor` themselves, cutting over
 * the read/write code paths (facade.js, next-occurrence-anchor.js, expandRecurring.js
 * getAnchor) to `next_start`, AND the ongoing per-INSERT COALESCE derivation (see note
 * above — owned by W2's app-layer write path, not a DB trigger). Both old columns
 * remain fully intact and unread-from/unwritten-to BY THIS MIGRATION — it only ADDS
 * `next_start` alongside them, plus the one-time backfill. AC1's "no code path
 * reads/writes the two old columns after this leg" is satisfied by W2, not W1.
 *
 * Migration policy (juggler CLAUDE.md 999.733 / template:
 * `20260703210000_add_next_occurrence_anchor.js`, `20260703220000_restore_rolling_
 * anchor_in_tasks_v.js`): schema changes that alter tasks_v's shape MUST recreate the
 * view in the same migration. NEVER hand-copy the view body — read it live
 * (SHOW CREATE VIEW) and inject the new column by anchoring on an existing column
 * present in every branch that needs it. DDL implies commit -> non-transactional.
 *
 * Anchor choice: `rolling_anchor` (verified live, test-bed, fresh migrate:latest,
 * 2026-07-09: present exactly twice in tasks_v — once per union branch — and exactly
 * once in tasks_with_sync_v, restored by the 20260703220000 migration in this same
 * batch). Anchoring on the OTHER unified-anchor predecessor keeps next_start visually
 * grouped with its sibling anchor columns in the view definition.
 *
 * Idempotency guard (bert fix, per ernie ernie-w1-early-return-idempotency-gap, WARN):
 * this migration is non-transactional DDL (config.transaction=false — see below), so a
 * crash between the `tasks_v` CREATE and the `tasks_with_sync_v` CREATE is possible
 * (both views are DROPPED before either is recreated). The re-run guard therefore
 * checks BOTH views (not just tasks_v) before treating the migration as
 * already-applied: if tasks_with_sync_v is unexpectedly missing entirely (the one
 * state that exact crash window can leave behind), it FAILS LOUDLY instead of
 * silently returning — see the up() body for the full reasoning.
 */
exports.config = { transaction: false };

// Strip the non-portable DEFINER/ALGORITHM/SQL SECURITY preamble so the def can be
// re-created cleanly. We DROP + CREATE explicitly, matching the sibling migrations.
function portableViewSql(createViewStmt) {
  return String(createViewStmt)
    .replace(/^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY \w+\s+VIEW/i, 'CREATE VIEW');
}

function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

exports.up = async function up(knex) {
  // 1. Add the column.
  var hasCol = await knex.schema.hasColumn('task_masters', 'next_start');
  if (!hasCol) {
    await knex.schema.table('task_masters', function(t) {
      t.date('next_start').nullable().defaultTo(null);
    });
  }

  // 2. One-time backfill: rolling_anchor wins the tie when both are set (COALESCE
  //    returns the first non-NULL argument — listing rolling_anchor first encodes the
  //    tie-break). Idempotent — re-running only touches rows where next_start is still
  //    NULL but at least one source anchor is set, so a second run is a no-op. This is
  //    the ONLY derivation mechanism this migration installs — no trigger (see header
  //    "NO DB-side ongoing derivation").
  await knex.raw(
    'UPDATE `task_masters` SET `next_start` = COALESCE(`rolling_anchor`, `next_occurrence_anchor`) ' +
    'WHERE `next_start` IS NULL AND (`rolling_anchor` IS NOT NULL OR `next_occurrence_anchor` IS NOT NULL)'
  );

  // 3. Read tasks_v's current def, and independently check tasks_with_sync_v's
  //    EXISTENCE + def (do NOT early-return on tasks_v alone — see idempotency-guard
  //    header note): a crash between recreating tasks_v and recreating
  //    tasks_with_sync_v (non-transactional DDL) can leave tasks_v already carrying
  //    next_start while tasks_with_sync_v is fully dropped and not yet recreated.
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  var vAnchor = '`m`.`rolling_anchor` AS `rolling_anchor`';
  var vAlreadyInjected = sqlV.includes('`m`.`next_start` AS `next_start`');

  var syncExists = await knex.schema.hasTable('tasks_with_sync_v');
  var sqlSync = null;
  var syncAlreadyInjected = false;
  var syncAnchor = '`v`.`rolling_anchor` AS `rolling_anchor`';
  if (syncExists) {
    var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
    sqlSync = portableViewSql(rowsSync[0][0]['Create View']);
    syncAlreadyInjected = sqlSync.includes('`v`.`next_start`');
  }

  if (vAlreadyInjected && syncAlreadyInjected) return; // both views already carry next_start — fully idempotent no-op

  if (!syncExists) {
    // tasks_with_sync_v is completely missing. The only way to reach this state is a
    // prior run of THIS migration crashing between the tasks_v CREATE and the
    // tasks_with_sync_v CREATE (both views are DROPPED before either is recreated —
    // see step 6 below), which this non-transactional DDL cannot protect against. We
    // cannot safely regenerate tasks_with_sync_v's SQL from nothing (its live
    // definition no longer exists anywhere once dropped) — fail loudly so knex does
    // NOT mark this migration applied, instead of silently returning and leaving the
    // view permanently missing (the bug this idempotency fix addresses).
    throw new Error(
      'add_next_start_unified_anchor: tasks_with_sync_v is missing (expected to exist) — ' +
      'a previous run of this migration likely crashed mid-way; restore the view ' +
      '(e.g. re-run 20260703220000_restore_rolling_anchor_in_tasks_v.js\'s up() against ' +
      'a correct tasks_v, or restore from a pre-migration backup) before re-running this migration'
    );
  }

  // 4. Inject next_start next to rolling_anchor in tasks_v — BOTH union branches share
  //    the identical literal (rolling_anchor lives on the joined master row `m` in
  //    either branch), so one global replace covers both. Skipped if already injected
  //    (a prior run got this far before crashing).
  if (!vAlreadyInjected) {
    var vCount = countOccurrences(sqlV, vAnchor);
    if (vCount !== 2) {
      throw new Error('add_next_start_unified_anchor: expected 2 occurrences of the rolling_anchor anchor in tasks_v, found ' + vCount + ' — view shape unexpected; aborting to avoid a malformed view');
    }
    sqlV = replaceAll(sqlV, vAnchor, vAnchor + ',`m`.`next_start` AS `next_start`');
  }

  // 5. Inject v.next_start next to v.rolling_anchor in tasks_with_sync_v (which SELECTs
  //    straight through from tasks_v — single occurrence expected). Anchor on the FULL
  //    "`v`.`col` AS `col`" literal, not just the bare column reference — a bare
  //    reference is a substring of that longer literal and would insert mid-clause,
  //    splitting "AS `col`" in half and producing a duplicate-column-name view (same
  //    hazard documented in the sibling migrations' headers). Skipped if already
  //    injected.
  if (!syncAlreadyInjected) {
    var syncCount = countOccurrences(sqlSync, syncAnchor);
    if (syncCount !== 1) {
      throw new Error('add_next_start_unified_anchor: expected 1 occurrence of the rolling_anchor anchor in tasks_with_sync_v, found ' + syncCount + ' — view shape unexpected; aborting to avoid a malformed view');
    }
    sqlSync = replaceAll(sqlSync, syncAnchor, syncAnchor + ',`v`.`next_start`');
  }

  // 6. Drop dependent-first, recreate base-first.
  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  await knex.raw(sqlSync);
};

exports.down = async function down(knex) {
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  sqlV = sqlV.split(',`m`.`next_start` AS `next_start`').join('');

  var hasSyncView = await knex.schema.hasTable('tasks_with_sync_v');
  var sqlSync = null;
  if (hasSyncView) {
    var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
    sqlSync = portableViewSql(rowsSync[0][0]['Create View']);
    // NOTE: the bare (no-AS) literal inserted by up() is what THIS migration wrote for
    // tasks_with_sync_v, but MySQL's view-definition storage always re-normalizes to an
    // explicit alias on any subsequent SHOW CREATE VIEW read (verified live, same
    // behavior documented in the sibling migrations) — so the CURRENT text being
    // stripped here always carries " AS `next_start`", never bare.
    sqlSync = sqlSync.split(',`v`.`next_start` AS `next_start`').join('');
  }

  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  if (sqlSync) await knex.raw(sqlSync);

  var hasCol = await knex.schema.hasColumn('task_masters', 'next_start');
  if (hasCol) {
    await knex.schema.table('task_masters', function(t) {
      t.dropColumn('next_start');
    });
  }
};
