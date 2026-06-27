#!/usr/bin/env node
/**
 * DB Integrity Harness (999.630-634)
 *
 * Runnable validation script that checks the Juggler test-bed MySQL (port 3407)
 * for four categories of integrity issues. Each check returns row-level offenders.
 *
 * Usage:
 *   node scripts/db-validate.js              # uses .env.test or defaults
 *   DB_PORT=3407 node scripts/db-validate.js  # explicit port
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 *   2 = connection / runtime error
 *
 * Checks:
 *   999.631 — Referential integrity: orphan FKs, collation consistency
 *   999.632 — Data quality: enum values, NOT-NULL violations, valid timestamps
 *   999.633 — Code drift: view column sets, enum sets match code
 *   999.634 — Lifecycle: orphan instances, stale queue rows
 */

'use strict';

// ── Bootstrap ────────────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.test') });

var knex = require('knex');
var config = require('../knexfile').test;

// Allow override from env
config.connection.port = parseInt(process.env.DB_PORT, 10) || config.connection.port || 3407;
config.connection.host = process.env.DB_HOST || config.connection.host || '127.0.0.1';
config.connection.user = process.env.DB_USER || config.connection.user || 'root';
config.connection.password = process.env.DB_PASSWORD || config.connection.password || 'rootpass';
config.connection.database = process.env.DB_NAME || config.connection.database || 'juggler_test';

var db = knex(config);

// ── Helpers ──────────────────────────────────────────────────────────────────
var results = { passed: [], failed: [] };
var totalChecks = 0;

function check(name, detail, ok) {
  totalChecks++;
  if (ok) {
    results.passed.push({ name: name, detail: detail || 'OK' });
  } else {
    results.failed.push({ name: name, detail: detail || 'FAIL' });
  }
}

function fmtRows(rows) {
  if (!rows || rows.length === 0) return '  (none)';
  return rows.map(function(r) { return '  ' + JSON.stringify(r); }).join('\n');
}

