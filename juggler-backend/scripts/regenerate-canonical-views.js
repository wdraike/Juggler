#!/usr/bin/env node
'use strict';

/**
 * regenerate-canonical-views.js — regenerate the canonical view SSOT
 * (999.1189) from a freshly-migrated TEST database.
 *
 * Writes BOTH generated artifacts in src/db/views/:
 *   canonical-views.sql   CREATE OR REPLACE SQL SECURITY <type> VIEW ...
 *                         (tasks_v first, then tasks_with_sync_v)
 *   view-columns.json     ordered projected-column lists (information_schema)
 *
 * Run this after ANY migration that changes the shape of tasks_v or
 * tasks_with_sync_v — tests/migrations/view-column-contract.test.js fails
 * until the SSOT matches what the migration chain produces.
 *
 * Usage (against a *_test DB on test-bed that has just run migrate:latest):
 *   DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test \
 *     node scripts/regenerate-canonical-views.js
 *
 * SAFETY: derive the definitions from the MIGRATION CHAIN only. Never run
 * this against dev (3308) or prod (3307) — prod's juggler DB is known to lag
 * knex migrations (memory: juggler-prod-migration-lag), so a prod-captured
 * definition would re-introduce the exact hand-copy landmine this SSOT
 * exists to kill. The guard below refuses anything that is not a test-bed
 * port with a `*_test` database name.
 */

var fs = require('fs');
var path = require('path');
var mysql = require('mysql2/promise');

var HOST = process.env.DB_HOST || '127.0.0.1';
var PORT = process.env.DB_PORT;
var USER = process.env.DB_USER;
var PASSWORD = process.env.DB_PASSWORD;
var DATABASE = process.env.DB_NAME;

// Same target policy as tests/helpers/jest.globalSetup.js (999.751): a real
// test target is the fixed test-bed instance (3407), the ephemeral pool band
// (3410-3417), or in-container 3306 — always with a `*_test` database name.
function assertSafeTarget() {
  var portOk = PORT === '3407' || PORT === '3306' || /^341[0-7]$/.test(String(PORT || ''));
  var nameOk = /_test$/.test(String(DATABASE || ''));
  if (portOk && nameOk && !process.env.CLOUD_SQL_CONNECTION_NAME) return;
  console.error(
    'REFUSING: regenerate the canonical views only from a freshly-migrated test-bed DB\n' +
    '  (DB_PORT=3407/3410-3417 and DB_NAME ending in _test; got DB_PORT=' + PORT +
    ', DB_NAME=' + DATABASE + ').\n' +
    '  Prod lags migrations — never capture view definitions from it.'
  );
  process.exit(1);
}

// Keep the SQL SECURITY clause (999.1096); drop only ALGORITHM/DEFINER,
// which embed environment-specific values.
function portableCreateOrReplace(createViewStmt) {
  return String(createViewStmt).replace(
    /^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY (\w+)\s+VIEW/i,
    'CREATE OR REPLACE SQL SECURITY $1 VIEW'
  );
}

async function main() {
  assertSafeTarget();
  if (!USER || !PASSWORD) {
    console.error('REFUSING: DB_USER and DB_PASSWORD must be set explicitly (no silent defaults).');
    process.exit(1);
  }

  var conn = await mysql.createConnection({
    host: HOST, port: Number(PORT), user: USER, password: PASSWORD, database: DATABASE
  });

  try {
    // Sanity: the source DB must be fully migrated, otherwise the captured
    // shape is an intermediate one.
    var pending = await conn.query(
      'SELECT COUNT(*) AS n FROM `knex_migrations`'
    );
    if (!pending[0][0] || pending[0][0].n < 1) {
      throw new Error('Source DB has no applied migrations — run migrate:latest first.');
    }

    var viewNames = ['tasks_v', 'tasks_with_sync_v'];
    var sqlOut = '';
    var columnsOut = {};

    for (var i = 0; i < viewNames.length; i++) {
      var name = viewNames[i];
      var createRows = await conn.query('SHOW CREATE VIEW `' + name + '`');
      sqlOut += portableCreateOrReplace(createRows[0][0]['Create View']) + ';\n';

      var colRows = await conn.query(
        'SELECT COLUMN_NAME AS col FROM information_schema.columns ' +
        'WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION',
        [name]
      );
      columnsOut[name] = colRows[0].map(function (r) { return r.col; });
      if (columnsOut[name].length === 0) {
        throw new Error('No columns found for ' + name + ' — is the DB migrated?');
      }
    }

    var viewsDir = path.join(__dirname, '../src/db/views');
    fs.writeFileSync(path.join(viewsDir, 'canonical-views.sql'), sqlOut);
    fs.writeFileSync(
      path.join(viewsDir, 'view-columns.json'),
      JSON.stringify(columnsOut, null, 2) + '\n'
    );
    console.log('Wrote src/db/views/canonical-views.sql (' + sqlOut.length + ' bytes)');
    console.log('Wrote src/db/views/view-columns.json (tasks_v: ' + columnsOut.tasks_v.length +
      ' cols, tasks_with_sync_v: ' + columnsOut.tasks_with_sync_v.length + ' cols)');
  } finally {
    await conn.end();
  }
}

main().catch(function (err) {
  console.error('regenerate-canonical-views failed:', err.message);
  process.exit(1);
});
