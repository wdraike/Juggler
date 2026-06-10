/**
 * W5 — application use-cases against the REAL KnexTaskRepository (test-bed @3407).
 *
 * Proves the SAME orchestration the InMemory suite exercises also runs end-to-end
 * against the real master/instance write path + tasks_v read-back (W3 KnexTaskRepository
 * over lib/tasks-write), with P1 (new Date()) timestamps persisted. This is the
 * "test against BOTH repos" requirement + the W3 fidelity note: the use-case reads
 * a column back off the Knex surface (fetchTaskWithEventIds → tasks_v), not the
 * InMemory over-store.
 *
 * Fail-loud per TEST-FR-001: requires test-bed; never silently skips.
 *
 * Traceability: WBS W5 (e) characterization against the DB; (c) P1 persisted.
 */

'use strict';

process.env.NODE_ENV = 'test';

var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('../../../helpers/requireDB');
var KnexTaskRepository = require('../../../../src/slices/task/adapters/KnexTaskRepository');
var CreateTask = require('../../../../src/slices/task/application/commands/CreateTask');
var UpdateTask = require('../../../../src/slices/task/application/commands/UpdateTask');
var UpdateTaskStatus = require('../../../../src/slices/task/application/commands/UpdateTaskStatus');
var ListTasks = require('../../../../src/slices/task/application/queries/ListTasks');
var GetTask = require('../../../../src/slices/task/application/queries/GetTask');
var H = require('./_helpers');
var { z } = require('zod');

var knex = require('knex')(require('../../../../knexfile.js').test);
var USER = 'w5-db-user';

var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled', 'missed']),
  completedAt: z.string().optional()
}).passthrough();

function repo() { return new KnexTaskRepository({ db: knex }); }

function createDeps(r, trigger, events, extra) {
  return H.baseDeps(Object.assign({
    repo: r, cache: H.makeCacheFake(), events: events || H.makeEventsSpy(),
    enqueueScheduleRun: trigger || H.makeTriggerSpy(),
    uuidv7: uuidv7
  }, extra || {}));
}