// ── 999.631 — Referential Integrity ──────────────────────────────────────────
async function checkReferentialIntegrity() {
  console.log('\n=== 999.631 — Referential Integrity ===\n');

  // 1a. Orphan task_instances (master_id references non-existent task_masters)
  var orphanInstances = await db.raw(`
    SELECT ti.id, ti.master_id, ti.text, ti.status
    FROM task_instances ti
    LEFT JOIN task_masters tm ON ti.master_id = tm.id
    WHERE ti.master_id IS NOT NULL AND tm.id IS NULL
  `);
  var oiRows = orphanInstances[0] || [];
  check(
    '999.631a — Orphan task_instances (master_id → task_masters.id)',
    oiRows.length + ' orphan instance(s) found\n' + fmtRows(oiRows),
    oiRows.length === 0
  );

  // 1b. Orphan cal_sync_ledger (task_id references non-existent task_instances)
  var orphanLedger = await db.raw(`
    SELECT csl.id, csl.task_id, csl.provider, csl.status
    FROM cal_sync_ledger csl
    LEFT JOIN task_instances ti ON csl.task_id = ti.id
    WHERE csl.task_id IS NOT NULL AND ti.id IS NULL
  `);
  var olRows = orphanLedger[0] || [];
  check(
    '999.631b — Orphan cal_sync_ledger (task_id → task_instances.id)',
    olRows.length + ' orphan ledger row(s) found\n' + fmtRows(olRows),
    olRows.length === 0
  );

  // 1c. Orphan cal_history (task_id references non-existent task_instances)
  var orphanCalHist = await db.raw(`
    SELECT ch.id, ch.task_id, ch.status
    FROM cal_history ch
    LEFT JOIN task_instances ti ON ch.task_id = ti.id
    WHERE ti.id IS NULL
  `);
  var ochRows = orphanCalHist[0] || [];
  check(
    '999.631c — Orphan cal_history (task_id → task_instances.id)',
    ochRows.length + ' orphan cal_history row(s) found\n' + fmtRows(ochRows),
    ochRows.length === 0
  );

  // 1d. Orphan projects (user_id references non-existent users)
  var orphanProjects = await db.raw(`
    SELECT p.id, p.name, p.user_id
    FROM projects p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE u.id IS NULL
  `);
  var opRows = orphanProjects[0] || [];
  check(
    '999.631d — Orphan projects (user_id → users.id)',
    opRows.length + ' orphan project(s) found\n' + fmtRows(opRows),
    opRows.length === 0
  );

  // 1e. Orphan locations (user_id references non-existent users)
  var orphanLocations = await db.raw(`
    SELECT l.id, l.name, l.user_id
    FROM locations l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE u.id IS NULL
  `);
  var olocRows = orphanLocations[0] || [];
  check(
    '999.631e — Orphan locations (user_id → users.id)',
    olocRows.length + ' orphan location(s) found\n' + fmtRows(olocRows),
    olocRows.length === 0
  );

  // 1f. Orphan tools (user_id references non-existent users)
  var orphanTools = await db.raw(`
    SELECT t.id, t.name, t.user_id
    FROM tools t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE u.id IS NULL
  `);
  var otRows = orphanTools[0] || [];
  check(
    '999.631f — Orphan tools (user_id → users.id)',
    otRows.length + ' orphan tool(s) found\n' + fmtRows(otRows),
    otRows.length === 0
  );

  // 1g. Orphan user_config (user_id references non-existent users)
  var orphanConfig = await db.raw(`
    SELECT uc.id, uc.user_id, uc.config_key
    FROM user_config uc
    LEFT JOIN users u ON uc.user_id = u.id
    WHERE u.id IS NULL
  `);
  var ucRows = orphanConfig[0] || [];
  check(
    '999.631g — Orphan user_config (user_id → users.id)',
    ucRows.length + ' orphan config row(s) found\n' + fmtRows(ucRows),
    ucRows.length === 0
  );

  // 1h. Orphan schedule_queue (user_id references non-existent users)
  var orphanQueue = await db.raw(`
    SELECT sq.user_id, sq.source, sq.created_at
    FROM schedule_queue sq
    LEFT JOIN users u ON sq.user_id = u.id
    WHERE u.id IS NULL
  `);
  var oqRows = orphanQueue[0] || [];
  check(
    '999.631h — Orphan schedule_queue (user_id → users.id)',
    oqRows.length + ' orphan queue row(s) found\n' + fmtRows(oqRows),
    oqRows.length === 0
  );

  // 1i. Orphan task_write_queue (user_id references non-existent users)
  var orphanWriteQ = await db.raw(`
    SELECT twq.user_id, twq.task_id, twq.operation
    FROM task_write_queue twq
    LEFT JOIN users u ON twq.user_id = u.id
    WHERE u.id IS NULL
  `);
  var owqRows = orphanWriteQ[0] || [];
  check(
    '999.631i — Orphan task_write_queue (user_id → users.id)',
    owqRows.length + ' orphan write-queue row(s) found\n' + fmtRows(owqRows),
    owqRows.length === 0
  );

  // 1j. Collation consistency — all app tables should use utf8mb4_unicode_ci
  var collationMismatches = await db.raw(`
    SELECT TABLE_NAME, TABLE_COLLATION
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ?
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME NOT IN ('knex_migrations', 'knex_migrations_lock')
      AND TABLE_COLLATION != 'utf8mb4_unicode_ci'
  `, [config.connection.database]);
  var cmRows = collationMismatches[0] || [];
  check(
    '999.631j — Collation consistency (all tables should be utf8mb4_unicode_ci)',
    cmRows.length + ' table(s) with non-standard collation\n' + fmtRows(cmRows),
    cmRows.length === 0
  );

  // 1k. Column-level collation mismatches within tables
  var colCollationIssues = await db.raw(`
    SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME, CHARACTER_SET_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME NOT IN ('knex_migrations', 'knex_migrations_lock')
      AND COLLATION_NAME IS NOT NULL
      AND COLLATION_NAME != 'utf8mb4_unicode_ci'
    LIMIT 50
  `, [config.connection.database]);
  var ccRows = colCollationIssues[0] || [];
  check(
    '999.631k — Column-level collation consistency',
    ccRows.length + ' column(s) with non-standard collation\n' + fmtRows(ccRows),
    ccRows.length === 0
  );
}

