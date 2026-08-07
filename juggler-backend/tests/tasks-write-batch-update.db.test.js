'use strict';

/**
 * tasks-write-batch-update.db.test.js — 999.5287, real-DB golden master.
 *
 * tests/unit/tasks-write-batch-update.test.js proves field-routing/grouping
 * mechanics against a capturing fake knex; this file proves the raw SQL the
 * batch path builds (CASE `id` WHEN ? THEN ? ... END) actually EXECUTES
 * correctly against real MySQL and lands the SAME rows real
 * updateTaskById() calls would — the fake db cannot catch a SQL syntax
 * error or a MySQL-specific binding mismatch.
 *
 * Method: seed two IDENTICAL sets of tasks (SEQ / BATCH). Apply the same
 * logical update payloads to SEQ via N sequential updateTaskById() calls
 * (mirroring the OLD calendar/facade.js write-phase loop) and to BATCH via
 * ONE updateTaskByIdBatch() call. Assert every column matches between the
 * corresponding SEQ/BATCH row (excluding id and updated_at, which is a
 * DB-computed NOW() whose value can legitimately differ by the wall-clock
 * gap between the two runs — checked separately for recency only).
 *
 * Requires: test-bed MySQL @3407.
 */

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var { runWithActor, stampInsert } = require('../src/lib/audit-context');
var tasksWrite = require('../src/lib/tasks-write');

var USER_ID = 'tw-batch-update-dbfx-001';

function taskRow(id, overrides) {
  return Object.assign({
    id: id,
    user_id: USER_ID,
    task_type: 'task',
    // Fixed (not id-derived) so a SEQ row and its corresponding BATCH row
    // start byte-identical except for id — any post-update divergence in
    // `normalize()`'s comparison is then attributable ONLY to the update
    // path, not to fixture seeding.
    text: 'Seed task',
    scheduled_at: new Date('2026-02-01T15:00:00Z'),
    dur: 30,
    pri: 'P3',
    status: '',
    when: 'morning',
    recurring: 0,
    created_at: new Date('2026-01-01T00:00:00Z')
  }, overrides || {});
}

async function clearFixtures() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

// Strip fields that are legitimately allowed to differ: id and master_id
// (id-derived, same value by construction — task_masters + task_instances
// share `id`) and updated_at (a real DB NOW() timestamp from two separate
// statements).
function normalize(row) {
  var out = Object.assign({}, row);
  delete out.id;
  delete out.master_id;
  delete out.updated_at;
  return out;
}

