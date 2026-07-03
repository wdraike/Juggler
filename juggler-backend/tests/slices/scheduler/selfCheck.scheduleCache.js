#!/usr/bin/env node
/**
 * Self-check demo for H7 (999.1020) — schedule_cache port methods.
 *
 * Verifies the upsert + read semantics of both adapters against the
 * ScheduleRepositoryPort contract, without a live DB:
 *   1. InMemoryScheduleRepository: upsert then get round-trip; overwrite path.
 *   2. KnexScheduleRepository: upsert-then-update path with a fake knex handle
 *      that mirrors the real query shape (where + first / insert / update).
 *   3. Port contract: SCHEDULE_REPOSITORY_PORT_METHODS includes both names.
 *
 * Run: node juggler/juggler-backend/tests/slices/scheduler/selfCheck.scheduleCache.js
 */
'use strict';

var assert = require('assert');

var ScheduleRepositoryPort = require('../../../src/slices/scheduler/domain/ports/ScheduleRepositoryPort');
var InMemoryScheduleRepository = require('../../../src/slices/scheduler/adapters/InMemoryScheduleRepository');
var KnexScheduleRepository = require('../../../src/slices/scheduler/adapters/KnexScheduleRepository');

async function main() {
  // --- 1. Port contract includes both method names ---
  var methods = ScheduleRepositoryPort.SCHEDULE_REPOSITORY_PORT_METHODS;
  assert(methods.includes('getScheduleCache'), 'SCHEDULE_REPOSITORY_PORT_METHODS must include getScheduleCache');
  assert(methods.includes('upsertScheduleCache'), 'SCHEDULE_REPOSITORY_PORT_METHODS must include upsertScheduleCache');

  // --- 2. InMemoryScheduleRepository round-trip ---
  var mem = new InMemoryScheduleRepository();
  var before = await mem.getScheduleCache('u-1');
  assert(before === null, 'getScheduleCache returns null when empty');

  await mem.upsertScheduleCache('u-1', '{"dayPlacements":{}}');
  var row = await mem.getScheduleCache('u-1');
  assert(row, 'getScheduleCache returns the row after upsert');
  assert.strictEqual(row.config_key, 'schedule_cache');
  assert.strictEqual(row.config_value, '{"dayPlacements":{}}');

  // Overwrite path — upsert on existing key updates, not duplicates
  await mem.upsertScheduleCache('u-1', '{"dayPlacements":{"2026-07-03":[]}}');
  var row2 = await mem.getScheduleCache('u-1');
  assert.strictEqual(row2.config_value, '{"dayPlacements":{"2026-07-03":[]}}', 'upsert overwrites existing');

  // Tenant isolation
  var other = await mem.getScheduleCache('u-2');
  assert(other === null, 'getScheduleCache is tenant-scoped');

  // --- 3. KnexScheduleRepository with a fake knex handle ---
  // The fake mirrors the real query shape: a chainable builder that records the
  // table, the where-clause, and supports .first() / .insert() / .update().
  var store = {}; // { 'user_config|u-1|schedule_cache': row }
  var calls = [];

  function keyOf(userId) { return 'user_config|' + userId + '|schedule_cache'; }

  function fakeTable() {
    var state = { table: null, clause: {} };
    var chain = {
      where: function (cond) { Object.assign(state.clause, cond); return chain; },
      first: function () {
        calls.push({ op: 'first', table: state.table, clause: state.clause });
        var k = keyOf(state.clause.user_id);
        return Promise.resolve(store[k] ? Object.assign({}, store[k]) : null);
      },
      update: function (patch) {
        calls.push({ op: 'update', table: state.table, clause: state.clause, patch: patch });
        var k = keyOf(state.clause.user_id);
        store[k] = Object.assign({}, store[k], patch);
        return Promise.resolve(1);
      },
      insert: function (row) {
        calls.push({ op: 'insert', table: state.table, clause: state.clause, row: row });
        var k = keyOf(row.user_id);
        store[k] = Object.assign({}, row);
        return Promise.resolve([1]);
      }
    };
    function db(table) { state.table = table; return chain; }
    return db;
  }

  var db = fakeTable();
  var knex = new KnexScheduleRepository({ db: db, clock: { now: function () { return new Date(); } } });

  // getScheduleCache on empty → null
  var knexBefore = await knex.getScheduleCache('u-1');
  assert(knexBefore === null, 'Knex getScheduleCache returns null when no row');

  // upsert insert path
  await knex.upsertScheduleCache('u-1', '{"v":1}');
  assert(store[keyOf('u-1')], 'Knex upsert inserted a row');
  assert.strictEqual(store[keyOf('u-1')].config_value, '{"v":1}');
  assert.strictEqual(store[keyOf('u-1')].config_key, 'schedule_cache');

  // upsert update path (row now exists)
  await knex.upsertScheduleCache('u-1', '{"v":2}');
  assert.strictEqual(store[keyOf('u-1')].config_value, '{"v":2}', 'Knex upsert updated existing row');

  // getScheduleCache returns the row
  var knexRow = await knex.getScheduleCache('u-1');
  assert(knexRow, 'Knex getScheduleCache returns the row');
  assert.strictEqual(knexRow.config_value, '{"v":2}');

  // Verify the query shape: first() used config_key schedule_cache
  var firstCall = calls.find(function (c) { return c.op === 'first'; });
  assert(firstCall, 'upsert called first() to check existing');
  assert.strictEqual(firstCall.clause.config_key, 'schedule_cache', 'where clause uses config_key schedule_cache');

  var insertCall = calls.find(function (c) { return c.op === 'insert'; });
  assert(insertCall, 'upsert did an insert for the new row');
  assert.strictEqual(insertCall.row.config_key, 'schedule_cache');

  var updateCall = calls.find(function (c) { return c.op === 'update'; });
  assert(updateCall, 'upsert did an update for the existing row');
  assert.strictEqual(updateCall.clause.config_key, 'schedule_cache');

  console.log('✅ All self-check assertions passed for schedule_cache port methods (H7 999.1020)');
}

main().catch(function (err) { console.error('❌ Self-check FAILED:', err); process.exit(1); });