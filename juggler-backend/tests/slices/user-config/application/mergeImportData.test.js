// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../../src/lib/audit-context').stampInsert(rows);
/**
 * W2 DB-backed test — MergeImportData (two-mode import, Wave 1).
 *
 * Non-destructive ("merge") import over the REAL test-bed DB (3407): seeds a user
 * with existing tasks + a project/location/tool, runs merge with an import body that
 *   (a) has a NEW task,
 *   (b) a task whose id collides with an existing task,
 *   (c) a project/location/tool NAME that collides,
 *   (d) different settings values,
 * then asserts:
 *   - existing rows UNCHANGED (no overwrite, no delete),
 *   - the new task added,
 *   - the colliding task added under a NEW fabricated id (tasksRekeyed >= 1),
 *   - colliding names appended as "<name> (2)",
 *   - settings NOT changed (KEEP-MINE — Brain decision #59583),
 *   - zero deletes.
 *
 * Requires: cd test-bed && make test-juggler (DB at 127.0.0.1:3407, juggler_test).
 *
 * Traceability: WBS Wave-1 W2; Brain decision #59583 (merge keep-mine settings).
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

var USER_ID = 'merge-import-test-user-001';
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

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').where('id', USER_ID).del();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'merge@test.com', name: 'Merge Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  }));
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

test('merge is additive: keeps existing rows, re-keys colliding tasks, renames colliding names, keeps settings', async () => {
  await assertDbAvailable();

  // ── SEED existing state ────────────────────────────────────────────────────
  // Existing tasks: one whose id the import will collide with ('existing-1'), one
  // standalone ('existing-2').
  await tasksWrite.insertTask(db, { id: 'existing-1', user_id: USER_ID, text: 'My existing task ONE', dur: 30, pri: 'P2' });
  await tasksWrite.insertTask(db, { id: 'existing-2', user_id: USER_ID, text: 'My existing task TWO', dur: 30, pri: 'P3' });

  // Existing project / location / tool — names the import will collide with.
  await db('projects').insert(__stampFixture({ user_id: USER_ID, name: 'Work', color: '#abc', icon: null, sort_order: 0, created_at: db.fn.now(), updated_at: db.fn.now() }));
  await db('locations').insert(__stampFixture({ user_id: USER_ID, location_id: 'loc-home', name: 'Home', icon: '🏠', sort_order: 0, created_at: db.fn.now(), updated_at: db.fn.now() }));
  await db('tools').insert(__stampFixture({ user_id: USER_ID, tool_id: 'tool-laptop', name: 'Laptop', icon: '💻', sort_order: 0, created_at: db.fn.now(), updated_at: db.fn.now() }));

  // Existing settings the import must NOT change (KEEP-MINE).
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'preferences', config_value: JSON.stringify({ gridZoom: 45 }), created_at: db.fn.now(), updated_at: db.fn.now() }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify({ mine: true }), created_at: db.fn.now(), updated_at: db.fn.now() }));

  var mastersBefore = await db('task_masters').where('user_id', USER_ID).count('* as c').first();
  expect(Number(mastersBefore.c)).toBe(2);

  // ── RUN merge ──────────────────────────────────────────────────────────────
  var res = await facade.mergeImportData({
    userId: USER_ID,
    timezoneHeader: 'America/New_York',
    data: {
      extraTasks: [
        { id: 'new-1', text: 'A brand new task', dur: 30, pri: 'P1' },       // (a) NEW
        { id: 'existing-1', text: 'Imported clash task', dur: 60, pri: 'P4' } // (b) id collision
      ],
      projects: [{ name: 'Work', color: '#zzz' }],                            // (c) name collision
      locations: [{ id: 'loc-import', name: 'Home', icon: '🏡' }],           // (c) name collision
      tools: [{ id: 'tool-import', name: 'Laptop', icon: '🖥️' }],            // (c) name collision
      // (d) different settings values — merge must IGNORE these (keep-mine).
      gridZoom: 99,
      toolMatrix: { theirs: true },
      statuses: { 'existing-1': 'done' }
    }
  });

  // ── ASSERT response shape + counts ─────────────────────────────────────────
  expect(res.status).toBe(200);
  expect(res.body.mode).toBe('merge');
  expect(res.body.counts.tasks).toBe(2);          // both imported tasks ADDED
  expect(res.body.counts.tasksRekeyed).toBe(1);   // 'existing-1' clash re-keyed
  expect(res.body.counts.projects).toBe(1);
  expect(res.body.counts.locations).toBe(1);
  expect(res.body.counts.tools).toBe(1);

  // ── ASSERT tasks: existing untouched, new added, clash re-keyed ────────────
  var masters = await db('task_masters').where('user_id', USER_ID).select('id', 'text');
  var byId = {};
  masters.forEach(function (m) { byId[m.id] = m.text; });
  // existing rows unchanged
  expect(byId['existing-1']).toBe('My existing task ONE'); // NOT overwritten by the import's clash task
  expect(byId['existing-2']).toBe('My existing task TWO');
  // new task added under its own id
  expect(byId['new-1']).toBe('A brand new task');
  // the clash task was re-keyed (NOT inserted under 'existing-1', NOT skipped)
  var rekeyed = masters.filter(function (m) { return m.text === 'Imported clash task'; });
  expect(rekeyed).toHaveLength(1);
  expect(rekeyed[0].id).not.toBe('existing-1');
  expect(rekeyed[0].id).toMatch(/^existing-1-imported-/);
  // total masters = 2 existing + 2 imported = 4 (zero deletes)
  expect(masters).toHaveLength(4);

  // ── ASSERT projects/locations/tools: existing kept, collision renamed "(2)" ─
  var projects = await db('projects').where('user_id', USER_ID).select('name', 'color');
  var projectNames = projects.map(function (p) { return p.name; }).sort();
  expect(projectNames).toEqual(['Work', 'Work (2)']);
  // original 'Work' untouched (color still '#abc'); the import's '#zzz' went to 'Work (2)'
  var originalWork = projects.find(function (p) { return p.name === 'Work'; });
  expect(originalWork.color).toBe('#abc');

  var locations = await db('locations').where('user_id', USER_ID).select('name', 'location_id');
  var locationNames = locations.map(function (l) { return l.name; }).sort();
  expect(locationNames).toEqual(['Home', 'Home (2)']);
  var originalHome = locations.find(function (l) { return l.name === 'Home'; });
  expect(originalHome.location_id).toBe('loc-home'); // existing untouched

  var tools = await db('tools').where('user_id', USER_ID).select('name', 'tool_id');
  var toolNames = tools.map(function (t) { return t.name; }).sort();
  expect(toolNames).toEqual(['Laptop', 'Laptop (2)']);
  var originalLaptop = tools.find(function (t) { return t.name === 'Laptop'; });
  expect(originalLaptop.tool_id).toBe('tool-laptop'); // existing untouched

  // ── ASSERT settings KEEP-MINE: user_config untouched, no new rows ──────────
  var configRows = await db('user_config').where('user_id', USER_ID).select('config_key', 'config_value');
  expect(configRows).toHaveLength(2); // still exactly preferences + tool_matrix, none added
  var cfg = {};
  configRows.forEach(function (r) { cfg[r.config_key] = typeof r.config_value === 'string' ? JSON.parse(r.config_value) : r.config_value; });
  expect(cfg.preferences).toEqual({ gridZoom: 45 });  // NOT 99
  expect(cfg.tool_matrix).toEqual({ mine: true });    // NOT { theirs: true }
}, 30000);

// ── WARN-1 FIX: assert duplicatesRemoved for a within-import duplicate id ────
// The import body carries two entries with the same id ('dup-task-1'). The merge
// engine dedupes them to one (last-wins), so duplicatesRemoved must be 1. The
// surviving task is the LAST definition (text = 'Dup task SECOND'). Mutating
// duplicatesRemoved to 999 in the engine would make this assertion fail.
test('WARN-1: duplicatesRemoved reflects within-import id duplicates; last-wins definition survives', async () => {
  await assertDbAvailable();

  // No pre-existing tasks for this user (beforeEach cleanup ran).
  var mastersBefore = await db('task_masters').where('user_id', USER_ID).count('* as c').first();
  expect(Number(mastersBefore.c)).toBe(0);

  var res = await facade.mergeImportData({
    userId: USER_ID,
    timezoneHeader: 'America/New_York',
    data: {
      extraTasks: [
        { id: 'dup-task-1', text: 'Dup task FIRST',  dur: 15, pri: 'P3' }, // first def
        { id: 'dup-task-1', text: 'Dup task SECOND', dur: 30, pri: 'P2' }, // second def — wins
        { id: 'unique-task', text: 'A unique task',  dur: 20, pri: 'P1' }  // no dup
      ]
    }
  });

  expect(res.status).toBe(200);
  expect(res.body.mode).toBe('merge');
  // 2 unique tasks after dedup (3 - 1 duplicate), both inserted
  expect(res.body.counts.tasks).toBe(2);
  // ONE duplicate was removed (the FIRST definition of 'dup-task-1')
  expect(res.body.counts.duplicatesRemoved).toBe(1);
  // No id collision with existing rows — nothing was re-keyed
  expect(res.body.counts.tasksRekeyed).toBe(0);

  // Verify only 2 rows inserted and the last-wins definition is the one present
  var masters = await db('task_masters').where('user_id', USER_ID).select('id', 'text');
  expect(masters).toHaveLength(2);
  var byId = {};
  masters.forEach(function (m) { byId[m.id] = m.text; });
  // last-wins: the SECOND definition (text='Dup task SECOND') must be the one inserted
  expect(byId['dup-task-1']).toBe('Dup task SECOND');
  expect(byId['unique-task']).toBe('A unique task');
  // first definition must NOT appear (no extra row with 'Dup task FIRST')
  var firstDef = masters.filter(function (m) { return m.text === 'Dup task FIRST'; });
  expect(firstDef).toHaveLength(0);
}, 30000);

// ── WARN-2 FIX: second-suffix path — -imported-2 and (3) — tasksRekeyed === 2 ─
// Seeds existing tasks 'existing-1' AND 'existing-1-imported-1' (the first-suffix
// form) plus 'existing-2'. Imports two tasks: one with id 'existing-1' (whose
// fabricated first candidate 'existing-1-imported-1' is ALREADY taken, so it must
// advance to 'existing-1-imported-2') and one with id 'existing-2' (gets
// 'existing-2-imported-1'). Both are re-keyed → tasksRekeyed === 2.
// Also seeds existing projects 'Work' and 'Work (2)' and imports a project named
// 'Work' — the first suffix '(2)' is taken so it must advance to 'Work (3)'.
// All final ids/names must be unique.
test('WARN-2: second-suffix increment — -imported-2 and (3) forms; tasksRekeyed === 2', async () => {
  await assertDbAvailable();

  // ── SEED: three existing tasks, two existing projects ────────────────────────
  // existing-1 + existing-1-imported-1: forces second increment for any new task
  // whose id is 'existing-1' (candidate '-imported-1' is taken → must use '-imported-2')
  await tasksWrite.insertTask(db, { id: 'existing-1',           user_id: USER_ID, text: 'Existing ONE',           dur: 30, pri: 'P2' });
  await tasksWrite.insertTask(db, { id: 'existing-1-imported-1', user_id: USER_ID, text: 'Existing ONE import-1', dur: 20, pri: 'P3' });
  await tasksWrite.insertTask(db, { id: 'existing-2',           user_id: USER_ID, text: 'Existing TWO',           dur: 25, pri: 'P2' });

  // Projects 'Work' and 'Work (2)' already exist → import of 'Work' must go to 'Work (3)'
  await db('projects').insert(__stampFixture({ user_id: USER_ID, name: 'Work',    color: '#111', icon: null, sort_order: 0, created_at: db.fn.now(), updated_at: db.fn.now() }));
  await db('projects').insert(__stampFixture({ user_id: USER_ID, name: 'Work (2)', color: '#222', icon: null, sort_order: 1, created_at: db.fn.now(), updated_at: db.fn.now() }));

  var mastersBefore = await db('task_masters').where('user_id', USER_ID).count('* as c').first();
  expect(Number(mastersBefore.c)).toBe(3);

  // ── RUN merge ────────────────────────────────────────────────────────────────
  var res = await facade.mergeImportData({
    userId: USER_ID,
    timezoneHeader: 'America/New_York',
    data: {
      extraTasks: [
        { id: 'existing-1', text: 'Import clashes with existing-1', dur: 30, pri: 'P1' },
        { id: 'existing-2', text: 'Import clashes with existing-2', dur: 15, pri: 'P2' }
      ],
      projects: [{ name: 'Work', color: '#333' }]
    }
  });

  expect(res.status).toBe(200);
  expect(res.body.mode).toBe('merge');
  // Both imported tasks were added (counts.tasks = 2)
  expect(res.body.counts.tasks).toBe(2);
  // BOTH tasks were re-keyed
  expect(res.body.counts.tasksRekeyed).toBe(2);
  // One project appended (as 'Work (3)')
  expect(res.body.counts.projects).toBe(1);

  // ── ASSERT tasks: all ids unique; second collision got -imported-2 form ──────
  var masters = await db('task_masters').where('user_id', USER_ID).select('id', 'text');
  // total = 3 existing + 2 imported
  expect(masters).toHaveLength(5);

  var ids = masters.map(function (m) { return m.id; }).sort();
  var uniqueIds = Array.from(new Set(ids)).sort();
  // All ids are unique (no duplicates)
  expect(ids).toEqual(uniqueIds);

  var byId = {};
  masters.forEach(function (m) { byId[m.id] = m.text; });

  // Existing rows untouched
  expect(byId['existing-1']).toBe('Existing ONE');
  expect(byId['existing-1-imported-1']).toBe('Existing ONE import-1');
  expect(byId['existing-2']).toBe('Existing TWO');

  // Import of 'existing-1': candidate '-imported-1' was taken → MUST be '-imported-2'
  expect(byId['existing-1-imported-2']).toBe('Import clashes with existing-1');

  // Import of 'existing-2': '-imported-1' is available → standard first increment
  expect(byId['existing-2-imported-1']).toBe('Import clashes with existing-2');

  // ── ASSERT projects: 'Work (3)' is the appended name ─────────────────────────
  var projects = await db('projects').where('user_id', USER_ID).select('name', 'color');
  var projectNames = projects.map(function (p) { return p.name; }).sort();
  expect(projectNames).toEqual(['Work', 'Work (2)', 'Work (3)']);

  // Confirm existing 'Work' is untouched (color still '#111')
  var originalWork = projects.find(function (p) { return p.name === 'Work'; });
  expect(originalWork.color).toBe('#111');

  // The import's 'Work' entry landed at 'Work (3)' (color '#333')
  var appendedWork = projects.find(function (p) { return p.name === 'Work (3)'; });
  expect(appendedWork.color).toBe('#333');
}, 30000);
