/**
 * Per-test-file teardown — registered via jest `setupFilesAfterEnv`.
 *
 * Test-isolation defect: src/scheduler/scheduleQueue.js can have a live poll
 * loop (setInterval pollOnce, POLL_MS) and/or a debounce timer running. When a
 * suite that started the loop tears down, a stray tick can fire AFTER teardown
 * and call getQueueBackend().isCloudTasks() against a registry whose backend has
 * been reset/mocked away by the next suite — surfacing as
 * "backend.isCloudTasks is not a function" and cross-suite bleed.
 *
 * This module runs once per test FILE (setupFilesAfterEnv loads in the file's
 * sandbox after the framework is installed). We stop the real poll loop after
 * every test and again after the whole file, so no timer outlives the suite.
 * stopPollLoop() is idempotent (null-guards POLL_LOOP_INSTANCE), so calling it
 * when no loop is running is a harmless no-op.
 *
 * NOTE: this is NOT the (non-existent) `setupFilesAfterEach` option — Jest 29
 * has no such key. `setupFilesAfterEnv` + a global afterEach/afterAll is the
 * supported mechanism for after-each-file teardown.
 */

// Lazily require inside the hook so we observe whatever module instance the
// suite is using (real or jest.mock'd / reset) and never pull scheduleQueue +
// its deps into files that don't otherwise load it. All failures are swallowed:
// teardown must never turn a green suite red.
function stopLoop() {
  try {
    var scheduleQueue = require('../src/scheduler/scheduleQueue');
    // Prefer the full reset (999.869): besides stopping the poll loop it force-
    // clears leaked claim-heartbeat intervals, drops the cached _queueBackend (so
    // a neighbour's jest.resetModules can't leave a stale cross-suite binding),
    // and clears the in-memory dirty/running/rate-limit maps — so no timer or
    // module state outlives this file. Fall back to stopPollLoop on older builds.
    if (scheduleQueue && typeof scheduleQueue._resetForTests === 'function') {
      scheduleQueue._resetForTests();
    } else if (scheduleQueue && typeof scheduleQueue.stopPollLoop === 'function') {
      scheduleQueue.stopPollLoop();
    }
  } catch (e) {
    /* no-op: module not present, mocked away, or reset — nothing to stop */
  }
  // src/lib/usage-reporter.js runs a background setInterval(flush, FLUSH_INTERVAL)
  // + a beforeExit listener; a stray flush() after teardown dereferences a gone
  // logger binding → fatal crash that aborts the whole runInBand suite. Stop it.
  try {
    var usageReporter = require('../src/lib/usage-reporter');
    if (usageReporter && typeof usageReporter._stopForTests === 'function') {
      usageReporter._stopForTests();
    }
  } catch (e) {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Per-test-FILE DB isolation (cross-suite row-pollution fix).
//
// All DB-backed suites share one test database (juggler_test on test-bed 3407).
// A suite that leaves rows behind (or that another suite's seed left behind)
// pollutes entity-count / active-count / "expected N got M" assertions in later
// suites — so a suite that passes in isolation fails in the combined run.
//
// Fix: after the whole FILE runs, TRUNCATE the volatile data tables so the next
// file starts from a clean slate. The schema (and knex_migrations) is left
// intact — only data rows are cleared.
//
// We build a DEDICATED knex connection straight from process.env rather than
// require('../src/db'), because many suites jest.mock('../src/db') — requiring
// it here would observe a mock with no real connection. The connection is
// created lazily on first teardown, reused across the file, and destroyed in a
// final afterAll. All failures are swallowed: teardown must never redden a
// green suite.
// ---------------------------------------------------------------------------

// Upper bound for the per-file truncate/schema-restore afterAll hook (999.995).
// The default jest hook deadline is 5000ms, which the 24-table TRUNCATE + view
// DDL restore + migration re-apply can exceed against a shared/contended 3407,
// producing a false "Test Suite failed to run" on a suite whose assertions all
// passed. 30s is a generous ceiling that resolves as soon as teardown finishes.
var TEARDOWN_TIMEOUT_MS = 30000;

// Volatile data tables truncated between files. NEVER includes
// knex_migrations / knex_migrations_lock (schema/migration ledger).
var TRUNCATE_TABLES = [
  'task_instances',
  'task_masters',
  'projects',
  'schedule_queue',
  'task_write_queue',
  'cal_sync_ledger',
  'cal_history',
  'sync_history',
  'sync_locks',
  'user_calendars',
  'user_config',
  'locations',
  'tools',
  'users',
  'ai_command_log',
  'ai_usage_outbox',
  'feature_events',
  'impersonation_log',
  'plan_usage',
  'scheduler_sessions',
  'weather_cache',
  'oauth_auth_codes',
  'oauth_clients',
  'oauth_code_nonces'
];

function isTruncTarget() {
  var port = parseInt(process.env.DB_PORT, 10);
  var name = process.env.DB_NAME || '';
  // SAFETY GUARD: only ever touch a *_test database on the test-bed port
  // (3407). This makes it impossible to truncate dev (3308) or prod (3307)
  // even if env is misconfigured.
  return /_test$/.test(name) && port === 3407;
}

// Canonical HEAD view DDL, captured once from a pristine `make init-juggler` into
// tests/helpers/canonical-views-restore.sql (one `CREATE OR REPLACE VIEW ...;` per
// line, tasks_v before its dependent tasks_with_sync_v). Loaded lazily + cached.
//
// ⚠ MUST BE REGENERATED whenever a migration changes tasks_v/tasks_with_sync_v's
// shape (add/remove/rename a projected column) — otherwise THIS restore silently
// reverts the new shape after every test file, for the rest of the suite's
// lifetime, masking the change everywhere except a test that runs completely
// alone. This is exactly how `rolling_anchor` went undetected-missing from both
// views for weeks (999.1094) — this snapshot never had it either, until the
// 999.1091/999.1094 regeneration. Regenerate via (run against a freshly
// migrate:latest'd *_test DB):
//   node -e "const mysql=require('mysql2/promise');(async()=>{const c=await
//     mysql.createConnection({host:'127.0.0.1',port:3407,user:'root',
//     password:'rootpass',database:'<your _test db>'});const v=(await
//     c.query('SHOW CREATE VIEW tasks_v'))[0];const s=(await c.query(
//     'SHOW CREATE VIEW tasks_with_sync_v'))[0];const p=x=>String(x).replace(
//     /^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY
//     (\w+)\s+VIEW/i,'CREATE OR REPLACE SQL SECURITY $1 VIEW');require('fs')
//     .writeFileSync('tests/helpers/canonical-views-restore.sql',
//     p(v[0]['Create View'])+';\n'+p(s[0]['Create View'])+';\n');await
//     c.end();})();"
var _canonicalViewStmts = null;
function loadCanonicalViewStmts() {
  if (_canonicalViewStmts !== null) return _canonicalViewStmts;
  _canonicalViewStmts = [];
  try {
    var fs = require('fs');
    var path = require('path');
    var sql = fs.readFileSync(path.join(__dirname, 'canonical-views-restore.sql'), 'utf8');
    _canonicalViewStmts = sql
      .split(/;\s*\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return /CREATE\s+OR\s+REPLACE/i.test(s); });
  } catch (e) {
    _canonicalViewStmts = [];
  }
  return _canonicalViewStmts;
}

async function restoreCanonicalViews(db) {
  var stmts = loadCanonicalViewStmts();
  for (var i = 0; i < stmts.length; i++) {
    await db.raw(stmts[i]); // tasks_v first, then tasks_with_sync_v (depends on it)
  }
}

async function truncateVolatileTables() {
  if (!isTruncTarget()) return;

  // Build a single-use connection (single pooled conn) and DESTROY it before
  // returning. jest re-evaluates this setupFilesAfterEnv module once per test
  // FILE, so a connection that outlives the file would leak — across hundreds
  // of files that exhausts MySQL's max_connections ("Too many connections").
  // Open → truncate → close keeps exactly one transient connection per file.
  var db = null;
  try {
    var knexLib = require('knex');
    db = knexLib({
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT, 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        timezone: '+00:00',
        dateStrings: true
      },
      pool: { min: 0, max: 1 }
    });
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');
    for (var i = 0; i < TRUNCATE_TABLES.length; i++) {
      try {
        await db.raw('TRUNCATE TABLE ??', [TRUNCATE_TABLES[i]]);
      } catch (e) {
        /* table may not exist in this schema version — skip */
      }
    }
    try {
      await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    } catch (e) {
      /* no-op */
    }
    // ---- SCHEMA restore (cross-suite SCHEMA-pollution fix) -------------------
    // Row truncation handles data bleed; but migration/DDL tests that DROP or
    // recreate the shared VIEWS (tasks_v / tasks_with_sync_v) or NARROW the
    // status CHECK constraints leave the schema in a non-HEAD state that poisons
    // later files (a different subset flakes each run). Restore HEAD after every
    // file: (1) recreate both views from the canonical snapshot captured from a
    // pristine init; (2) re-apply the widen-status-constraint migration (DROP+ADD,
    // idempotent) so both status enums carry the full HEAD superset incl. cancelled.
    try {
      await restoreCanonicalViews(db);
    } catch (e) { /* no-op: teardown must not redden a suite */ }
    try {
      var widen = require('../src/db/migrations/20260624160000_widen_task_masters_status_constraint.js');
      if (widen && typeof widen.up === 'function') await widen.up(db);
    } catch (e) { /* no-op */ }
  } catch (e) {
    /* no-op: teardown must never redden a suite */
  } finally {
    if (db) {
      try {
        await db.destroy();
      } catch (e) {
        /* no-op */
      }
    }
  }
}

