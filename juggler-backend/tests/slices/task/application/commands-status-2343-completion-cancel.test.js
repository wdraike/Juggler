/**
 * 999.2343 — task-lifecycle timestamp accuracy (UpdateTaskStatus).
 *
 * Part 1: `completed_at` must reflect the completion time the user attests
 *   (`body.completedAt`), not the wall-clock time the API call lands.
 *     - custom ISO time  → completed_at = that time (and scheduled_at follows, as before).
 *     - 'scheduled'      → completed_at = the task's existing scheduled_at (the fixed slot).
 *     - 'now' / absent   → completed_at = now (unchanged default).
 * Part 2: cancelling a FUTURE-scheduled task must FREEZE scheduled_at at the
 *   planned slot (cancel is a status change, not a reschedule). `skip` keeps its
 *   existing snap-to-now behaviour (out of scope for this ticket).
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var UpdateTaskStatus = require('../../../../src/slices/task/application/commands/UpdateTaskStatus');
var H = require('./_helpers');
var { z } = require('zod');

var USER = 'sd-user';

var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  direction: z.string().optional()
}).passthrough();

function statusDeps(repo, trigger, events, extra) {
  return H.baseDeps(Object.assign({
    repo: repo,
    cache: H.makeCacheFake(),
    events: events,
    enqueueScheduleRun: trigger,
    statusUpdateSchema: statusUpdateSchema,
    materializeRcInstance: function () { return Promise.resolve(null); },
    handleTemplatePause: function () { return Promise.resolve({ pausedCount: 0, pausedIds: [], unpausedCount: 0, unpausedIds: [] }); },
    loadMaster: function () { return Promise.resolve(null); },
    isRollingMaster: function () { return false; },
    applyRollingAnchor: function () { return Promise.resolve(); },
    loadSplitSiblings: function () { return Promise.resolve([]); },
    triggerCalSync: { sync: function () {} },
    reactivateDoneFrozen: function () { return Promise.resolve(); }
  }, extra || {}));
}

function seedAt(scheduledAt) {
  return new InMemoryTaskRepository({ rows: [
    { id: 's1', user_id: USER, task_type: 'task', status: '', scheduled_at: scheduledAt, updated_at: new Date('2026-06-01T00:00:00Z') }
  ] });
}

describe('999.2343 — completion time accuracy (Part 1)', function () {
  test('done with a custom attested completedAt → completed_at records that time', function () {
    var repo = seedAt(new Date('2026-06-02T15:00:00Z'));
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'done', completedAt: '2026-06-02T14:00:00Z' } }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        expect(new Date(r.completed_at).toISOString()).toBe('2026-06-02T14:00:00.000Z');
        // display slot follows the attested time too (pre-existing behaviour, preserved)
        expect(new Date(r.scheduled_at).toISOString()).toBe('2026-06-02T14:00:00.000Z');
      });
    });
  });

  test("done with completedAt='scheduled' → completed_at = the fixed scheduled slot", function () {
    var repo = seedAt(new Date('2026-06-02T15:00:00Z'));
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'done', completedAt: 'scheduled' } }).then(function () {
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        expect(new Date(r.completed_at).toISOString()).toBe('2026-06-02T15:00:00.000Z');
      });
    });
  });

  test("done with completedAt='scheduled' pins a tz-less DB string to UTC (no local-offset drift)", function () {
    // mysql2 dateStrings:true returns scheduled_at as a tz-less UTC string.
    // A bare new Date('2026-06-02 15:00:00') parses it as SERVER-LOCAL (the
    // misparse trap) — on this non-UTC test host that would land at a different
    // instant. parseDbUtc pins it to 15:00Z. Result is a JS Date (P1 invariant).
    var repo = seedAt('2026-06-02 15:00:00');
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'done', completedAt: 'scheduled' } }).then(function () {
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        expect(r.completed_at instanceof Date).toBe(true);
        expect(r.completed_at.toISOString()).toBe('2026-06-02T15:00:00.000Z');
      });
    });
  });

  test('done with no completedAt → completed_at defaults to ~now (unchanged)', function () {
    var repo = seedAt(new Date('2026-06-02T15:00:00Z'));
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    var before = Date.now();
    return uc.execute({ id: 's1', userId: USER, body: { status: 'done' } }).then(function () {
      var after = Date.now();
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        var t = new Date(r.completed_at).getTime();
        expect(t).toBeGreaterThanOrEqual(before - 5000);
        expect(t).toBeLessThanOrEqual(after + 5000);
      });
    });
  });
});

describe('999.2343 — cancel freezes the planned slot (Part 2)', function () {
  test('cancelling a future-scheduled task keeps scheduled_at at the planned slot (not now)', function () {
    var future = new Date('2030-01-01T10:00:00Z');
    var repo = seedAt(future);
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    return uc.execute({ id: 's1', userId: USER, body: { status: 'cancel' } }).then(function (out) {
      expect(out.status).toBe(200);
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        expect(r.status).toBe('cancel');
        expect(new Date(r.scheduled_at).toISOString()).toBe('2030-01-01T10:00:00.000Z');
      });
    });
  });

  test('skip on a future-scheduled task still snaps scheduled_at to ~now (unchanged)', function () {
    var future = new Date('2030-01-01T10:00:00Z');
    var repo = seedAt(future);
    var uc = new UpdateTaskStatus(statusDeps(repo, H.makeTriggerSpy(), H.makeEventsSpy()));
    var before = Date.now();
    return uc.execute({ id: 's1', userId: USER, body: { status: 'skip' } }).then(function () {
      var after = Date.now();
      return repo.fetchTaskWithEventIds('s1', USER).then(function (r) {
        var t = new Date(r.scheduled_at).getTime();
        expect(t).toBeGreaterThanOrEqual(before - 5000);
        expect(t).toBeLessThanOrEqual(after + 5000);
      });
    });
  });
});
