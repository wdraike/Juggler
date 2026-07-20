/**
 * facade-next-start-anchor-redraw.db.test.js
 *
 * 999.1110 (David 2020-01-04) / R5 ruling (2020-01-19) — "Next Cycle Starts"
 * anchor edit, real controller->facade->recurCleanup->DB path.
 *
 * Closes the gap: rolling/pattern recurring masters had no UI/API path to
 * move `next_start` (the unified recurrence anchor — see
 * juggler-anchor-column-cleanup) once set. Editing the legacy
 * 'recurrence start' field (recur_start) is silently a no-op post-first-
 * completion because expandRecurring's getAnchor() prefers next_start.
 *
 * This file proves the REDRAW semantics (R5 ruling text): editing the
 * anchor via PUT /api/tasks/:id { nextStart } (1) persists the (possibly
 * pattern-snapped) new next_start on task_masters, (2) hard-deletes
 * not-yet-happened FUTURE pending (status='') instances generated from the
 * OLD anchor, and (3) NEVER touches done/skip instances (pencil-not-pen
 * rule) — via resetRecurringInstances, the SAME collaborator recur/split/dur
 * edits already use (facade.js recurCleanup).
 *
 * Modeled on the established real-controller-DB pattern
 * (facade-next-occurrence-anchor-wiring.db.test.js).
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../src/db');
var { assertDbAvailable } = require('../../helpers/requireDB');
var USER_ID = 'facade-nsar-999-1110';

jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));
// 999.1110 (harrison review, item 6): scheduleQueue is mocked away entirely
// above, so it never calls scheduler/scheduleTrigger's registerScheduleTrigger
// — the facade's OWN enqueueScheduleRun wrapper (slices/task/facade.js
// enqueueScheduleRun) still destructures `scheduleTrigger.enqueueScheduleRun`
// at require-time and defers to it via `setTimeout(...,2000)` when
// `skipScheduler` is false. Mock scheduleTrigger directly so that deferred
// call is observable — this is what actually PROVES never-missing (a new
// anchor's regenerated instances only get PLACED once a schedule run fires;
// asserting `skipScheduler:false` here pins that a nextStart edit does not
// silently skip the trigger) rather than merely inspecting the source.
jest.mock('../../../src/scheduler/scheduleTrigger', () => ({
  enqueueScheduleRun: jest.fn(),
  registerScheduleTrigger: jest.fn()
}));
jest.mock('../../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  invalidateTasks: jest.fn().mockResolvedValue(true),
  invalidateConfig: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));

var controller = require('../../../src/controllers/task.controller');
var scheduleTrigger = require('../../../src/scheduler/scheduleTrigger');

// The facade's enqueueScheduleRun wrapper defers the actual trigger call via
// setTimeout(...,2000) (SSE emit is synchronous, the schedule enqueue is
// not) — wait past that window with REAL timers (not fake — this suite mixes
// real DB/knex I/O, which fake timers can destabilize) before asserting.
function waitForDeferredScheduleTrigger() {
  return new Promise(function (resolve) { setTimeout(resolve, 2100); });
}

function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {},
    query: {},
    body: {},
    planFeatures: {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1 },
      calendar: { max_providers: -1 },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true }
    },
    planId: 'enterprise'
  }, overrides);
}

function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function (code) { res.statusCode = code; return res; },
    json: function (data) { res._json = data; return res; }
  };
  return res;
}

async function seedMaster(tmplId, overrides) {
  var now = new Date();
  await db('task_masters').insert(Object.assign({
    id: tmplId,
    user_id: USER_ID,
    text: 'weekly (Monday) master — 999.1110 anchor redraw test',
    dur: 30,
    pri: 'P3',
    recurring: 1,
    status: '',
    recur: JSON.stringify({ type: 'weekly', days: 'M' }),
    recur_start: '2026-01-05',
    next_start: null,
    created_at: now,
    updated_at: now
  }, overrides || {}));
}

async function seedInstance(tmplId, instId, overrides) {
  var now = new Date();
  await db('task_instances').insert(Object.assign({
    id: instId,
    master_id: tmplId,
    user_id: USER_ID,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    created_at: now,
    updated_at: now
  }, overrides || {}));
}

describe('facade.updateTask -> recurCleanup "Next Cycle Starts" anchor redraw (999.1110 / R5)', () => {
  beforeAll(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert({
        id: USER_ID,
        email: 'facade-nsar-999-1110@test.invalid',
        name: '999.1110 anchor redraw test',
        timezone: 'America/New_York',
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  });

  beforeEach(() => {
    scheduleTrigger.enqueueScheduleRun.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async () => {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  });

  test('R5: editing next_start snaps a pattern-mismatched date, deletes not-yet-happened FUTURE pending instances, and NEVER touches done/skip instances', async () => {
    var tmplId = 'nsar-tmpl-' + Date.now();
    var doneId = tmplId + '-done';
    var skipId = tmplId + '-skip';
    var pendingFutureId = tmplId + '-pending-future';
    var pendingUnscheduledId = tmplId + '-pending-unscheduled';

    await seedMaster(tmplId);
    // past DONE instance — must survive the redraw untouched (pencil-not-pen).
    await seedInstance(tmplId, doneId, {
      status: 'done', date: '2026-01-05',
      scheduled_at: new Date('2026-01-05T14:00:00Z'),
      completed_at: new Date('2026-01-05T14:30:00Z')
    });
    // past SKIP instance — must also survive untouched.
    await seedInstance(tmplId, skipId, {
      status: 'skip', date: '2026-01-12', occurrence_ordinal: 2,
      scheduled_at: new Date('2026-01-12T14:00:00Z')
    });
    // pending, not-yet-happened, scheduled in the FUTURE — must be deleted.
    await seedInstance(tmplId, pendingFutureId, {
      status: '', date: '2030-01-05', occurrence_ordinal: 3,
      scheduled_at: new Date('2030-01-05T14:00:00Z')
    });
    // pending, never placed (scheduled_at NULL) — must also be deleted
    // (resetRecurringInstances treats a NULL scheduled_at as "future").
    await seedInstance(tmplId, pendingUnscheduledId, {
      status: '', date: '2030-01-12', occurrence_ordinal: 4, scheduled_at: null
    });

    // 2020-01-22 is a Wednesday; the master's pattern is Mondays-only ->
    // the backend must SNAP to 2020-01-27 (next Monday), never persist the
    // raw Wednesday (999.1110 "do not accept an arbitrary date").
    var req = mockReq({ params: { id: tmplId }, body: { nextStart: '2020-01-22' } });
    var res = mockRes();
    await controller.updateTask(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.task.nextStart).toBe('2020-01-27');

    var master = await db('task_masters').where('id', tmplId).first();
    expect(String(master.next_start).slice(0, 10)).toBe('2020-01-27');

    var remainingIds = (await db('task_instances').where('master_id', tmplId).pluck('id')).sort();
    expect(remainingIds).toEqual([doneId, skipId].sort());

    var survivingDone = await db('task_instances').where('id', doneId).first();
    expect(survivingDone.status).toBe('done');
    var survivingSkip = await db('task_instances').where('id', skipId).first();
    expect(survivingSkip.status).toBe('skip');

    // 999.1110 (harrison review item 6): never-missing is pinned by a test,
    // not by source inspection — next_start IS a scheduling field (task-
    // write-queue.js's NON_SCHEDULING_FIELDS denylist does not name it), so
    // hasSchedulingFields(row) is true and the anchor edit must resolve
    // skipScheduler:false, i.e. the redrawn/regenerated instances actually
    // get a schedule run (not just deleted-and-abandoned).
    await waitForDeferredScheduleTrigger();
    expect(scheduleTrigger.enqueueScheduleRun).toHaveBeenCalled();
    var triggerCall = scheduleTrigger.enqueueScheduleRun.mock.calls.find(function (c) {
      return c[0] === USER_ID && c[1] === 'api:updateTask';
    });
    expect(triggerCall).toBeTruthy();
  }, 15000);

  test('rolling recur type: the chosen date is persisted verbatim (no snap) and future pending instances are redrawn', async () => {
    var tmplId = 'nsar-roll-tmpl-' + Date.now();
    var pendingFutureId = tmplId + '-pending-future';

    await seedMaster(tmplId, {
      recur: JSON.stringify({ type: 'rolling', every: 7, unit: 'days' }),
      recur_start: null, next_start: '2020-01-01'
    });
    await seedInstance(tmplId, pendingFutureId, {
      status: '', date: '2030-01-05',
      scheduled_at: new Date('2030-01-05T14:00:00Z')
    });

    var req = mockReq({ params: { id: tmplId }, body: { nextStart: '2020-01-22' } }); // arbitrary Wednesday
    var res = mockRes();
    await controller.updateTask(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.task.nextStart).toBe('2020-01-22');

    var master = await db('task_masters').where('id', tmplId).first();
    expect(String(master.next_start).slice(0, 10)).toBe('2020-01-22');

    var remaining = await db('task_instances').where('master_id', tmplId).pluck('id');
    expect(remaining).toEqual([]);
  });
});
