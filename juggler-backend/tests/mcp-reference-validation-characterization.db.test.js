/**
 * mcp-reference-validation-characterization.db.test.js
 *
 * jug-mcp-facade — David RULING (6th ruled exception, 2026-07-07, scooter
 * INBOX ISO 2026-07-07T19:20:00Z): create_task/create_tasks/update_task
 * accept the facade's DB-backed reference-existence validation
 * (validateTaskReferences, 999.586, facade.js:181-228). The OLD MCP path
 * silently accepted dangling dependsOn/location/tools IDs — this now returns
 * a validation error when a referenced ID does not exist for the user
 * (resolves ernie's E6).
 *
 * Referenced tables:
 *   dependsOn -> task_masters.id (same user)
 *   location  -> locations.location_id (same user)
 *   tools     -> tools.tool_id (same user)
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-refval-001';

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
      id: USER_ID, email: 'mcp-refval@test.invalid', name: 'MCP reference validation test',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserData() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del().catch(function () {});
  await db('tools').where('user_id', USER_ID).del().catch(function () {});
}

describe('MCP reference-existence validation — dependsOn/location/tools (AFTER state, David RULING exception f)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    await clearUserData();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    await clearUserData();
  });

  afterAll(async function () {
    await clearUserData();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  test('create_task: dependsOn references a NON-EXISTENT task ID -> validation error, NO row written (was: silently accepted pre-migration)', async function () {
    var handlers = captureHandlers(USER_ID);
    var danglingId = 'does-not-exist-dep-' + Date.now();
    var result = await handlers.create_task({ text: 'Depends on nothing real', dependsOn: [danglingId] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Validation error: dependsOn references unknown task ID(s): ' + danglingId
    );

    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  test('create_task: dependsOn references an EXISTING task ID -> succeeds', async function () {
    var handlers = captureHandlers(USER_ID);
    var depResult = await handlers.create_task({ text: 'Dependency target' });
    var depBody = JSON.parse(depResult.content[0].text);

    var result = await handlers.create_task({ text: 'Depends on real task', dependsOn: [depBody.id] });
    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var deps = typeof body.dependsOn === 'string' ? JSON.parse(body.dependsOn) : body.dependsOn;
    expect(deps).toEqual([depBody.id]);
  });

  test('create_task: location references a NON-EXISTENT location ID -> validation error, NO row written', async function () {
    var handlers = captureHandlers(USER_ID);
    var danglingId = 'does-not-exist-loc-' + Date.now();
    var result = await handlers.create_task({ text: 'Bad location', location: [danglingId] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Validation error: location references unknown location ID(s): ' + danglingId
    );
    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  test('create_task: tools references a NON-EXISTENT tool ID -> validation error, NO row written', async function () {
    var handlers = captureHandlers(USER_ID);
    var danglingId = 'does-not-exist-tool-' + Date.now();
    var result = await handlers.create_task({ text: 'Bad tool', tools: [danglingId] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Validation error: tools references unknown tool ID(s): ' + danglingId
    );
    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  test('TELLY FINDING (asymmetry, not a ruled exception): create_tasks (batch) does NOT run the reference-existence check — a dangling dependsOn ID is SILENTLY ACCEPTED, unlike single-item create_task', async function () {
    // facade.batchCreateTasks -> BatchCreateTasks.js only runs the pure
    // validateTaskInput (shape check: is it an array of strings?) per item —
    // it never calls validateReferences (facade.js:181-228, the DB-backed
    // existence check CreateTask.js DOES call). This mirrors the exact same
    // asymmetry shape cookie's INFO-2 finding already flagged for recurStart
    // (create_task has the stricter facade-side check; create_tasks/
    // batch_update_tasks do not) — not one of David's named ruled exceptions,
    // so pinning REALITY rather than asserting the (absent) rejection.
    // REFER->cookie (design: is this asymmetry acceptable, matching the
    // recurStart precedent, or should BatchCreateTasks.js also call
    // validateReferences for HTTP-batch-create parity too).
    var handlers = captureHandlers(USER_ID);
    var danglingId = 'does-not-exist-batch-dep-' + Date.now();
    var result = await handlers.create_tasks({
      tasks: [
        { text: 'Good task' },
        { text: 'Bad task', dependsOn: [danglingId] }
      ]
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.created).toBe(2);
    var badRow = await db('task_masters').where('id', body.ids[1]).first();
    var deps = typeof badRow.depends_on === 'string' ? JSON.parse(badRow.depends_on || '[]') : (badRow.depends_on || []);
    expect(deps).toEqual([danglingId]); // dangling reference PERSISTED, unvalidated
  });

  test('update_task: dependsOn updated to reference a NON-EXISTENT task ID -> validation error, row UNCHANGED (was: silently accepted pre-migration)', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Task to update' });
    var createBody = JSON.parse(createResult.content[0].text);
    var danglingId = 'does-not-exist-upd-dep-' + Date.now();

    var result = await handlers.update_task({ id: createBody.id, dependsOn: [danglingId] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Validation error: dependsOn references unknown task ID(s): ' + danglingId
    );

    var row = await db('task_masters').where('id', createBody.id).first();
    var depsAfter = typeof row.depends_on === 'string' ? JSON.parse(row.depends_on || '[]') : (row.depends_on || []);
    expect(depsAfter).toEqual([]); // unchanged
  });

  test('update_task: dependsOn cleared to an empty array -> succeeds (empty array is valid, clears the field — not a dangling reference)', async function () {
    var handlers = captureHandlers(USER_ID);
    var depResult = await handlers.create_task({ text: 'Dependency target 2' });
    var depBody = JSON.parse(depResult.content[0].text);
    var createResult = await handlers.create_task({ text: 'Task with a real dep', dependsOn: [depBody.id] });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.update_task({ id: createBody.id, dependsOn: [] });
    expect(result.isError).toBeFalsy();

    var row = await db('task_masters').where('id', createBody.id).first();
    var depsAfter = typeof row.depends_on === 'string' ? JSON.parse(row.depends_on || '[]') : (row.depends_on || []);
    expect(depsAfter).toEqual([]);
  });

});
