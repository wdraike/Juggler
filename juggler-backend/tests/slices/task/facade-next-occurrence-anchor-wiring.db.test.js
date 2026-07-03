/**
 * facade-next-occurrence-anchor-wiring.db.test.js
 *
 * Telly-authored coverage-gap closure (999.1091 C1, deep-leg completeness floor —
 * mutation testing not wired in this service, so changed-region branch enumeration
 * is the fallback per TEST-AUTHORING.md §Completeness floor).
 *
 * Gap found: `nextOccurrenceAnchor.test.js` fully pins the PURE function
 * `computeNextOccurrenceAnchor`, and `tasks_v_rolling_and_next_occurrence_anchor.
 * regression.test.js` fully pins the VIEW PROJECTION of a manually-seeded column
 * value — but the actual WRITE WIRING this leg added, `facade.js`'s
 * `applyRollingAnchor` `isPatternRecurMaster` branch (L545-558: read master ->
 * compute -> UPDATE task_masters.next_occurrence_anchor), was never driven end to
 * end through the real controller/DB path. Every command-level test that
 * exercises `updateTaskStatus` fakes `applyRollingAnchor` away entirely
 * (`applyRollingAnchor: function () { return Promise.resolve(); }` — see
 * `commands-status-delete-misc.test.js`, `terminal-schedule-snap.db.test.js`).
 * `applyRollingAnchor` itself is a private facade.js function (not in
 * module.exports) — the ONE place it IS exercised for real is
 * `facade.collaborators.db.test.js`'s "Block H" (rolling-master branch, via the
 * real controller), which asserts only "no 500", not the written value. This
 * file is the isPatternRecurMaster-branch sibling of Block H, modeled on its
 * exact real-controller-DB pattern, WITH an actual value assertion (stronger
 * than Block H's own bar).
 *
 * mcp/tools/tasks.js L447-456 has the identical branch/gap (same guard, same
 * compute+persist shape) — not separately pinned here (would be a near-
 * duplicate of this file); flagged as a residual WARN in TEST-CATALOG.md rather
 * than authored, to keep this leg's added test surface proportional.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../src/db');
var { assertDbAvailable } = require('../../helpers/requireDB');
var USER_ID = 'facade-noa-wiring-001';

// Same core mocks as the established facade.collaborators.db.test.js pattern —
// isolate the non-DB infra (scheduler timer, redis, SSE) so ONLY the real DB
// read/write path (KnexTaskRepository + applyRollingAnchor) is exercised.
jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
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
    status: function(code) { res.statusCode = code; return res; },
    json: function(data) { res._json = data; return res; }
  };
  return res;
}

async function seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId,
    user_id: USER_ID,
    text: 'weekly (non-rolling) master — anchor wiring test',
    dur: 30,
    pri: 'P3',
    recurring: 1,
    status: '',
    recur: JSON.stringify({ type: 'weekly', days: 'W' }),
    recur_start: '2026-01-01',
    rolling_anchor: null,
    next_occurrence_anchor: null,
    created_at: now,
    updated_at: now
  });
  await db('task_instances').insert({
    id: instId,
    master_id: tmplId,
    user_id: USER_ID,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    date: instanceDate,
    scheduled_at: scheduledAt,
    created_at: now,
    updated_at: now
  });
}

describe('facade.updateTaskStatus -> applyRollingAnchor isPatternRecurMaster wiring (999.1091 C1)', () => {

  beforeAll(async () => {
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert({
        id: USER_ID,
        email: 'facade-noa-wiring@test.invalid',
        name: 'facade noa wiring test',
        timezone: 'America/New_York',
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  });

  afterEach(async () => {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async () => {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  });

  test('marking a weekly (non-rolling) recurring instance done WRITES next_occurrence_anchor via the real controller->facade->applyRollingAnchor path', async () => {
    var tmplId = 'noa-wiring-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08'; // Wednesday
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var req = mockReq({ params: { id: instId }, body: { status: 'done' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);

    expect(res.statusCode).toBe(200);

    var master = await db('task_masters').where('id', tmplId).first();
    expect(master).toBeTruthy();
    // The actual VALUE assertion (stronger than the sibling rolling-branch
    // Block H test in facade.collaborators.db.test.js, which only checks for
    // "no 500"): next_occurrence_anchor must advance to the next Wednesday,
    // proving the real applyRollingAnchor branch read the master, computed via
    // computeNextOccurrenceAnchor, and persisted the result — not just that the
    // request didn't crash.
    expect(String(master.next_occurrence_anchor).slice(0, 10)).toBe('2026-07-15');
    // rolling_anchor branch must NOT have fired for a non-rolling master.
    expect(master.rolling_anchor).toBeNull();
  });

  test('marking a weekly (non-rolling) recurring instance skip advances the anchor the same as done', async () => {
    var tmplId = 'noa-wiring-tmpl2-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var req = mockReq({ params: { id: instId }, body: { status: 'skip' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);

    expect(res.statusCode).toBe(200);
    var master = await db('task_masters').where('id', tmplId).first();
    expect(String(master.next_occurrence_anchor).slice(0, 10)).toBe('2026-07-15');
  });

  test('marking a weekly (non-rolling) recurring instance cancel does NOT write next_occurrence_anchor', async () => {
    var tmplId = 'noa-wiring-tmpl3-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var req = mockReq({ params: { id: instId }, body: { status: 'cancel' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);

    expect(res.statusCode).toBe(200);
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.next_occurrence_anchor).toBeNull();
  });
});