describe('updateTaskByIdBatch vs sequential updateTaskById — real-DB golden master (999.5287)', function () {
  beforeAll(async function () {
    await assertDbAvailable();
    await clearFixtures();
    await db('users').where('id', USER_ID).del();
    await db('users').insert(runWithActor('fixture', function () {
      return stampInsert({
        id: USER_ID, email: 'tw-batch-update-dbfx@test.invalid', name: 'batch-update db-fx test',
        timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
      });
    }));
  }, 20000);

  afterEach(async function () {
    await clearFixtures();
  });

  afterAll(async function () {
    await clearFixtures();
    await db('users').where('id', USER_ID).del();
  }, 20000);

  test('mixed field-signature batch (event-id drop, content pull, master-only, instance-only, both) lands identically to N sequential updateTaskById calls', async function () {
    // 5 payload shapes, each applied to a SEQ id and a BATCH id.
    var payloads = [
      // Legacy event-id column: NOT routed to master/instance (moved to
      // cal_sync_ledger) — dropped on both paths, only updated_at/by land.
      // Same key across every push-eligible row, DIFFERENT value per row —
      // the dominant fresh-push shape from cal-sync.controller.js.
      function (i) { return { gcal_event_id: 'evt-' + i }; },
      function (i) { return { gcal_event_id: 'evt-' + i }; },
      // Content pull (_buildPullFields shape): differing values per row.
      function (i) { return { text: 'Pulled ' + i, dur: 45 + i, scheduled_at: new Date(2026, 2, i + 1, 9, 0, 0) }; },
      // Master-only field.
      function (i) { return { depends_on: JSON.stringify(['dep-' + i]) }; },
      // Instance-only fields.
      function (i) { return { unscheduled: i % 2, time_remaining: 10 + i }; },
    ];

    var seqIds = payloads.map(function (_, i) { return 'seq-' + i; });
    var batchIds = payloads.map(function (_, i) { return 'batch-' + i; });

    await runWithActor('fixture', async function () {
      for (var i = 0; i < payloads.length; i++) {
        await tasksWrite.insertTask(db, taskRow(seqIds[i]));
        await tasksWrite.insertTask(db, taskRow(batchIds[i]));
      }
    });

    await runWithActor('cal-sync-test', async function () {
      // SEQ: mirrors the OLD facade.js write-phase loop — same shared `now`
      // raw assigned before each call, one round trip per row.
      var now = db.fn.now();
      for (var i = 0; i < payloads.length; i++) {
        var changes = payloads[i](i);
        changes.updated_at = now;
        await tasksWrite.updateTaskById(db, seqIds[i], changes, USER_ID);
      }
    });

    await runWithActor('cal-sync-test', async function () {
      // BATCH: mirrors the NEW facade.js write-phase — one updateTaskByIdBatch
      // call for the whole merged-update map.
      var now = db.fn.now();
      var updates = payloads.map(function (p, i) {
        var changes = p(i);
        changes.updated_at = now;
        return { id: batchIds[i], changes: changes };
      });
      await tasksWrite.updateTaskByIdBatch(db, updates, USER_ID);
    });

    for (var i = 0; i < payloads.length; i++) {
      var seqMaster = await db('task_masters').where('id', seqIds[i]).first();
      var batchMaster = await db('task_masters').where('id', batchIds[i]).first();
      var seqInstance = await db('task_instances').where('id', seqIds[i]).first();
      var batchInstance = await db('task_instances').where('id', batchIds[i]).first();

      expect(normalize(batchMaster)).toEqual(normalize(seqMaster));
      expect(normalize(batchInstance)).toEqual(normalize(seqInstance));

      // updated_at genuinely moved (DB-computed NOW(), not the fixture's
      // created_at) on both paths.
      expect(new Date(seqMaster.updated_at).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
      expect(new Date(batchMaster.updated_at).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());

      // Attribution stamped identically on both paths.
      expect(batchMaster.updated_by).toBe('cal-sync-test');
      expect(seqMaster.updated_by).toBe('cal-sync-test');

      // The legacy event-id field never lands anywhere (dropped by field
      // routing, same as the sequential path) — proves the batch path did
      // not accidentally invent a column write the sequential path lacks.
      expect(seqMaster.gcal_event_id).toBeUndefined();
      expect(batchMaster.gcal_event_id).toBeUndefined();
    }

    // Content-pull row (index 2): real per-row values landed via the CASE path.
    var seqPulled = await db('task_masters').where('id', seqIds[2]).first();
    var batchPulled = await db('task_masters').where('id', batchIds[2]).first();
    expect(batchPulled.text).toBe(seqPulled.text);
    expect(batchPulled.dur).toBe(seqPulled.dur);
    expect(batchPulled.text).toBe('Pulled 2');
    expect(batchPulled.dur).toBe(47);
  }, 20000);

  test('a large uniform-signature batch (fresh-push shape) matches sequential row-for-row', async function () {
    var N = 40;
    var seqIds = [];
    var batchIds = [];
    for (var i = 0; i < N; i++) { seqIds.push('seqN-' + i); batchIds.push('batchN-' + i); }

    await runWithActor('fixture', async function () {
      for (var i = 0; i < N; i++) {
        await tasksWrite.insertTask(db, taskRow(seqIds[i]));
        await tasksWrite.insertTask(db, taskRow(batchIds[i]));
      }
    });

    await runWithActor('cal-sync-test', async function () {
      var now = db.fn.now();
      for (var i = 0; i < N; i++) {
        await tasksWrite.updateTaskById(db, seqIds[i], { gcal_event_id: 'evt-' + i, updated_at: now }, USER_ID);
      }
    });
    await runWithActor('cal-sync-test', async function () {
      var now = db.fn.now();
      var updates = batchIds.map(function (id, i) {
        return { id: id, changes: { gcal_event_id: 'evt-' + i, updated_at: now } };
      });
      await tasksWrite.updateTaskByIdBatch(db, updates, USER_ID);
    });

    for (var k = 0; k < N; k++) {
      var seqMaster = await db('task_masters').where('id', seqIds[k]).first();
      var batchMaster = await db('task_masters').where('id', batchIds[k]).first();
      expect(normalize(batchMaster)).toEqual(normalize(seqMaster));
    }
  }, 20000);
});
