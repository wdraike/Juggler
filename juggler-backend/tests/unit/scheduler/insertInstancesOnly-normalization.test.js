/**
 * 999.4849: insertInstancesOnly must normalize view-shaped rows to the
 * task_instances physical schema before inserting.
 *
 * The row-build site in runSchedule.js (line ~1851) produces rows with:
 *   - source_id (tasks_v view alias, NOT a physical column on task_instances)
 *   - task_type (view-only UNION concept, NOT a physical column)
 *   - occurrence_ordinal: null (explicit NULL bypasses NOT NULL DEFAULT 1)
 *   - no created_by/updated_by (audit columns are NOT NULL per 999.1576)
 *
 * Without normalization, the raw insert fails at runtime with
 * "Unknown column 'source_id'" or "Field 'created_by' doesn't have a default value".
 */
'use strict';

process.env.NODE_ENV = 'test';

const KnexScheduleRepository = require('../../../src/slices/scheduler/adapters/KnexScheduleRepository');

function makeMockDb() {
  var insertedRows = null;
  var mockInsert = jest.fn(function(rows) {
    insertedRows = rows;
    return Promise.resolve();
  });
  var mockTable = jest.fn(function() { return { insert: mockInsert }; });
  // KnexScheduleRepository uses this.db('task_instances').insert(rows)
  var db = jest.fn(function() { return mockTable(); });
  db._insertedRows = function() { return insertedRows; };
  db._mockInsert = mockInsert;
  return db;
}

describe('999.4849: KnexScheduleRepository.insertInstancesOnly row normalization', () => {
  test('maps source_id to master_id (view alias -> physical column)', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', user_id: 'u1', dur: 30, split_ordinal: 2, split_total: 2 }
    ]);
    var rows = db._insertedRows();
    expect(rows[0].master_id).toBe('t1');
    expect(rows[0].source_id).toBeUndefined();
  });

  test('deletes task_type (view-only, not a physical column)', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', user_id: 'u1', task_type: 'task', dur: 30 }
    ]);
    var rows = db._insertedRows();
    expect(rows[0].task_type).toBeUndefined();
  });

  test('defaults occurrence_ordinal to 1 when null (NOT NULL DEFAULT 1)', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', user_id: 'u1', occurrence_ordinal: null, dur: 30 }
    ]);
    var rows = db._insertedRows();
    expect(rows[0].occurrence_ordinal).toBe(1);
  });

  test('defaults occurrence_ordinal to 1 when undefined', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', user_id: 'u1', dur: 30 }
    ]);
    var rows = db._insertedRows();
    expect(rows[0].occurrence_ordinal).toBe(1);
  });

  test('stamps audit attribution (created_by/updated_by) via stampInsert', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', user_id: 'u1', dur: 30 }
    ]);
    var rows = db._insertedRows();
    // stampInsert adds created_by/updated_by — the exact value depends on the
    // audit-context actor, but the keys must be present (NOT NULL columns).
    expect(rows[0].created_by).toBeDefined();
    expect(rows[0].updated_by).toBeDefined();
  });

  test('does not overwrite master_id if already present', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([
      { id: 't1-2', source_id: 't1', master_id: 't1-master', user_id: 'u1', dur: 30 }
    ]);
    var rows = db._insertedRows();
    expect(rows[0].master_id).toBe('t1-master');
    expect(rows[0].source_id).toBeUndefined();
  });

  test('no-ops on empty input', async () => {
    var db = makeMockDb();
    var repo = new KnexScheduleRepository({ db: db });
    await repo.insertInstancesOnly([]);
    expect(db._mockInsert).not.toHaveBeenCalled();
    await repo.insertInstancesOnly(null);
    expect(db._mockInsert).not.toHaveBeenCalled();
  });
});