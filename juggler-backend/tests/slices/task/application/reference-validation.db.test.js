/**
 * 999.586 — DB-backed JSON reference-field validation (depends_on / location /
 * tools) driven through the REAL controller → facade → validateTaskReferences
 * path against test-bed MySQL @3407.
 *
 * The facade's validateTaskReferences queries the user's task_masters / locations
 * / tools tables to confirm every referenced ID exists and belongs to the user.
 * These tests seed real rows, then assert:
 *   - create/update with a KNOWN ref → succeeds (no 400 from the ref check)
 *   - create/update with an UNKNOWN ref → 400 with a clear error
 *
 * Existence-only: cycle detection is OUT of scope (backlog 999.587).
 *
 * Fail-loud per TEST-FR-001: requires test-bed; never silently skips.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../../src/db');
var { assertDbAvailable } = require('../../../helpers/requireDB');

// Non-DB infrastructure mocks (mirror facade.collaborators.db.test.js).
jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));
jest.mock('../../../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  invalidateTasks: jest.fn().mockResolvedValue(true),
  invalidateConfig: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));

var controller = require('../../../../src/controllers/task.controller');

var USER = 'ref-val-db-user-001';

function mockReq(body, params) {
  return {
    user: { id: USER },
    headers: { 'x-timezone': 'America/New_York' },
    params: params || {},
    query: {},
    body: Object.assign({}, body)
  };
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

describe('999.586 — reference validation (DB, test-bed @3407)', function () {
  beforeAll(async function () {
    await assertDbAvailable();
    await db('task_instances').where('user_id', USER).del();
    await db('task_masters').where('user_id', USER).del();
    await db('locations').where('user_id', USER).del();
    await db('tools').where('user_id', USER).del();
    await db('users').where('id', USER).del();
    await db('users').insert({
      id: USER, email: USER + '@ref.test', name: USER,
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
    // Seed a configured location + tool + an existing dependency task.
    await db('locations').insert({
      user_id: USER, location_id: 'home', name: 'Home', sort_order: 0,
      created_at: new Date(), updated_at: new Date()
    });
    await db('tools').insert({
      user_id: USER, tool_id: 'phone', name: 'Phone', sort_order: 0,
      created_at: new Date(), updated_at: new Date()
    });
    await db('task_masters').insert({
      id: 'dep-existing', user_id: USER, text: 'dep target',
      status: '', created_at: new Date(), updated_at: new Date()
    });
  });

  afterAll(async function () {
    await db('task_instances').where('user_id', USER).del();
    await db('task_masters').where('user_id', USER).del();
    await db('locations').where('user_id', USER).del();
    await db('tools').where('user_id', USER).del();
    await db('users').where('id', USER).del();
    await db.destroy();
  });

  // ── CREATE ─────────────────────────────────────────────────────────────────

  test('create with KNOWN location + tool + dep → 201', async function () {
    var res = mockRes();
    await controller.createTask(mockReq({
      text: 'all refs valid',
      location: ['home'], tools: ['phone'], dependsOn: ['dep-existing']
    }), res);
    expect(res.statusCode).toBe(201);
  });

  test('create with UNKNOWN location → 400', async function () {
    var res = mockRes();
    await controller.createTask(mockReq({ text: 'bad loc', location: ['atlantis'] }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/location references unknown/i);
  });

  test('create with UNKNOWN tool → 400', async function () {
    var res = mockRes();
    await controller.createTask(mockReq({ text: 'bad tool', tools: ['jackhammer'] }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/tools references unknown/i);
  });

  test('create with UNKNOWN dependency → 400', async function () {
    var res = mockRes();
    await controller.createTask(mockReq({ text: 'bad dep', dependsOn: ['ghost-task'] }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/dependsOn references unknown/i);
  });

  test("create cannot reference ANOTHER user's location → 400", async function () {
    // Seed a location owned by a different user; this user must NOT see it.
    var OTHER = 'ref-val-other-user';
    await db('users').where('id', OTHER).del();
    await db('users').insert({ id: OTHER, email: OTHER + '@ref.test', name: OTHER, created_at: new Date(), updated_at: new Date() });
    await db('locations').insert({ user_id: OTHER, location_id: 'secret', name: 'Secret', sort_order: 0, created_at: new Date(), updated_at: new Date() });
    try {
      var res = mockRes();
      await controller.createTask(mockReq({ text: 'cross-tenant', location: ['secret'] }), res);
      expect(res.statusCode).toBe(400);
      expect(res._json.error).toMatch(/location references unknown/i);
    } finally {
      await db('locations').where('user_id', OTHER).del();
      await db('users').where('id', OTHER).del();
    }
  });

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  test('update with KNOWN location → 200', async function () {
    // create a plain task to update
    var c = mockRes();
    await controller.createTask(mockReq({ text: 'to-update' }), c);
    expect(c.statusCode).toBe(201);
    var id = c._json.task.id;

    var res = mockRes();
    await controller.updateTask(mockReq({ location: ['home'], tools: ['phone'] }, { id: id }), res);
    expect(res.statusCode).toBe(200);
  });

  test('update with UNKNOWN tool → 400', async function () {
    var c = mockRes();
    await controller.createTask(mockReq({ text: 'to-update-2' }), c);
    var id = c._json.task.id;

    var res = mockRes();
    await controller.updateTask(mockReq({ tools: ['nope-tool'] }, { id: id }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/tools references unknown/i);
  });
});
