'use strict';

/**
 * view-column-contract.test.js — the tasks_v / tasks_with_sync_v column
 * contract guard (999.1189).
 *
 * The "silent column drop" failure mode recurred FIVE times (source_id,
 * weather cols, end_date, unplaced_reason, rolling_anchor): a migration
 * recreated one of the shared read views from a stale definition and a
 * projected column vanished with no test noticing. This file is the guard
 * that prevents the sixth: it asserts that the LIVE, migrated database
 * exposes EXACTLY the column set (and definition body) recorded in the
 * canonical SSOT at src/db/views/ — which is itself generated from a
 * freshly-migrated test DB by scripts/regenerate-canonical-views.js.
 *
 * How it fires:
 *  - A migration recreates a view and DROPS a column  → "missing" mismatch.
 *  - A migration ADDS/renames a projected column but the author forgot to
 *    regenerate the SSOT → "unexpected" mismatch. Regenerating the SSOT also
 *    updates the per-test-file view restore (tests/helpers/afterEachFile.js
 *    loads the same SSOT), killing the 999.1094 stale-snapshot trap where
 *    the restore silently reverted new view shapes for weeks.
 *
 * On mismatch: if the migration is wrong, fix the migration; if the SSOT is
 * stale, run (against a freshly migrate:latest'd *_test DB):
 *   DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=<db>_test \
 *     node scripts/regenerate-canonical-views.js
 *
 * Note: on a long-lived shared juggler_test that was poisoned by the OLD
 * stale restore snapshot (pre-SSOT), the first run of this file can fail
 * until any test file's teardown re-applies the (now correct) canonical
 * restore. Fresh test-bed provisioning (`make up` → migrate) is always
 * deterministic — that is the environment this guard is specified against.
 */

jest.setTimeout(30000);

var { assertDbAvailable } = require('../helpers/requireDB');
var db = require('../../src/db');
var viewDefs = require('../../src/db/views');
var { portableViewSql } = require('../../src/db/migration-helpers');

async function liveColumns(viewName) {
  var rows = await db.raw(
    'SELECT COLUMN_NAME AS col FROM information_schema.columns ' +
    'WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION',
    [viewName]
  );
  return rows[0].map(function (r) { return r.col; });
}

// Everything from 'VIEW `' onward — drops CREATE [OR REPLACE] / SQL SECURITY
// framing differences between SHOW CREATE VIEW output and the stored SSOT.
function definitionBody(stmt) {
  var idx = stmt.indexOf('VIEW `');
  if (idx === -1) throw new Error('Not a CREATE VIEW statement: ' + stmt.slice(0, 80));
  return stmt.slice(idx);
}

function assertColumnContract(viewName, actual, expected) {
  var missing = expected.filter(function (c) { return actual.indexOf(c) === -1; });
  var unexpected = actual.filter(function (c) { return expected.indexOf(c) === -1; });
  if (missing.length || unexpected.length) {
    throw new Error(
      '[999.1189] ' + viewName + ' column contract violated.\n' +
      (missing.length ? '  MISSING (a migration dropped or the DB predates them): ' + missing.join(', ') + '\n' : '') +
      (unexpected.length ? '  UNEXPECTED (added without regenerating the SSOT): ' + unexpected.join(', ') + '\n' : '') +
      '  If the migration is wrong, fix the migration. If the SSOT is stale,\n' +
      '  regenerate it: node scripts/regenerate-canonical-views.js (see file header).'
    );
  }
  // Same set — also pin the projection order (SELECT * consumers see it).
  expect(actual).toEqual(expected);
}

describe('tasks_v / tasks_with_sync_v column contract (999.1189)', function () {
  test('tasks_v exposes exactly the canonical column set', async function () {
    await assertDbAvailable();
    assertColumnContract('tasks_v', await liveColumns('tasks_v'), viewDefs.viewColumns('tasks_v'));
  });

  test('tasks_with_sync_v exposes exactly the canonical column set', async function () {
    await assertDbAvailable();
    assertColumnContract(
      'tasks_with_sync_v',
      await liveColumns('tasks_with_sync_v'),
      viewDefs.viewColumns('tasks_with_sync_v')
    );
  });

  test('live view definitions match the canonical SSOT bodies', async function () {
    await assertDbAvailable();
    var checks = [
      { name: 'tasks_v', canonical: viewDefs.buildTasksVSql() },
      { name: 'tasks_with_sync_v', canonical: viewDefs.buildTasksWithSyncVSql() }
    ];
    for (var i = 0; i < checks.length; i++) {
      var rows = await db.raw('SHOW CREATE VIEW `' + checks[i].name + '`');
      var live = portableViewSql(rows[0][0]['Create View']);
      expect(definitionBody(live)).toBe(definitionBody(checks[i].canonical));
    }
  });

  test('SSOT internal consistency: canonical SQL and column list agree on column count', function () {
    // Cheap no-DB sanity: every projected column name must appear as an
    // `AS `col`` alias in the canonical statement (catches a half-regenerated
    // SSOT where only one of the two files was updated).
    viewDefs.VIEW_NAMES.forEach(function (name) {
      var stmt = name === 'tasks_v' ? viewDefs.buildTasksVSql() : viewDefs.buildTasksWithSyncVSql();
      viewDefs.viewColumns(name).forEach(function (col) {
        expect(stmt).toContain('AS `' + col + '`');
      });
    });
  });
});
