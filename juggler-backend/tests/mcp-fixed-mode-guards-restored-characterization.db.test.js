/**
 * mcp-fixed-mode-guards-restored-characterization.db.test.js
 *
 * jug-mcp-facade — fix-loop iter1 AFTER-state pins (bert-REVIEW.json findings
 * #14/#15, ernie-e1/e2 BLOCK-1/BLOCK-2, both RESOLVED in re-review iter1).
 *
 * The WI-2 facade migration initially DROPPED the pre-migration OR-based
 * fixed-mode-requires-schedule guards for update_task and batch_update_tasks
 * (facade's own guards are either differently-worded/AND-based, in the
 * update_task case, or absent entirely, in the batch case). bert restored
 * both as thin adapter pre-guards (tasks.js:346-356 and tasks.js:531-560)
 * that reproduce the EXACT legacy condition + error string BEFORE any facade
 * call. This file pins the AFTER-state (restored) behavior — previously
 * untested by any characterization file (bert's own REFER note: "none of
 * these are covered by an existing test today").
 *
 * update_task legacy condition (OR-based): reject only when date AND time AND
 * scheduledAt are ALL absent from the call AND the row's EXISTING scheduled_at
 * is also absent. An existing scheduled_at (already-scheduled task) satisfies
 * the guard even with no scheduling fields in THIS call — THIS is what
 * bert's adapter pre-guard (tasks.js:346-356) and ernie's e1 fix note both
 * describe as the restored behavior.
 *
 * batch_update_tasks: identical per-item OR-based condition, applied BEFORE
 * calling facade.batchUpdateTasks — bulk-fetches existing scheduled_at once,
 * then aborts the WHOLE batch (no facade call at all) if ANY item fails,
 * returning the joined 'id: error; id: error' text — stronger than the old
 * transaction-rollback-after-partial-attempt (nothing is even attempted here).
 *
 * ── FINAL STATE (3rd/final characterization pass, cookie WARN-2 ruled) ──────
 * The "existing scheduled_at satisfies the guard" exemption bert/ernie originally
 * described (e1/e2 "RESOLVED") is UNREACHABLE end-to-end for BOTH update_task and
 * batch_update_tasks whenever the call explicitly includes `placementMode:'fixed'`
 * with no inline date/time/scheduledAt — because the SHARED, PURE
 * `validateTaskInput()` cross-field check (taskValidation.js:317-324) is called
 * unconditionally on the REAL (existing-blind) body/item at TWO points:
 *   - update_task: facade's own UpdateTask.js:110, BEFORE UpdateTask's existing-
 *     aware AND-guard (256-262, complex-path-only) ever runs.
 *   - batch_update_tasks: facade's own BatchUpdateTasks.js:92, per-item, before
 *     lockedBatchUpdate/batchUpdateTxn.
 *
 * Fix-loop iter2 (bert) added a tasks.js-level adapter reorder for update_task
 * ONLY (guard-before-validate + a validation-only clone carrying the existing
 * scheduled_at, tasks.js:355-391) that correctly removes tasks.js's OWN local
 * shadow of the SAME check (tasks.js:329, introduced by WI-2's migration — this
 * call did not exist pre-migration) — a real, kept improvement — but does NOT
 * restore the exemption END-TO-END, because facade's UpdateTask.js:110 has an
 * independent, deeper duplicate of the identical shadow. Direct repro (both
 * bert's self-verify and cookie's re-review iter2, confirmed again in this pass):
 * `validateTaskInput({placementMode:'fixed',notes:'x'})` still rejects even when
 * the row has an existing scheduled_at, because the value never reaches the
 * validator — only a synthetic clone at the tasks.js layer does, and facade
 * re-validates the REAL body independently.
 *
 * batch_update_tasks got NO adapter-level workaround at all: tasks.js's own
 * batch guard (575-595) already ran entirely before the facade call (no
 * same-function reorder available), so the shadow lives ENTIRELY inside
 * BatchUpdateTasks.js:92 with zero existing-row context.
 *
 * cookie's WARN-2 ruling (re-review iter2, cookie-REVIEW.json) RULED (b): ACCEPT
 * both as a documented, out-of-scope gap — the clean fix is in SHARED facade
 * code (UpdateTask.js:110 / BatchUpdateTasks.js:92) affecting HTTP callers too
 * and pre-dating this leg; the only adapter-only path that would restore either
 * one (injecting the row's real scheduled_at into the body/item actually WRITTEN)
 * is a semantic write side-effect, disproportionate risk for a narrow edge case
 * with a trivial caller workaround (send date/time, or omit placementMode when
 * not changing it). cookie also notes the exemption was OLD-MCP-ONLY: the legacy
 * HTTP handler always called the same existing-blind validateTaskInput first and
 * rejected the same input — so post-migration MCP has CONVERGED to long-standing
 * HTTP behavior for BOTH tools, not diverged from it. Filed as ONE backlog item,
 * 999.1382, covering both facade call sites (REFER->ernie for the validation-
 * ordering implementation whenever it is picked up).
 *
 * This file pins the ACTUAL, FINAL, cookie-ruled observed behavior — REJECT in
 * both cases — as the documented final state of this leg. update_task's
 * tasks.js-level reorder is correct adapter hygiene and is kept (it removes
 * tasks.js's own local shadow and yields the byte-identical true-reject string
 * for the reachable case), but does not change the end-to-end outcome for the
 * exempt scenario.
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-fixedguard-restored-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function (name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerTaskTools(fakeServer, userId);
  return handlers;
}

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert({
      id: USER_ID, email: 'mcp-fixedguard-restored@test.invalid', name: 'MCP fixed-mode guard restored',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

async function insertTask(id, overrides) {
  var now = new Date();
  await db('task_masters').insert(Object.assign({
    id: id, user_id: USER_ID, text: 'Fixed-guard test task ' + id, dur: 30, pri: 'P3',
    recurring: 0, status: '', created_at: now, updated_at: now
  }, overrides.master || {}));
  await db('task_instances').insert(Object.assign({
    id: id, master_id: id, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    created_at: now, updated_at: now
  }, overrides.instance || {}));
}

var LEGACY_FIXED_GUARD_STRING = 'Validation error: placementMode "fixed" requires a date, time, or scheduledAt';

describe('MCP fixed-mode-requires-schedule guards — restored at the adapter layer, existing-scheduled_at exemption still shared-facade-shadowed (FINAL state, cookie WARN-2 ruled, backlog 999.1382)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  describe('update_task', function () {

    test('fixed mode + no date/time/scheduledAt + NO existing scheduled_at -> legacy reject string, row UNCHANGED', async function () {
      var taskId = 'mcp-fg-upd-reject-' + Date.now();
      await insertTask(taskId, { instance: { scheduled_at: null } });

      var handlers = captureHandlers(USER_ID);
      var result = await handlers.update_task({ id: taskId, placementMode: 'fixed' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(LEGACY_FIXED_GUARD_STRING);

      var row = await db('task_instances').where('id', taskId).first();
      expect(row.status).toBe(''); // unchanged — no facade call was made
    });

    test('FINAL DOCUMENTED STATE (cookie WARN-2 RULE-b accept, backlog 999.1382): fixed mode explicitly re-sent + no date/time/scheduledAt in the call -> STILL rejects even with an EXISTING scheduled_at, because facade UpdateTask.js:110\'s own existing-blind validateTaskInput independently re-rejects the real body downstream of tasks.js\'s adapter-level reorder', async function () {
      var taskId = 'mcp-fg-upd-allow-' + Date.now();
      await insertTask(taskId, {
        instance: { scheduled_at: new Date('2026-08-01T15:00:00Z'), date: '2026-08-01', time: '15:00' }
      });

      var handlers = captureHandlers(USER_ID);
      var result = await handlers.update_task({ id: taskId, placementMode: 'fixed', notes: 'still fixed, already scheduled' });

      // Pinning the FINAL, cookie-ruled REALITY: tasks.js's own adapter-level
      // reorder (fix-loop iter2) removed tasks.js's OWN local shadow of this
      // check (a real, kept improvement — see file header), but facade's
      // UpdateTask.js:110 independently calls the SAME existing-blind
      // validateTaskInput() on the REAL body BEFORE its own existing-aware
      // AND-guard (256-262, complex-path-only) ever runs — so the exemption
      // is still unreachable end-to-end. Not a bug in this leg's adapter code;
      // a pre-existing shared-facade gap affecting HTTP too (backlog 999.1382).
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(LEGACY_FIXED_GUARD_STRING);
      var row = await db('task_masters').where('id', taskId).first();
      expect(row.notes).toBeNull(); // update did NOT apply
    });

    test('workaround that DOES succeed: omitting placementMode entirely on an already-fixed+scheduled row (guard never evaluates — no placementMode field in the call)', async function () {
      var taskId = 'mcp-fg-upd-omit-' + Date.now();
      await insertTask(taskId, {
        master: { placement_mode: 'fixed' },
        instance: { scheduled_at: new Date('2026-08-01T15:00:00Z'), date: '2026-08-01', time: '15:00' }
      });

      var handlers = captureHandlers(USER_ID);
      // No placementMode field at all — updateFields.placementMode is
      // undefined, so NEITHER validateTaskInput's check NOR the adapter's
      // pre-guard evaluates the fixed-mode branch.
      var result = await handlers.update_task({ id: taskId, notes: 'unaffected by fixed-mode guard' });

      expect(result.isError).toBeFalsy();
      var row = await db('task_masters').where('id', taskId).first();
      expect(row.notes).toBe('unaffected by fixed-mode guard');
    });

  });

  describe('batch_update_tasks', function () {

    test('one fixed-without-schedule item ABORTS THE WHOLE BATCH pre-facade-call — legacy joined string, NO row persisted for ANY item', async function () {
      var goodId = 'mcp-fg-batch-good-' + Date.now();
      var badId = 'mcp-fg-batch-bad-' + Date.now();
      await insertTask(goodId, { instance: { scheduled_at: null } });
      await insertTask(badId, { instance: { scheduled_at: null } });

      var handlers = captureHandlers(USER_ID);
      var result = await handlers.batch_update_tasks({
        updates: [
          { id: goodId, notes: 'should NOT be persisted' },
          { id: badId, placementMode: 'fixed' } // fixed, no date/time/scheduledAt, no existing scheduled_at
        ]
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(badId + ': ' + LEGACY_FIXED_GUARD_STRING);

      // The WHOLE batch is aborted BEFORE any facade call — the good item's
      // notes field must NOT have been written either.
      var goodRow = await db('task_masters').where('id', goodId).first();
      expect(goodRow.notes == null || goodRow.notes === '').toBe(true);
      var badRow = await db('task_instances').where('id', badId).first();
      expect(badRow.status).toBe('');
    });

    test('FINAL DOCUMENTED STATE (cookie WARN-2 RULE-b accept, backlog 999.1382): a fixed item explicitly re-sent WITH an existing scheduled_at in a batch STILL rejects (facade\'s own per-item validateTaskInput, existing-blind, fires downstream of the adapter\'s pre-check) — accepted as out-of-scope, not fixed this leg', async function () {
      var taskId = 'mcp-fg-batch-allow-' + Date.now();
      await insertTask(taskId, {
        instance: { scheduled_at: new Date('2026-08-01T15:00:00Z'), date: '2026-08-01', time: '15:00' }
      });

      var handlers = captureHandlers(USER_ID);
      var result = await handlers.batch_update_tasks({
        updates: [{ id: taskId, placementMode: 'fixed', notes: 'batch allow' }]
      });

      // The adapter's OWN per-item pre-check (tasks.js:575-595) passes this
      // item through (existing.scheduled_at satisfies it) — but
      // facade.batchUpdateTasks -> BatchUpdateTasks.js:92 runs the SAME pure
      // validateTaskInput() (existing-blind) per item internally, and that
      // one has no exemption. Net: still rejects. Unlike update_task,
      // batch_update_tasks got NO adapter-level workaround at all (a real
      // adapter-only fix would require writing the existing scheduled_at back
      // into the persisted item — a semantic write side-effect cookie rejected
      // as disproportionate risk). RULED: accept + backlog 999.1382 (same item
      // as the update_task case above — one shared-facade root cause, two
      // call sites).
      expect(result.isError).toBe(true);
      var row = await db('task_masters').where('id', taskId).first();
      expect(row.notes).toBeNull();
    });

    test('workaround that DOES succeed: omitting placementMode entirely in the batch item (guard never evaluates)', async function () {
      var taskId = 'mcp-fg-batch-omit-' + Date.now();
      await insertTask(taskId, {
        master: { placement_mode: 'fixed' },
        instance: { scheduled_at: new Date('2026-08-01T15:00:00Z'), date: '2026-08-01', time: '15:00' }
      });

      var handlers = captureHandlers(USER_ID);
      var result = await handlers.batch_update_tasks({
        updates: [{ id: taskId, notes: 'batch allow, no placementMode field' }]
      });

      expect(result.isError).toBeFalsy();
      var row = await db('task_masters').where('id', taskId).first();
      expect(row.notes).toBe('batch allow, no placementMode field');
    });

  });

});