// ── 999.632 — Data Quality ──────────────────────────────────────────────────
async function checkDataQuality() {
  console.log('\n=== 999.632 — Data Quality ===\n');

  // 2a. task_masters.pri must be one of P1, P2, P3, P4
  var invalidPri = await db.raw(`
    SELECT id, text, pri FROM task_masters
    WHERE pri NOT IN ('P1','P2','P3','P4')
  `);
  var ipRows = invalidPri[0] || [];
  check(
    '999.632a — task_masters.pri enum values',
    ipRows.length + ' row(s) with invalid pri\n' + fmtRows(ipRows),
    ipRows.length === 0
  );

  // 2b. task_masters.weather_precip must be valid enum or NULL
  var invalidPrecip = await db.raw(`
    SELECT id, text, weather_precip FROM task_masters
    WHERE weather_precip IS NOT NULL
      AND weather_precip NOT IN ('any','wet_ok','light_ok','dry_only')
  `);
  var iprecRows = invalidPrecip[0] || [];
  check(
    '999.632b — task_masters.weather_precip enum values',
    iprecRows.length + ' row(s) with invalid weather_precip\n' + fmtRows(iprecRows),
    iprecRows.length === 0
  );

  // 2c. task_masters.weather_cloud must be valid enum or NULL
  var invalidCloud = await db.raw(`
    SELECT id, text, weather_cloud FROM task_masters
    WHERE weather_cloud IS NOT NULL
      AND weather_cloud NOT IN ('any','overcast_ok','partly_ok','clear')
  `);
  var icRows = invalidCloud[0] || [];
  check(
    '999.632c — task_masters.weather_cloud enum values',
    icRows.length + ' row(s) with invalid weather_cloud\n' + fmtRows(icRows),
    icRows.length === 0
  );

  // 2d. task_instances.status must be valid
  var invalidStatus = await db.raw(`
    SELECT id, master_id, status FROM task_instances
    WHERE status NOT IN ('','done','cancel','skip','pause','disabled')
  `);
  var isRows = invalidStatus[0] || [];
  check(
    '999.632d — task_instances.status enum values',
    isRows.length + ' row(s) with invalid status\n' + fmtRows(isRows),
    isRows.length === 0
  );

  // 2e. cal_history.status must be valid
  var invalidCalHistStatus = await db.raw(`
    SELECT id, task_id, status FROM cal_history
    WHERE status NOT IN ('PENDING','SCHEDULED','COMPLETED','MISSED','CANCELLED')
  `);
  var ichRows = invalidCalHistStatus[0] || [];
  check(
    '999.632e — cal_history.status enum values',
    ichRows.length + ' row(s) with invalid status\n' + fmtRows(ichRows),
    ichRows.length === 0
  );

  // 2f. task_masters NOT-NULL columns that should never be null
  var nullId = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE id IS NULL
  `);
  var nullUserId = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE user_id IS NULL
  `);
  var nullText = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE text IS NULL
  `);
  var nullDur = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE dur IS NULL
  `);
  var nullPri = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE pri IS NULL
  `);
  var nullStatus = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE status IS NULL
  `);
  var nullTaskType = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE task_type IS NULL
  `);
  var nullRecurring = await db.raw(`
    SELECT COUNT(*) AS cnt FROM task_masters WHERE recurring IS NULL
  `);

  var nullViolations = [];
  if (nullId[0][0].cnt > 0) nullViolations.push('id: ' + nullId[0][0].cnt);
  if (nullUserId[0][0].cnt > 0) nullViolations.push('user_id: ' + nullUserId[0][0].cnt);
  if (nullText[0][0].cnt > 0) nullViolations.push('text: ' + nullText[0][0].cnt);
  if (nullDur[0][0].cnt > 0) nullViolations.push('dur: ' + nullDur[0][0].cnt);
  if (nullPri[0][0].cnt > 0) nullViolations.push('pri: ' + nullPri[0][0].cnt);
  if (nullStatus[0][0].cnt > 0) nullViolations.push('status: ' + nullStatus[0][0].cnt);
  if (nullTaskType[0][0].cnt > 0) nullViolations.push('task_type: ' + nullTaskType[0][0].cnt);
  if (nullRecurring[0][0].cnt > 0) nullViolations.push('recurring: ' + nullRecurring[0][0].cnt);

  check(
    '999.632f — task_masters NOT-NULL column violations',
    nullViolations.length > 0 ? nullViolations.join('; ') : 'All NOT-NULL columns clean',
    nullViolations.length === 0
  );

  // 2g. task_instances NOT-NULL columns
  var tiNullId = await db.raw(`SELECT COUNT(*) AS cnt FROM task_instances WHERE id IS NULL`);
  var tiNullUserId = await db.raw(`SELECT COUNT(*) AS cnt FROM task_instances WHERE user_id IS NULL`);
  var tiNullStatus = await db.raw(`SELECT COUNT(*) AS cnt FROM task_instances WHERE status IS NULL`);

  var tiNullViolations = [];
  if (tiNullId[0][0].cnt > 0) tiNullViolations.push('id: ' + tiNullId[0][0].cnt);
  if (tiNullUserId[0][0].cnt > 0) tiNullViolations.push('user_id: ' + tiNullUserId[0][0].cnt);
  if (tiNullStatus[0][0].cnt > 0) tiNullViolations.push('status: ' + tiNullStatus[0][0].cnt);

  check(
    '999.632g — task_instances NOT-NULL column violations',
    tiNullViolations.length > 0 ? tiNullViolations.join('; ') : 'All NOT-NULL columns clean',
    tiNullViolations.length === 0
  );

  // 2h. Valid timestamps — created_at should not be in the future
  var futureCreatedAt = await db.raw(`
    SELECT id, 'task_masters' AS tbl, created_at
    FROM task_masters WHERE created_at > NOW() + INTERVAL 1 MINUTE
    UNION ALL
    SELECT id, 'task_instances' AS tbl, created_at
    FROM task_instances WHERE created_at > NOW() + INTERVAL 1 MINUTE
    LIMIT 20
  `);
  var fcaRows = futureCreatedAt[0] || [];
  check(
    '999.632h — Future created_at timestamps',
    fcaRows.length + ' row(s) with future created_at\n' + fmtRows(fcaRows),
    fcaRows.length === 0
  );

  // 2i. Valid timestamps — updated_at should not be before created_at
  var badUpdatedAt = await db.raw(`
    SELECT id, 'task_masters' AS tbl, created_at, updated_at
    FROM task_masters WHERE updated_at < created_at
    UNION ALL
    SELECT id, 'task_instances' AS tbl, created_at, updated_at
    FROM task_instances WHERE updated_at < created_at
    LIMIT 20
  `);
  var buaRows = badUpdatedAt[0] || [];
  check(
    '999.632i — updated_at before created_at',
    buaRows.length + ' row(s) with updated_at < created_at\n' + fmtRows(buaRows),
    buaRows.length === 0
  );

  // 2j. placement_mode must be a valid value
  var invalidPlacementMode = await db.raw(`
    SELECT id, text, placement_mode FROM task_masters
    WHERE placement_mode IS NOT NULL
      AND placement_mode NOT IN ('reminder','all_day','fixed','time_window','time_blocks','anytime')
  `);
  var ipmRows = invalidPlacementMode[0] || [];
  check(
    '999.632j — task_masters.placement_mode enum values',
    ipmRows.length + ' row(s) with invalid placement_mode\n' + fmtRows(ipmRows),
    ipmRows.length === 0
  );

  // 2k. task_type must be valid
  var invalidTaskType = await db.raw(`
    SELECT id, text, task_type FROM task_masters
    WHERE task_type NOT IN ('task','recurring_template')
  `);
  var ittRows = invalidTaskType[0] || [];
  check(
    '999.632k — task_masters.task_type values',
    ittRows.length + ' row(s) with invalid task_type\n' + fmtRows(ittRows),
    ittRows.length === 0
  );

  // 2l. task_instances.task_type must be valid
  var invalidTiTaskType = await db.raw(`
    SELECT id, master_id, task_type FROM task_instances
    WHERE task_type NOT IN ('recurring_instance','split_chunk')
  `);
  var ititRows = invalidTiTaskType[0] || [];
  check(
    '999.632l — task_instances.task_type values',
    ititRows.length + ' row(s) with invalid task_type\n' + fmtRows(ititRows),
    ititRows.length === 0
  );
}

// ── 999.633 — Code Drift ────────────────────────────────────────────────────
async function checkCodeDrift() {
  console.log('\n=== 999.633 — Code Drift ===\n');

  // 3a. tasks_v view should expose expected columns
  var tasksVCols = await db.raw(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks_v'
    ORDER BY ORDINAL_POSITION
  `, [config.connection.database]);
  var tvcRows = tasksVCols[0] || [];

  // Core columns that tasks_v MUST expose
  var requiredViewCols = [
    'id', 'user_id', 'text', 'task_type', 'dur', 'pri', 'status',
    'project', 'date', 'day', 'time', 'scheduled_at', 'created_at', 'updated_at',
    'placement_mode', 'recurring', 'master_id', 'source_id',
    'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max'
  ];

  var actualColNames = tvcRows.map(function(r) { return r.COLUMN_NAME; });
  var missingCols = requiredViewCols.filter(function(c) {
    return actualColNames.indexOf(c) < 0;
  });

  check(
    '999.633a — tasks_v view exposes expected columns',
    missingCols.length > 0
      ? 'Missing columns: ' + missingCols.join(', ')
      : 'All ' + requiredViewCols.length + ' expected columns present (' + tvcRows.length + ' total)',
    missingCols.length === 0
  );

  // 3b. Check that CHECK constraints in DB match code expectations
  var checkConstraints = await db.raw(`
    SELECT CONSTRAINT_NAME, TABLE_NAME, CHECK_CLAUSE
    FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = ?
  `, [config.connection.database]);
  var ccRows = checkConstraints[0] || [];

  var expectedConstraints = [
    { name: 'chk_task_masters_pri', table: 'task_masters' },
    { name: 'chk_task_masters_weather_precip', table: 'task_masters' },
    { name: 'chk_task_masters_weather_cloud', table: 'task_masters' },
    { name: 'chk_task_instances_status', table: 'task_instances' },
    { name: 'chk_cal_history_status', table: 'cal_history' },
    { name: 'chk_cal_history_previous_status', table: 'cal_history' }
  ];

  var actualConstraintNames = ccRows.map(function(r) { return r.CONSTRAINT_NAME; });
  var missingConstraints = expectedConstraints.filter(function(ec) {
    return actualConstraintNames.indexOf(ec.name) < 0;
  });

  check(
    '999.633b — CHECK constraints match code expectations',
    missingConstraints.length > 0
      ? 'Missing constraints: ' + missingConstraints.map(function(m) { return m.name + ' (' + m.table + ')'; }).join(', ')
      : 'All ' + expectedConstraints.length + ' expected CHECK constraints present',
    missingConstraints.length === 0
  );

  // 3c. ENUM sets in DB match code constants
  // placement_mode enum values from code: reminder, all_day, fixed, time_window, time_blocks, anytime
  var placementModeEnum = await db.raw(`
    SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'task_masters' AND COLUMN_NAME = 'placement_mode'
  `, [config.connection.database]);
  var pmColType = placementModeEnum[0][0] ? placementModeEnum[0][0].COLUMN_TYPE : '';
  // Extract enum values from COLUMN_TYPE like "enum('reminder','all_day','fixed','time_window','time_blocks','anytime')"
  var pmMatch = pmColType.match(/^enum\((.*)\)$/);
  var pmDbValues = pmMatch ? pmMatch[1].split(',').map(function(s) { return s.replace(/^'|'$/g, ''); }) : [];

  var pmCodeValues = ['reminder', 'all_day', 'fixed', 'time_window', 'time_blocks', 'anytime'];
  var pmExtra = pmDbValues.filter(function(v) { return pmCodeValues.indexOf(v) < 0; });
  var pmMissing = pmCodeValues.filter(function(v) { return pmDbValues.indexOf(v) < 0; });

  var pmDrift = [];
  if (pmExtra.length > 0) pmDrift.push('Extra in DB: ' + pmExtra.join(', '));
  if (pmMissing.length > 0) pmDrift.push('Missing from DB: ' + pmMissing.join(', '));

  check(
    '999.633c — placement_mode ENUM matches code constants',
    pmDrift.length > 0 ? pmDrift.join('; ') : 'ENUM matches code (6 values)',
    pmDrift.length === 0
  );

  // 3d. Check that the tasks_v view definition is not stale (basic row count sanity)
  var viewCount = await db.raw('SELECT COUNT(*) AS cnt FROM tasks_v');
  var masterCount = await db.raw('SELECT COUNT(*) AS cnt FROM task_masters');
  var instanceCount = await db.raw('SELECT COUNT(*) AS cnt FROM task_instances');
  var vc = viewCount[0][0].cnt;
  var mc = masterCount[0][0].cnt;
  var ic = instanceCount[0][0].cnt;

  // tasks_v should have at least as many rows as task_masters (it unions masters + instances)
  check(
    '999.633d — tasks_v row count sanity (masters=' + mc + ', instances=' + ic + ', view=' + vc + ')',
    'tasks_v has ' + vc + ' rows (masters: ' + mc + ', instances: ' + ic + ')',
    vc >= mc
  );
}