describe('W5 use-cases — DB-backed (KnexTaskRepository, test-bed @3407)', function () {
  beforeAll(async function () {
    await assertDbAvailable();
    await knex('task_instances').where('user_id', USER).del();
    await knex('task_masters').where('user_id', USER).del();
    await knex('users').where('id', USER).del();
    await knex('users').insert({
      id: USER, email: USER + '@w5.test', name: USER,
      created_at: new Date(), updated_at: new Date()
    });
  });

  afterAll(async function () {
    await knex('task_instances').where('user_id', USER).del();
    await knex('task_masters').where('user_id', USER).del();
    await knex('cal_sync_ledger').where('user_id', USER).del();
    await knex('users').where('id', USER).del();
    await knex.destroy();
  });

  beforeEach(async function () {
    await knex('task_instances').where('user_id', USER).del();
    await knex('task_masters').where('user_id', USER).del();
  });

  test('CreateTask writes master+instance, read-back from tasks_v, P1 Dates persisted', async function () {
    var trigger = H.makeTriggerSpy();
    var events = H.makeEventsSpy();
    var uc = new CreateTask(createDeps(repo(), trigger, events));
    var out = await uc.execute({ userId: USER, body: { text: 'db-created', pri: 'P1', dur: 45 }, timezoneHeader: 'America/New_York' });
    expect(out.status).toBe(201);
    var id = out.body.task.id;
    expect(out.body.task.text).toBe('db-created');
    expect(out.body.task.pri).toBe('P1');

    // master + instance rows exist (W3 fidelity: read off the Knex surface)
    var master = await knex('task_masters').where('id', id).first();
    var instance = await knex('task_instances').where('id', id).first();
    expect(master).toBeTruthy();
    expect(instance).toBeTruthy();
    // P1: persisted created_at/updated_at are real datetimes, not fn.now() raws
    expect(master.created_at).toBeTruthy();
    expect(master.updated_at).toBeTruthy();

    // orchestration side-effects
    expect(trigger.calls.length).toBe(1);
    expect(trigger.calls[0].source).toBe('api:createTask');
    expect(events.published[0].type).toBe('created');
  });

  test('GetTask + ListTasks read the created task back through tasks_v', async function () {
    var uc = new CreateTask(createDeps(repo(), H.makeTriggerSpy(), H.makeEventsSpy()));
    var created = await uc.execute({ userId: USER, body: { text: 'readme', pri: 'P2' } });
    var id = created.body.task.id;

    var getUc = new GetTask({ repo: repo(), mappers: H.mappers });
    var got = await getUc.execute({ id: id, userId: USER });
    expect(got.status).toBe(200);
    expect(got.body.task.text).toBe('readme');

    var listUc = new ListTasks({ repo: repo(), cache: H.makeCacheFake(), mappers: H.mappers });
    var list = await listUc.execute({ userId: USER, query: {} });
    var ids = list.tasks.map(function (t) { return t.id; });
    expect(ids).toContain(id);
    expect(list.version).toMatch(/:\d+$/);
  });

  test('UpdateTask FAST PATH edits a field and persists with a repo-stamped Date updated_at (P1)', async function () {
    var createUc = new CreateTask(createDeps(repo(), H.makeTriggerSpy(), H.makeEventsSpy()));
    var created = await createUc.execute({ userId: USER, body: { text: 'before', pri: 'P3' } });
    var id = created.body.task.id;
    var masterBefore = await knex('task_masters').where('id', id).first();

    var trigger = H.makeTriggerSpy();
    var updUc = new UpdateTask(H.baseDeps({
      repo: repo(), cache: H.makeCacheFake(), events: H.makeEventsSpy(),
      enqueueScheduleRun: trigger, recurCleanup: function () { return Promise.resolve(); }
    }));
    var out = await updUc.execute({ id: id, userId: USER, body: { text: 'after', pri: 'P1' } });
    expect(out.status).toBe(200);
    expect(out.body.task.text).toBe('after');

    var masterAfter = await knex('task_masters').where('id', id).first();
    expect(masterAfter.text).toBe('after');
    expect(masterAfter.pri).toBe('P1');
    // updated_at advanced (repo wrote new Date(), not fn.now())
    expect(new Date(masterAfter.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(masterBefore.updated_at).getTime());
    expect(trigger.calls[0].source).toBe('api:updateTask');
  });

  test('UpdateTaskStatus done persists completed_at as a real datetime (P1)', async function () {
    var createUc = new CreateTask(createDeps(repo(), H.makeTriggerSpy(), H.makeEventsSpy()));
    // create with a past scheduled_at so the terminal-requires-schedule guard passes
    var created = await createUc.execute({
      userId: USER,
      body: { text: 'to-complete', scheduledAt: '2026-06-01T15:00:00Z' }
    });
    var id = created.body.task.id;

    var events = H.makeEventsSpy();
    var trigger = H.makeTriggerSpy();
    var stUc = new UpdateTaskStatus(H.baseDeps({
      repo: repo(), cache: H.makeCacheFake(), events: events, enqueueScheduleRun: trigger,
      statusUpdateSchema: statusUpdateSchema,
      materializeRcInstance: function () { return Promise.resolve(null); },
      handleTemplatePause: function () { return Promise.resolve([]); },
      loadMaster: function () { return Promise.resolve(null); },
      isRollingMaster: function () { return false; },
      applyRollingAnchor: function () { return Promise.resolve(); },
      loadSplitSiblings: function () { return Promise.resolve([]); },
      triggerCalSync: { sync: function () {} },
      reactivateDoneFrozen: function () { return Promise.resolve(); }
    }));
    var out = await stUc.execute({ id: id, userId: USER, body: { status: 'done' } });
    expect(out.status).toBe(200);
    expect(out.body.task.status).toBe('done');

    var instance = await knex('task_instances').where('id', id).first();
    expect(instance.completed_at).toBeTruthy(); // real datetime, P1
    expect(events.published[0].type).toBe('completed');
    expect(trigger.calls[0].source).toBe('api:updateTaskStatus');
  });
});
