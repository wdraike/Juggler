/**
 * W3 DB-backed test — two-mode import dispatcher (facade.importData → dispatchImport).
 *
 * Exercises mode routing + fail-safe resolution + schema validation ordering over the
 * REAL test-bed DB (3407), asserting ZERO DB writes on every 400 path:
 *   - unknown mode (?mode=xyz)            → 400 "Invalid import mode", zero writes
 *   - absent mode + no confirm            → 400 "DELETE all existing", zero writes
 *   - absent mode + ?confirm=delete_all   → REPLACE 200, body.mode === 'replace'
 *   - ?mode=merge (no confirm)            → MERGE 200, body.mode === 'merge'
 *   - ?mode=replace (no confirm)          → 400 "DELETE all existing", zero writes
 *   - schema-invalid (extraTasks string)  → 400 "Validation failed", zero writes
 *   - missing extraTasks                  → 400 "Invalid import data" (shape guard FIRST)
 *
 * "Zero writes" is proven by seeding an existing task + an existing project and
 * asserting they are untouched and no rows were added by the rejected call.
 *
 * Requires: cd test-bed && make test-juggler (DB at 127.0.0.1:3407, juggler_test).
 *
 * Traceability: WBS Wave-2 W3 (mode routing + fail-safe + schema validation).
 */

'use strict';

var db = require('../../../../src/db');
var tasksWrite = require('../../../../src/lib/tasks-write');
var facade = require('../../../../src/slices/user-config/facade');
var { assertDbAvailable } = require('../../../helpers/requireDB');

// Mock scheduleQueue so seeding/inserting tasks never kicks the scheduler.
jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'import-routing-test-user-001';
var available = false;

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del();
  await db('tools').where('user_id', USER_ID).del();
}

// Seed a single existing task + project; return a probe of current row counts so a
// later assertion can prove a rejected call wrote NOTHING.
async function seedExisting() {
  await tasksWrite.insertTask(db, { id: 'seed-1', user_id: USER_ID, text: 'Seed task', dur: 30, pri: 'P3' });
  await db('projects').insert({ user_id: USER_ID, name: 'SeedProject', color: '#abc', icon: null, sort_order: 0, created_at: db.fn.now(), updated_at: db.fn.now() });
}

async function snapshot() {
  var masters = Number((await db('task_masters').where('user_id', USER_ID).count('* as c').first()).c);
  var projects = Number((await db('projects').where('user_id', USER_ID).count('* as c').first()).c);
  var config = Number((await db('user_config').where('user_id', USER_ID).count('* as c').first()).c);
  return { masters: masters, projects: projects, config: config };
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'routing@test.com', name: 'Routing Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 20000);

afterAll(async () => {
  if (available) {
    await cleanup();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await cleanup();
});

var VALID_BODY = { extraTasks: [{ id: 'imp-1', text: 'Imported', dur: 30, pri: 'P2' }] };

test('unknown mode (?mode=xyz) → 400 "Invalid import mode", ZERO DB writes', async () => {
  await assertDbAvailable();
  await seedExisting();
  var before = await snapshot();

  var res = await facade.importData({
    userId: USER_ID, mode: 'xyz', confirm: 'delete_all',
    timezoneHeader: 'America/New_York', data: VALID_BODY
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Invalid import mode 'xyz'/);
  expect(res.body.error).toMatch(/expected 'merge' or 'replace'/);

  var after = await snapshot();
  expect(after).toEqual(before); // ZERO writes — seed untouched, nothing added/wiped
}, 30000);

test('absent mode + no confirm → 400 "DELETE all existing", ZERO DB writes', async () => {
  await assertDbAvailable();
  await seedExisting();
  var before = await snapshot();

  var res = await facade.importData({
    userId: USER_ID, /* mode absent */ /* confirm absent */
    timezoneHeader: 'America/New_York', data: VALID_BODY
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/DELETE all existing/);

  var after = await snapshot();
  expect(after).toEqual(before);
}, 30000);

test('absent mode + ?confirm=delete_all → REPLACE 200, body.mode === replace', async () => {
  await assertDbAvailable();
  await seedExisting();

  var res = await facade.importData({
    userId: USER_ID, confirm: 'delete_all',
    timezoneHeader: 'America/New_York', data: VALID_BODY
  });

  expect(res.status).toBe(200);
  expect(res.body.message).toMatch(/Import successful/);
  expect(res.body.mode).toBe('replace');
  expect(res.body.counts).toMatchObject({ tasks: 1, duplicatesRemoved: 0 });

  // REPLACE wiped the seed and re-inserted only the import → exactly 1 task, seed gone.
  var masters = await db('task_masters').where('user_id', USER_ID).select('id');
  expect(masters.map(function (m) { return m.id; })).toEqual(['imp-1']);
}, 30000);

test('?mode=merge (no confirm) → MERGE 200, body.mode === merge', async () => {
  await assertDbAvailable();
  await seedExisting();

  var res = await facade.importData({
    userId: USER_ID, mode: 'merge', /* no confirm */
    timezoneHeader: 'America/New_York', data: VALID_BODY
  });

  expect(res.status).toBe(200);
  expect(res.body.mode).toBe('merge');
  expect(res.body.counts.tasks).toBe(1);
  expect(res.body.counts).toHaveProperty('tasksRekeyed');

  // MERGE is additive — seed kept, import appended → 2 tasks total.
  var ids = (await db('task_masters').where('user_id', USER_ID).select('id')).map(function (m) { return m.id; }).sort();
  expect(ids).toEqual(['imp-1', 'seed-1']);
}, 30000);

test('?mode=replace + no confirm → 400 "DELETE all existing", ZERO DB writes', async () => {
  await assertDbAvailable();
  await seedExisting();
  var before = await snapshot();

  var res = await facade.importData({
    userId: USER_ID, mode: 'replace', /* no confirm */
    timezoneHeader: 'America/New_York', data: VALID_BODY
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/DELETE all existing/);

  var after = await snapshot();
  expect(after).toEqual(before);
}, 30000);

test('schema-invalid body (extraTasks is a string) → 400 "Validation failed", ZERO DB writes', async () => {
  await assertDbAvailable();
  await seedExisting();
  var before = await snapshot();

  // extraTasks is truthy (passes the legacy shape guard) but NOT an array → the W1
  // schema must reject it AFTER the shape+mode guards, before any DB work.
  var res = await facade.importData({
    userId: USER_ID, mode: 'merge',
    timezoneHeader: 'America/New_York',
    data: { extraTasks: 'not-an-array' }
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Validation failed');
  expect(Array.isArray(res.body.details)).toBe(true);
  expect(res.body.details.length).toBeGreaterThan(0);

  var after = await snapshot();
  expect(after).toEqual(before);
}, 30000);

test('missing extraTasks → 400 "Invalid import data" (shape guard fires FIRST)', async () => {
  await assertDbAvailable();
  await seedExisting();
  var before = await snapshot();

  // Even with a valid mode + confirm, the shape guard wins (preserves H2-6 message).
  var res = await facade.importData({
    userId: USER_ID, mode: 'replace', confirm: 'delete_all',
    timezoneHeader: 'America/New_York',
    data: { notExtraTasks: [] }
  });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Invalid import data/);

  var after = await snapshot();
  expect(after).toEqual(before);
}, 30000);