if (typeof afterEach === 'function') {
  afterEach(function () {
    stopLoop();
  });
}

if (typeof afterAll === 'function') {
  // First afterAll: stop background loops.
  afterAll(function () {
    stopLoop();
  });

  // Second afterAll: truncate volatile data so the next FILE starts clean.
  // Registered after stopLoop's afterAll so it runs after it (jest runs
  // same-scope afterAll hooks in registration order... actually LIFO — but
  // order between these two is immaterial: stopLoop touches timers, this
  // touches the DB).
  //
  // Explicit teardown timeout (999.995): this hook opens a fresh knex conn and
  // does 24 TRUNCATEs + a canonical-view DDL restore + a migration re-apply.
  // Against a shared/contended test-bed MySQL (3407) that legitimately exceeds
  // jest's default 5000ms afterAll deadline → "Test Suite failed to run" even
  // though the file's own assertions all passed (a false-red seen on untouched
  // baseline files when run standalone). A generous teardown deadline removes
  // the false-red without slowing the happy path — the hook resolves as soon as
  // the truncate completes; the timeout is only an upper bound, not a wait. It
  // does NOT change test isolation (same tables truncated, same schema restore).
  afterAll(async function () {
    await truncateVolatileTables();
  }, TEARDOWN_TIMEOUT_MS);
}
