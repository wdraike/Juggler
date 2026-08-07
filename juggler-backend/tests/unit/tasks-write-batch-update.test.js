'use strict';

/**
 * tasks-write-batch-update.test.js — 999.5287.
 *
 * updateTaskByIdBatch (src/lib/tasks-write.js) replaces the cal-sync
 * write-phase's sequential per-row updateTaskById loop (calendar/facade.js
 * runSyncWritePhase step 2) with grouped multi-row UPDATEs. This is a
 * golden-master style comparison, pure/no-DB: a capturing fake knex records
 * every `update()` call each path issues; the test REPLAYS those calls onto
 * a plain in-memory row map and asserts the two paths converge on the
 * IDENTICAL final field state for every id — proving the batch path is a
 * pure optimization of round-trip count, not a behavior change.
 *
 * Also covers the specific mechanics the ticket calls out:
 *   - grouping is by ROUTED FIELD-NAME set, not by literal value (the
 *     dominant real caller gives every row the SAME key / DIFFERENT value)
 *   - a field whose value is IDENTICAL across a whole group (always true for
 *     `updated_at`, since every call site shares one `db.fn.now()` raw) is
 *     applied directly, no CASE needed
 *   - a field that differs per row within a group is folded into one
 *     CASE `id` ... END expression (fewer round trips, same result)
 *   - fields unrecognized by the master/instance routing tables (e.g. the
 *     legacy `gcal_event_id`) are dropped identically to updateTaskById
 *   - the updated_by-only no-op suppression survives batching
 *   - a batch group whose rows carry DIFFERING raw values for one field
 *     throws rather than silently picking one
 */

const { runWithActor } = require('../../src/lib/audit-context');
const tasksWrite = require('../../src/lib/tasks-write');

const NOW_RAW = { toSQL: () => ({ sql: 'NOW()' }), __label: 'NOW()' };

// Capturing fake knex — same shape as tests/unit/tasks-write-stamp.test.js's
// fakeDb(), extended with whereIn capture and a raw() that records its SQL +
// bindings (needed to assert CASE construction) while still being directly
// consumable by the query-builder chain (knex's own `.raw()` result is what
// gets assigned into an update() payload; here we just tag a plain object).
function fakeDb() {
  const ops = [];
  const dbFn = (table) => {
    const ctx = { table, wheres: [], whereIns: [] };
    const builder = {
      // knex .where() supports both the object form (.where({col: val})) and
      // the 2-arg form (.where(col, val)) — this module uses both across its
      // call sites, so the fake must normalize both into the same {col:val}
      // shape for the assertions below.
      where(a, b) {
        ctx.wheres.push(typeof a === 'string' ? { [a]: b } : a);
        return builder;
      },
      whereIn(col, ids) { ctx.whereIns.push({ col, ids: ids.slice() }); return builder; },
      update(changes) {
        ops.push({
          table,
          wheres: ctx.wheres.map((w) => Object.assign({}, w)),
          whereIns: ctx.whereIns.map((w) => Object.assign({}, w)),
          changes,
        });
        return Promise.resolve(1);
      },
    };
    return builder;
  };
  dbFn.fn = { now: () => NOW_RAW };
  dbFn.raw = (sql, bindings) => ({ __raw: true, sql, bindings, toSQL: () => ({ sql, bindings }) });
  dbFn.__ops = ops;
  return dbFn;
}

/**
 * Replay every captured update() call onto a plain in-memory row map keyed
 * by id, resolving CASE-`id`-WHEN/THEN raws and direct values identically to
 * what MySQL would compute. This is the golden-master oracle: if the
 * sequential and batched paths replay to the same final row states, they
 * are behaviorally identical regardless of how many round trips each took.
 */
function replay(ops, ids) {
  const rows = {};
  ids.forEach((id) => { rows[id] = {}; });
  ops.forEach((op) => {
    const targetIds = op.whereIns.length
      ? op.whereIns[0].ids
      : op.wheres.filter((w) => w.id !== undefined).map((w) => w.id);
    targetIds.forEach((id) => {
      if (!rows[id]) rows[id] = {};
      Object.keys(op.changes).forEach((k) => {
        const v = op.changes[k];
        if (v && v.__raw) {
          // CASE `id` WHEN ? THEN ? ... END — bindings are [id, val, id, val, ...]
          const b = v.bindings;
          let resolved;
          for (let i = 0; i < b.length; i += 2) {
            if (b[i] === id) { resolved = b[i + 1]; break; }
          }
          rows[id][k] = resolved;
        } else {
          rows[id][k] = v;
        }
      });
    });
  });
  return rows;
}