// ── 999.634 — Lifecycle ─────────────────────────────────────────────────────
async function checkLifecycle() {
  console.log('\n=== 999.634 — Lifecycle ===\n');

  // 4a. Orphan pending instances (master_id IS NULL, status = '')
  var orphanPending = await db.raw(`
    SELECT id, master_id, status, scheduled_at, created_at
    FROM task_instances
    WHERE master_id IS NULL AND status = ''
    ORDER BY created_at DESC
    LIMIT 50
  `);
  var opRows = orphanPending[0] || [];
  check(
    '999.634a — Orphan pending instances (master_id=NULL, status="")',
    opRows.length + ' orphan pending instance(s)\n' + fmtRows(opRows),
    opRows.length === 0
  );

  // 4b. Stale schedule_queue rows (older than 1 hour, not yet processed)
  var staleQueue = await db.raw(`
    SELECT sq.user_id, sq.source, sq.created_at
    FROM schedule_queue sq
    WHERE sq.created_at < NOW() - INTERVAL 1 HOUR
    ORDER BY sq.created_at ASC
    LIMIT 50
  `);
  var sqRows = staleQueue[0] || [];
  check(
    '999.634b — Stale schedule_queue rows (>1 hour old)',
    sqRows.length + ' stale queue row(s)\n' + fmtRows(sqRows),
    sqRows.length === 0
  );

  // 4c. Stale task_write_queue rows (older than 1 hour)
  var staleWriteQ = await db.raw(`
    SELECT twq.user_id, twq.task_id, twq.operation, twq.created_at
    FROM task_write_queue twq
    WHERE twq.created_at < NOW() - INTERVAL 1 HOUR
    ORDER BY twq.created_at ASC
    LIMIT 50
  `);
  var swqRows = staleWriteQ[0] || [];
  check(
    '999.634c — Stale task_write_queue rows (>1 hour old)',
    swqRows.length + ' stale write-queue row(s)\n' + fmtRows(swqRows),
    swqRows.length === 0
  );

  // 4d. Recurring instances with no source_id (orphaned from template)
  var orphanRecurring = await db.raw(`
    SELECT ti.id, ti.master_id, ti.source_id, ti.text, ti.status
    FROM task_instances ti
    WHERE ti.task_type = 'recurring_instance'
      AND ti.source_id IS NULL
      AND ti.status = ''
    LIMIT 50
  `);
  var orRows = orphanRecurring[0] || [];
  check(
    '999.634d — Recurring instances with NULL source_id (orphaned)',
    orRows.length + ' orphan recurring instance(s)\n' + fmtRows(orRows),
    orRows.length === 0
  );

  // 4e. Instances referencing a master that is disabled/paused but instance is still pending
  var zombieInstances = await db.raw(`
    SELECT ti.id, ti.master_id, ti.text, ti.status AS inst_status, tm.status AS master_status
    FROM task_instances ti
    JOIN task_masters tm ON ti.master_id = tm.id
    WHERE tm.status IN ('pause', 'disabled')
      AND ti.status = ''
    LIMIT 50
  `);
  var ziRows = zombieInstances[0] || [];
  check(
    '999.634e — Pending instances under paused/disabled masters',
    ziRows.length + ' zombie instance(s)\n' + fmtRows(ziRows),
    ziRows.length === 0
  );

  // 4f. Duplicate (master_id, occurrence_ordinal, split_ordinal) — should be unique
  var duplicateOrdinals = await db.raw(`
    SELECT master_id, occurrence_ordinal, split_ordinal, COUNT(*) AS cnt
    FROM task_instances
    WHERE master_id IS NOT NULL
    GROUP BY master_id, occurrence_ordinal, split_ordinal
    HAVING cnt > 1
    LIMIT 20
  `);
  var doRows = duplicateOrdinals[0] || [];
  check(
    '999.634f — Duplicate (master_id, occurrence_ordinal, split_ordinal)',
    doRows.length + ' duplicate ordinal group(s)\n' + fmtRows(doRows),
    doRows.length === 0
  );

  // 4g. Instances with scheduled_at in the past but still pending (not yet missed)
  var pastDuePending = await db.raw(`
    SELECT ti.id, ti.master_id, ti.text, ti.scheduled_at, ti.status
    FROM task_instances ti
    WHERE ti.scheduled_at IS NOT NULL
      AND ti.scheduled_at < NOW() - INTERVAL 24 HOUR
      AND ti.status = ''
    ORDER BY ti.scheduled_at ASC
    LIMIT 50
  `);
  var pdpRows = pastDuePending[0] || [];
  check(
    '999.634g — Past-due pending instances (scheduled >24h ago, still pending)',
    pdpRows.length + ' past-due pending instance(s)\n' + fmtRows(pdpRows),
    pdpRows.length === 0
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('DB Integrity Harness (999.630-634)');
  console.log('Target: ' + config.connection.host + ':' + config.connection.port + '/' + config.connection.database);
  console.log('='.repeat(60));

  // Connection check
  try {
    await db.raw('SELECT 1 AS ok');
    console.log('✓ Connection OK\n');
  } catch (e) {
    console.error('✗ Cannot reach database: ' + e.message);
    console.error('  Ensure test-bed is running: cd test-bed && make up');
    process.exit(2);
  }

  await checkReferentialIntegrity();
  await checkDataQuality();
  await checkCodeDrift();
  await checkLifecycle();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY: ' + totalChecks + ' checks');
  console.log('  PASSED: ' + results.passed.length);
  console.log('  FAILED: ' + results.failed.length);

  if (results.failed.length > 0) {
    console.log('\nFAILED CHECKS:');
    results.failed.forEach(function(f) {
      console.log('  ✗ ' + f.name);
      console.log('    ' + f.detail.split('\n').join('\n    '));
    });
  }

  await db.destroy();
  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(function(e) {
  console.error('FATAL: ' + e.message);
  console.error(e.stack);
  db.destroy().catch(function() {});
  process.exit(2);
});
