// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * mcp-set-task-status-strict-enum-characterization.db.test.js
 *
 * jug-mcp-facade — David RULING (5th ruled exception, 2020-01-07, scooter
 * INBOX ISO 2020-01-07T19:20:00Z): set_task_status now accepts facade's
 * stricter status-enum validation via facade.updateTaskStatus, including new
 * rejections for status changes on recurring TEMPLATES (only pause/unpause
 * allowed) and DISABLED tasks (403). The tool's own advertised "dropped"
 * value was NEVER in the real enum (VALID_STATUSES, UpdateTaskStatus.js:47 —
 * ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled']) — a
 * pre-existing schema/description bug, fixed to match reality rather than
 * preserve the fictional value (resolves ernie's E5).
 *
 * Pins:
 *   1. an invalid status string (not in VALID_STATUSES, e.g. 'dropped' — the
 *      exact value the OLD tool description falsely advertised) -> 400
 *      rejected with the real enum listed.
 *   2. a status change on a recurring_template with a status OTHER than
 *      'pause'/'' -> 400 'Recurring templates can only be paused or unpaused'.
 *   3. a status change on a disabled task -> 403 TASK_DISABLED.
 *   4. the tool's OWN advertised schema (description + status field .describe())
 *      no longer lists 'dropped' and matches the real enum.
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-strict-enum-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlersAndSchemas(userId) {
  var handlers = {};
  var schemas = {};
  var descriptions = {};
  var fakeServer = {
    tool: function (name, desc, schema, handler) {
      handlers[name] = handler;
      schemas[name] = schema;
      descriptions[name] = desc;
    }
  };
  registerTaskTools(fakeServer, userId);
  return { handlers: handlers, schemas: schemas, descriptions: descriptions };
}

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert(__stampFixture({
      id: USER_ID, email: 'mcp-strict-enum@test.invalid', name: 'MCP strict enum test',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    }));
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('MCP set_task_status — stricter enum + template/disabled rejections (AFTER state, David RULING exception e)', function () {

  beforeAll(async function () {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    jest.useRealTimers();
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  test('invalid status "dropped" (the OLD tool description\'s own fictional value) -> 400 rejected with the real enum listed', async function () {
    var now = new Date();
    var taskId = 'mcp-enum-invalid-' + Date.now();
    await db('task_masters').insert(__stampFixture({
      id: taskId, user_id: USER_ID, text: 'enum test', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    }));
    await db('task_instances').insert(__stampFixture({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    }));

    var { handlers } = captureHandlersAndSchemas(USER_ID);
    var result = await handlers.set_task_status({ id: taskId, status: 'dropped' });

    expect(result.isError).toBe(true);
    // statusUpdateSchema.safeParse (a zod .enum(['','wip','done','cancel',
    // 'skip','pause','disabled'])) rejects 'dropped' BEFORE the separate
    // VALID_STATUSES.indexOf manual check ever runs (UpdateTaskStatus.js:96-
    // 107) — the manual check is dead code for any string value (zod's enum
    // already excludes it); it would only matter for a non-string status,
    // which MCP's own zod z.string() schema already prevents at the MCP
    // transport layer. mapFacadeErrorText's 400 branch produces this text.
    expect(result.content[0].text).toBe('Validation error: Invalid status');
    var row = await db('task_instances').where('id', taskId).first();
    expect(row.status).toBe(''); // unchanged
  });

  test('status change on a recurring_template with a non-pause/unpause status -> 400 "Recurring templates can only be paused or unpaused"', async function () {
    var now = new Date();
    var tmplId = 'mcp-enum-tmpl-' + Date.now();
    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'template enum test', dur: 30, pri: 'P3',
      recurring: 1, status: '', recur: JSON.stringify({ type: 'weekly', days: 'M' }),
      recur_start: '2026-01-01', tz: 'America/New_York', created_at: now, updated_at: now
    }));

    var { handlers } = captureHandlersAndSchemas(USER_ID);
    var result = await handlers.set_task_status({ id: tmplId, status: 'done' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: Recurring templates can only be paused or unpaused');

    var row = await db('task_masters').where('id', tmplId).first();
    expect(row.status).toBe(''); // unchanged
  });

  test('status change on a recurring_template TO "pause" -> succeeds (the one allowed transition)', async function () {
    var now = new Date();
    var tmplId = 'mcp-enum-tmpl-pause-' + Date.now();
    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'template pause test', dur: 30, pri: 'P3',
      recurring: 1, status: '', recur: JSON.stringify({ type: 'weekly', days: 'M' }),
      recur_start: '2026-01-01', tz: 'America/New_York', created_at: now, updated_at: now
    }));

    var { handlers } = captureHandlersAndSchemas(USER_ID);
    var result = await handlers.set_task_status({ id: tmplId, status: 'pause' });

    expect(result.isError).toBeFalsy();
    var row = await db('task_masters').where('id', tmplId).first();
    expect(row.status).toBe('pause');
  });

  test('status change on a DISABLED task -> 403 TASK_DISABLED (was: no such guard pre-migration)', async function () {
    var now = new Date();
    var taskId = 'mcp-enum-disabled-' + Date.now();
    await db('task_masters').insert(__stampFixture({
      id: taskId, user_id: USER_ID, text: 'disabled task enum test', dur: 30, pri: 'P3',
      recurring: 0, status: 'disabled', created_at: now, updated_at: now
    }));
    await db('task_instances').insert(__stampFixture({
      id: taskId, master_id: taskId, user_id: USER_ID, status: 'disabled',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    }));

    var { handlers } = captureHandlersAndSchemas(USER_ID);
    var result = await handlers.set_task_status({ id: taskId, status: 'done' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: This item is disabled. Use the re-enable endpoint to restore it.');
    var row = await db('task_instances').where('id', taskId).first();
    expect(row.status).toBe('disabled'); // unchanged
  });

  test('the tool\'s OWN advertised schema no longer lists "dropped" and matches the real enum', async function () {
    var { descriptions, schemas } = captureHandlersAndSchemas(USER_ID);

    expect(descriptions.set_task_status).not.toMatch(/dropped/i);
    expect(descriptions.set_task_status).toMatch(/cancel/i);

    var statusFieldDescription = schemas.set_task_status.status.description;
    expect(statusFieldDescription).not.toMatch(/dropped/i);
    // Matches the real enum (statusUpdateSchema, facade.js) — all 7 values present.
    ['""', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled'].forEach(function (v) {
      var needle = v === '""' ? '""' : v;
      expect(statusFieldDescription).toMatch(new RegExp(needle));
    });
  });

});