describe('updateTaskByIdBatch — golden-master parity with sequential updateTaskById (999.5287)', () => {
  test('same-key/DIFFERENT-value rows (the dominant fresh-push case) land in ONE group, ONE update() call per table, same final state', async () => {
    const seqDb = fakeDb();
    const batchDb = fakeDb();
    const ids = ['t1', 't2', 't3', 't4', 't5'];
    const now = NOW_RAW;

    await runWithActor('cal-sync', async () => {
      for (const id of ids) {
        await tasksWrite.updateTaskById(seqDb, id, { gcal_event_id: 'evt-' + id, updated_at: now }, 'user-1');
      }
    });
    await runWithActor('cal-sync', async () => {
      const updates = ids.map((id) => ({ id, changes: { gcal_event_id: 'evt-' + id, updated_at: now } }));
      await tasksWrite.updateTaskByIdBatch(batchDb, updates, 'user-1');
    });

    // Behavior parity.
    const seqState = replay(seqDb.__ops, ids);
    const batchState = replay(batchDb.__ops, ids);
    expect(batchState).toEqual(seqState);
    // Every row got updated_by stamped, gcal_event_id dropped (not a routed
    // column on either table) — same as the sequential path.
    ids.forEach((id) => {
      expect(seqState[id]).toEqual({ updated_at: now, updated_by: 'cal-sync' });
      expect(seqState[id].gcal_event_id).toBeUndefined();
    });

    // Round-trip reduction: sequential did 2 update() calls per row (master +
    // instance) = 10; batched collapses the whole same-signature group into
    // ONE update() call per table = 2.
    expect(seqDb.__ops.length).toBe(ids.length * 2);
    expect(batchDb.__ops.length).toBe(2);
    // The collapsed group used the identical-value direct-payload shortcut —
    // no CASE needed, since updated_at/updated_by are the same for every row.
    batchDb.__ops.forEach((op) => {
      Object.values(op.changes).forEach((v) => expect(v && v.__raw && /CASE/.test(v.sql || '')).toBeFalsy());
    });
  });

  test('same-key/DIFFERENT-value CONTENT fields (pull path) fold into a CASE expression with correct per-row values', async () => {
    const seqDb = fakeDb();
    const batchDb = fakeDb();
    const ids = ['t1', 't2', 't3'];
    const now = NOW_RAW;
    const changesFor = (id, i) => ({ text: 'Renamed ' + id, dur: 40 + i, scheduled_at: new Date(2026, 0, i + 1), updated_at: now });

    await runWithActor('cal-sync', async () => {
      for (let i = 0; i < ids.length; i++) {
        await tasksWrite.updateTaskById(seqDb, ids[i], changesFor(ids[i], i), 'user-1');
      }
    });
    await runWithActor('cal-sync', async () => {
      const updates = ids.map((id, i) => ({ id, changes: changesFor(id, i) }));
      await tasksWrite.updateTaskByIdBatch(batchDb, updates, 'user-1');
    });

    const seqState = replay(seqDb.__ops, ids);
    const batchState = replay(batchDb.__ops, ids);
    expect(batchState).toEqual(seqState);
    ids.forEach((id, i) => {
      expect(seqState[id].text).toBe('Renamed ' + id);
      expect(seqState[id].dur).toBe(40 + i);
    });

    expect(seqDb.__ops.length).toBe(ids.length * 2); // 3 rows x (master+instance)
    expect(batchDb.__ops.length).toBe(2); // one group -> one update() per table
    // dur/text/scheduled_at differ per row -> must be CASE-based.
    const masterOp = batchDb.__ops.find((o) => o.table === 'task_masters');
    expect(masterOp.changes.text.__raw).toBe(true);
    expect(masterOp.changes.text.sql).toMatch(/CASE `id`/);
  });

  test('mixed field-set rows split into separate groups (master-only vs instance-only vs both)', async () => {
    const batchDb = fakeDb();
    const now = NOW_RAW;
    const updates = [
      { id: 'm1', changes: { depends_on: '["dep-1"]', updated_at: now } }, // master-only
      { id: 'm2', changes: { depends_on: '["dep-2"]', updated_at: now } }, // master-only, same group as m1
      { id: 'i1', changes: { unscheduled: 1, time_remaining: 15, updated_at: now } }, // instance-only
      { id: 'i2', changes: { unscheduled: 0, time_remaining: 30, updated_at: now } }, // instance-only, same group as i1
      { id: 'b1', changes: { status: 'wip', updated_at: now } }, // both tables
    ];
    await runWithActor('cal-sync', () => tasksWrite.updateTaskByIdBatch(batchDb, updates, 'user-1'));

    const masterOps = batchDb.__ops.filter((o) => o.table === 'task_masters');
    const instanceOps = batchDb.__ops.filter((o) => o.table === 'task_instances');
    // updated_at mirrors to BOTH tables (splitUpdateFields), so even an
    // instance-only content change still "touches" master (updated_at/by
    // only) — same as a sequential updateTaskById call would. Three groups
    // per table: {depends_on,updated_at,updated_by} (m1,m2, real on master /
    // touch-only on instance), {time_remaining,unscheduled,updated_at,
    // updated_by} (i1,i2, touch-only on master / real on instance),
    // {status,updated_at,updated_by} (b1, real on both).
    expect(masterOps.length).toBe(3);
    expect(instanceOps.length).toBe(3);

    const state = replay(batchDb.__ops, ['m1', 'm2', 'i1', 'i2', 'b1']);
    expect(state.m1.depends_on).toBe('["dep-1"]');
    expect(state.m2.depends_on).toBe('["dep-2"]');
    expect(state.i1.unscheduled).toBe(1);
    expect(state.i1.time_remaining).toBe(15);
    expect(state.i2.time_remaining).toBe(30);
    expect(state.b1.status).toBe('wip');
  });

  test('updated_by-ONLY change-set is suppressed on both tables, same as updateTaskById', async () => {
    const seqDb = fakeDb();
    const batchDb = fakeDb();
    await runWithActor('cal-sync', () => tasksWrite.updateTaskById(seqDb, 't1', {}, 'user-1'));
    await runWithActor('cal-sync', () =>
      tasksWrite.updateTaskByIdBatch(batchDb, [
        { id: 't1', changes: {} },
        { id: 't2', changes: {} },
      ], 'user-1')
    );
    expect(seqDb.__ops.length).toBe(0);
    expect(batchDb.__ops.length).toBe(0);
  });

  test('tenancy: userId is applied as a filter on every grouped UPDATE, same as updateTaskById', async () => {
    const batchDb = fakeDb();
    const updates = [
      { id: 't1', changes: { status: 'done' } },
      { id: 't2', changes: { status: 'done' } },
    ];
    await runWithActor('cal-sync', () => tasksWrite.updateTaskByIdBatch(batchDb, updates, 'user-42'));
    batchDb.__ops.forEach((op) => {
      expect(op.wheres.some((w) => w.user_id === 'user-42')).toBe(true);
      expect(op.whereIns[0].ids.sort()).toEqual(['t1', 't2']);
    });
  });

  test('a group with DIFFERING raw values for the same field throws instead of silently picking one', async () => {
    const batchDb = fakeDb();
    const otherRaw = { toSQL: () => ({ sql: 'NOW() + 1' }), __label: 'other' };
    const updates = [
      { id: 't1', changes: { updated_at: NOW_RAW } },
      { id: 't2', changes: { updated_at: otherRaw } },
    ];
    await expect(
      runWithActor('cal-sync', () => tasksWrite.updateTaskByIdBatch(batchDb, updates, 'user-1'))
    ).rejects.toThrow(/DIFFERING raw SQL/);
  });

  test('0 and 1-row batches behave exactly like calling updateTaskById directly', async () => {
    const batchDb = fakeDb();
    const result0 = await runWithActor('cal-sync', () => tasksWrite.updateTaskByIdBatch(batchDb, [], 'user-1'));
    expect(result0).toEqual({ masterUpdated: 0, instanceUpdated: 0 });
    expect(batchDb.__ops.length).toBe(0);

    const result1 = await runWithActor('cal-sync', () =>
      tasksWrite.updateTaskByIdBatch(batchDb, [{ id: 't1', changes: { status: 'wip' } }], 'user-1')
    );
    expect(result1).toEqual({ masterUpdated: 1, instanceUpdated: 1 });
    expect(batchDb.__ops.length).toBe(2);
    batchDb.__ops.forEach((op) => {
      // Single-row path uses a plain where({id,...}), not whereIn.
      expect(op.whereIns.length).toBe(0);
      expect(op.wheres.some((w) => w.id === 't1')).toBe(true);
    });
  });
});
