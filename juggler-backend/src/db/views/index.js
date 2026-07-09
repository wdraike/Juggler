'use strict';

/**
 * src/db/views — canonical SSOT for the CURRENT shape of the shared read
 * views `tasks_v` and `tasks_with_sync_v` (999.1189).
 *
 * Why this exists: the "tasks_v silent column drop" failure mode recurred
 * FIVE times (source_id, weather cols, end_date, unplaced_reason,
 * rolling_anchor) because 33+ migrations recreate the view and nothing
 * pinned the expected final shape. Two artifacts live here, both GENERATED
 * from a freshly-migrated test-bed database (i.e. derived from the
 * migration chain — NEVER hand-copied from prod, which lags migrations):
 *
 *   canonical-views.sql   full CREATE OR REPLACE statements for both views
 *                         (tasks_v first — tasks_with_sync_v depends on it)
 *   view-columns.json     ordered projected-column lists for both views,
 *                         captured from information_schema at generation time
 *
 * Regenerate BOTH with scripts/regenerate-canonical-views.js after any
 * migration that changes either view's shape. The column-contract test
 * (tests/migrations/view-column-contract.test.js) fails until the SSOT and
 * the migrated schema agree — that test is the guard that prevents the
 * sixth silent column drop, and it also keeps the per-test-file view
 * restore in tests/helpers/afterEachFile.js from silently reverting new
 * columns (the 999.1094 trap).
 *
 * ⚠ Migrations must NOT call buildTasksVSql()/applyCanonicalViews() to
 * recreate the views: on a fresh replay of the chain, an older migration
 * applying the CURRENT canonical definition would reference table columns
 * that do not exist yet at that point in the chain and the CREATE would
 * fail (or worse, mask the chain's real intermediate shapes). Migrations
 * keep string-patching the LIVE definition via src/db/migration-helpers.js;
 * this module is the source of truth for what the chain must END UP
 * producing.
 */

var fs = require('fs');
var path = require('path');

var SQL_PATH = path.join(__dirname, 'canonical-views.sql');
var COLUMNS_PATH = path.join(__dirname, 'view-columns.json');

var VIEW_NAMES = ['tasks_v', 'tasks_with_sync_v'];

var _stmts = null;
function loadStatements() {
  if (_stmts) return _stmts;
  var sql = fs.readFileSync(SQL_PATH, 'utf8');
  var stmts = sql
    .split(/;\s*\n/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^CREATE\s+OR\s+REPLACE/i.test(s); });
  var byName = {};
  stmts.forEach(function (stmt) {
    var m = stmt.match(/VIEW\s+`([^`]+)`/i);
    if (!m) throw new Error('canonical-views.sql: statement without a VIEW `name`: ' + stmt.slice(0, 80));
    byName[m[1]] = stmt;
  });
  VIEW_NAMES.forEach(function (name) {
    if (!byName[name]) {
      throw new Error('canonical-views.sql is missing the `' + name + '` definition — regenerate with scripts/regenerate-canonical-views.js');
    }
  });
  _stmts = byName;
  return _stmts;
}

var _columns = null;
function loadColumns() {
  if (_columns) return _columns;
  var parsed = JSON.parse(fs.readFileSync(COLUMNS_PATH, 'utf8'));
  VIEW_NAMES.forEach(function (name) {
    if (!Array.isArray(parsed[name]) || parsed[name].length === 0) {
      throw new Error('view-columns.json is missing columns for `' + name + '` — regenerate with scripts/regenerate-canonical-views.js');
    }
  });
  _columns = parsed;
  return _columns;
}

/** Canonical CREATE OR REPLACE statement for tasks_v. */
function buildTasksVSql() {
  return loadStatements().tasks_v;
}

/** Canonical CREATE OR REPLACE statement for tasks_with_sync_v. */
function buildTasksWithSyncVSql() {
  return loadStatements().tasks_with_sync_v;
}

/**
 * Both canonical statements in dependency order (tasks_v first).
 * Used by tests/helpers/afterEachFile.js to restore HEAD view shape after
 * each test file.
 */
function canonicalViewStatements() {
  return [buildTasksVSql(), buildTasksWithSyncVSql()];
}

/**
 * Ordered projected-column list for a canonical view.
 * @param {'tasks_v'|'tasks_with_sync_v'} viewName
 * @returns {string[]}
 */
function viewColumns(viewName) {
  var cols = loadColumns()[viewName];
  if (!cols) throw new Error('Unknown canonical view: ' + viewName);
  return cols.slice();
}

module.exports = {
  VIEW_NAMES: VIEW_NAMES.slice(),
  buildTasksVSql: buildTasksVSql,
  buildTasksWithSyncVSql: buildTasksWithSyncVSql,
  canonicalViewStatements: canonicalViewStatements,
  viewColumns: viewColumns
};
