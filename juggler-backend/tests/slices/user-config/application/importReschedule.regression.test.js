/**
 * Regression tests — jug-sched-trigger / 999.486-B
 *
 * Verifies that ImportData.execute returns a scheduleAfter directive on a
 * successful import, so the scheduler re-runs after the bulk wipe+reinsertion
 * of all scheduling inputs.
 *
 * STATUS: These tests are GREEN on current code — ImportData.js:176 already
 * returns scheduleAfter:{userId, source:'config:import'}. The backlog item
 * 999.486-B is therefore ALREADY SATISFIED by the existing implementation.
 *
 * These tests exist as a REGRESSION GUARD so future changes cannot silently
 * drop the directive. They mirror the AC3a/AC3c/AC3d assertions in
 * schedRerunOnSettings.regression.test.js but are the authoritative
 * per-item pin for 999.486-B.
 *
 * Run: DB_PORT=3407 npx jest tests/slices/user-config/application/importReschedule.regression.test.js
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var App = require(path.join(SLICE, 'application'));

var USER = 'import-reschedule-user';

function deps(repo, calls) {
  calls = calls || { wipe: [], tasks: [] };
  return {
    repo: repo,
    wipeTasks: function (trxRepo, uid) { calls.wipe.push(uid); return Promise.resolve(); },
    insertTask: function (trxRepo, row) { calls.tasks.push(row); return Promise.resolve(); },
    buildTaskRow: function (t, uid) { return { id: t.id, user_id: uid }; }
  };
}

// ── 999.486-B: ImportData scheduleAfter directive ───────────────────────────
describe('999.486-B: ImportData — scheduleAfter directive on successful import', () => {
  /**
   * ImportData wipes all scheduling inputs (tool_matrix, time_blocks,
   * loc_schedules, loc_schedule_defaults, loc_schedule_overrides,
   * hour_location_overrides, locations, tools, tasks) in one transaction
   * and reinserts them. After the import the scheduler MUST re-run.
   *
   * Implementation: ImportData.js:176 returns
   *   scheduleAfter: { userId, source: 'config:import' }
   *
   * These tests are GREEN on current code (the directive is already present).
   * They are a regression guard — do not modify them without updating 999.486-B.
   */

  test('999.486-B-1: successful import returns scheduleAfter with source config:import', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ImportData(deps(repo));
    var res = await uc.execute({
      userId: USER,
      confirm: 'delete_all',
      data: {
        extraTasks: [{ id: 't1', text: 'Task 1' }],
        locations: [{ id: 'l1', name: 'Home' }],
        timeBlocks: { morning: { start: 480, end: 720 } },
        toolMatrix: { 'l1': ['t1'] }
      }
    });
    expect(res.status).toBe(200);
    // The directive must be present (currently GREEN — ImportData.js:176)
    expect(res.scheduleAfter).toBeDefined();
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:import' });
    // Exactly ONE directive (not one per config key)
    expect(Array.isArray(res.scheduleAfter)).toBe(false);
  });

  test('999.486-B-2: empty import (no tasks, no config) still returns scheduleAfter', async () => {
    // Even an empty import (wiping everything) is a scheduling input change.
    var repo = new InMemoryConfigRepository();
    var uc = new App.ImportData(deps(repo));
    var res = await uc.execute({
      userId: USER,
      confirm: 'delete_all',
      data: { extraTasks: [] }
    });
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:import' });
  });

  test('999.486-B-3: 400 missing confirm must NOT return scheduleAfter', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ImportData(deps(repo));
    var res = await uc.execute({
      userId: USER,
      confirm: undefined,
      data: { extraTasks: [] }
    });
    expect(res.status).toBe(400);
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('999.486-B-4: 400 invalid shape must NOT return scheduleAfter', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ImportData(deps(repo));
    var res = await uc.execute({
      userId: USER,
      confirm: 'delete_all',
      data: { notExtraTasks: [] }
    });
    expect(res.status).toBe(400);
    expect(res.scheduleAfter).toBeUndefined();
  });
});
