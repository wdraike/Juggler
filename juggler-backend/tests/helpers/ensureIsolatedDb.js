/**
 * ensureIsolatedDb — self-provisioning for test files that use isolated DB names.
 *
 * Test files that set process.env.DB_NAME to a non-juggler_test name (e.g.
 * juggler_lifecycle844_test) need to CREATE that database and run migrations
 * before requiring src/db (which caches its knex singleton on first require).
 * jest's globalSetup only provisions juggler_test (from .env.test), so these
 * isolated DBs are absent on a fresh test-bed and the tests red out.
 *
 * Usage (MUST be called before any require of ../../src/db):
 *   process.env.DB_NAME = 'juggler_my_test';
 *   var { ensureIsolatedDb } = require('../helpers/ensureIsolatedDb');
 *   beforeAll(async () => { await ensureIsolatedDb(); });
 *   var db = require('../../src/db');  // safe now — DB exists + migrated
 *
 * Or for files that need db assigned dynamically:
 *   var db;
 *   beforeAll(async () => { db = await ensureIsolatedDb(); });
 *
 * Traceability: 999.1052 (JUGGLER-TESTDB-PROVISIONING-GAP).
 * Pattern origin: overdue-split-persistence-e3.test.js (leg juggy4).
 */
'use strict';

var path = require('path');
var knexLib = require('knex');

// Load .env.test for DB_HOST/DB_PORT/DB_USER/DB_PASSWORD (same as jest.setupEnv.js).
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

/**
 * Creates the isolated DB (if absent) and runs migrations against it.
 * Returns the src/db singleton (cached after first require).
 *
 * MUST be called after process.env.DB_NAME is set and before any other
 * module that transitively requires ../../src/db.
 */
async function ensureIsolatedDb() {
  var bootstrap = knexLib({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || '3407'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpass'
      // No `database` — connects to the server, not a specific schema.
    }
  });
  try {
    await bootstrap.raw('SELECT 1');
  } catch (e) {
    await bootstrap.destroy();
    throw new Error(
      'TEST-FR-001: test-bed MySQL not reachable at ' +
      (process.env.DB_HOST || '127.0.0.1') + ':' + (process.env.DB_PORT || '3407') +
      '. Run: cd test-bed && make up'
    );
  }
  await bootstrap.raw(
    'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [process.env.DB_NAME]
  );
  await bootstrap.destroy();

  // Now require src/db (caches singleton against the now-existing DB) + migrate.
  var db = require('../../src/db');
  await db.raw('SELECT 1');
  await db.migrate.latest();
  return db;
}

/**
 * Creates the isolated DB (if absent) WITHOUT requiring src/db or running
 * migrations. For migration test files that manage their own knex instance
 * and control migrate.up()/down() directly.
 *
 * MUST be called after process.env.DB_NAME is set.
 */
async function ensureIsolatedDbExists() {
  var bootstrap = knexLib({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || '3407'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpass'
    }
  });
  try {
    await bootstrap.raw('SELECT 1');
  } catch (e) {
    await bootstrap.destroy();
    throw new Error(
      'TEST-FR-001: test-bed MySQL not reachable at ' +
      (process.env.DB_HOST || '127.0.0.1') + ':' + (process.env.DB_PORT || '3407') +
      '. Run: cd test-bed && make up'
    );
  }
  await bootstrap.raw(
    'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [process.env.DB_NAME]
  );
  await bootstrap.destroy();
}

module.exports = { ensureIsolatedDb: ensureIsolatedDb, ensureIsolatedDbExists: ensureIsolatedDbExists };