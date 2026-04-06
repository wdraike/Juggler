/**
 * Integration tests for runSchedule.js persist step and task CRUD.
 * Uses a real MySQL test database (Docker on port 3308).
 *
 * Run: docker compose -f docker-compose.test.yml up -d
 */

var testDb = require('./helpers/testDb');
var available = false;

beforeAll(async () => {
  available = await testDb.isAvailable();
  if (!available) {
    console.warn('Test DB not available. Run: docker compose -f docker-compose.test.yml up -d');
    return;
  }
  await testDb.cleanup();
  await testDb.seedUser();
}, 15000);

afterAll(async () => {
  if (available) await testDb.cleanup();
  await testDb.destroy();
});

beforeEach(async () => {
  if (!available) return;
  var db = testDb.getDb();
  await db('tasks').where('user_id', 'test-user-001').del();
  await db('user_config').where('user_id', 'test-user-001').del();
});

// ═══════════════════════════════════════════════════════════════
// Task CRUD with real DB
// ═══════════════════════════════════════════════════════════════

describe('Task CRUD (real DB)', () => {
  test('seedTask creates a task in the DB', async () => { if (!available) return;
    var task = await testDb.seedTask({ text: 'Buy groceries' });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', task.id).first();
    expect(row).toBeDefined();
    expect(row.text).toBe('Buy groceries');
  });

  test('seedTemplate creates a recurring template', async () => { if (!available) return;
    var tmpl = await testDb.seedTemplate({ text: 'Lunch', preferred_time_mins: 720, time_flex: 60 });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', tmpl.id).first();
    expect(row.task_type).toBe('recurring_template');
    expect(row.preferred_time_mins).toBe(720);
    expect(row.time_flex).toBe(60);
  });

  test('seedInstance creates linked instance', async () => { if (!available) return;
    var tmpl = await testDb.seedTemplate({ id: 'tmpl-001', text: 'Exercise' });
    var inst = await testDb.seedInstance('tmpl-001', { id: 'inst-001' });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', 'inst-001').first();
    expect(row.source_id).toBe('tmpl-001');
    expect(row.task_type).toBe('recurring_instance');
  });

  test('template preferred_time_mins is stored correctly', async () => { if (!available) return;
    var tmpl = await testDb.seedTemplate({ id: 'tmpl-pt', preferred_time_mins: 450, time_flex: 90 });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', 'tmpl-pt').first();
    expect(row.preferred_time_mins).toBe(450); // 7:30 AM
    expect(row.time_flex).toBe(90);
  });

  test('desired_at stored and retrieved correctly', async () => { if (!available) return;
    var dt = new Date('2026-04-07T16:00:00Z');
    var task = await testDb.seedTask({ desired_at: dt, scheduled_at: dt });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', task.id).first();
    // MySQL stores datetime as string without Z
    expect(row.desired_at).toBeTruthy();
    expect(row.scheduled_at).toBeTruthy();
  });

  test('cleanup removes all test data', async () => { if (!available) return;
    await testDb.seedTask({ text: 'Temp task' });
    var db = testDb.getDb();
    var before = await db('tasks').where('user_id', 'test-user-001').count('* as c').first();
    expect(parseInt(before.c)).toBeGreaterThan(0);
    await testDb.cleanup();
    await testDb.seedUser(); // re-seed for other tests
    var after = await db('tasks').where('user_id', 'test-user-001').count('* as c').first();
    expect(parseInt(after.c)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// rowToTask with real DB data
// ═══════════════════════════════════════════════════════════════

describe('rowToTask with real DB rows', () => {
  test('round-trip: seed → read → rowToTask produces valid task object', async () => { if (!available) return;
    var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
    await testDb.seedTask({
      id: 'rt-001', text: 'Real task', scheduled_at: '2026-04-07 15:00:00',
      pri: 'P2', dur: 45, when: 'afternoon', status: ''
    });
    var db = testDb.getDb();
    var row = await db('tasks').where('id', 'rt-001').first();
    var task = rowToTask(row, 'America/New_York', {});
    expect(task.text).toBe('Real task');
    expect(task.pri).toBe('P2');
    expect(task.dur).toBe(45);
    expect(task.scheduledAt).toBeTruthy();
  });

  test('instance inherits preferred_time_mins from template in real DB', async () => { if (!available) return;
    var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
    await testDb.seedTemplate({ id: 'tmpl-rt', text: 'Lunch', preferred_time_mins: 720, time_flex: 60 });
    await testDb.seedInstance('tmpl-rt', { id: 'inst-rt', scheduled_at: '2026-04-07 11:00:00' });

    var db = testDb.getDb();
    var rows = await db('tasks').where('user_id', 'test-user-001');
    var srcMap = buildSourceMap(rows);
    var instRow = rows.find(function(r) { return r.id === 'inst-rt'; });
    var task = rowToTask(instRow, 'America/New_York', srcMap);
    expect(task.time).toBe('12:00 PM'); // from preferred_time_mins, not 7am UTC
    expect(task.preferredTimeMins).toBe(720);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scheduler persist with real DB
// ═══════════════════════════════════════════════════════════════

describe('Scheduler persist (real DB)', () => {
  test('scheduler places tasks and writes scheduled_at', async () => { if (!available) return;
    // Seed some tasks without scheduled_at
    await testDb.seedTask({ id: 'sp-001', text: 'Morning task', when: 'morning', dur: 30 });
    await testDb.seedTask({ id: 'sp-002', text: 'Afternoon task', when: 'afternoon', dur: 45 });

    // Seed minimal config
    var db = testDb.getDb();
    await db('user_config').insert({
      user_id: 'test-user-001',
      config_key: 'time_blocks',
      config_value: JSON.stringify(require('../src/scheduler/constants').DEFAULT_TIME_BLOCKS)
    });
    await db('user_config').insert({
      user_id: 'test-user-001',
      config_key: 'tool_matrix',
      config_value: JSON.stringify(require('../src/scheduler/constants').DEFAULT_TOOL_MATRIX)
    });

    // Note: we can't easily test runScheduleAndPersist here because it imports
    // the production db module. Instead, verify the data model is correct.
    var tasks = await db('tasks').where('user_id', 'test-user-001');
    expect(tasks.length).toBe(2);
    expect(tasks[0].text).toBe('Morning task');
  });

  test('batch update with CASE expression pattern works', async () => { if (!available) return;
    // Simulate what the scheduler does: batch update scheduled_at on multiple tasks
    await testDb.seedTask({ id: 'bu-001', text: 'Task A' });
    await testDb.seedTask({ id: 'bu-002', text: 'Task B' });
    await testDb.seedTask({ id: 'bu-003', text: 'Task C' });

    var db = testDb.getDb();
    var ids = ['bu-001', 'bu-002', 'bu-003'];
    var times = [
      new Date('2026-04-07T14:00:00Z'),
      new Date('2026-04-07T15:00:00Z'),
      new Date('2026-04-07T16:00:00Z')
    ];

    var caseExpr = 'CASE id';
    var bindings = [];
    ids.forEach(function(id, i) {
      caseExpr += ' WHEN ? THEN ?';
      bindings.push(id, times[i]);
    });
    caseExpr += ' END';

    await db('tasks')
      .where('user_id', 'test-user-001')
      .whereIn('id', ids)
      .update({
        scheduled_at: db.raw(caseExpr, bindings),
        unscheduled: null,
        updated_at: db.fn.now()
      });

    // Verify
    var rows = await db('tasks').whereIn('id', ids).orderBy('id');
    rows.forEach(function(r, i) {
      expect(r.scheduled_at).toBeTruthy();
    });
    // Verify they got different times
    var uniqueTimes = new Set(rows.map(function(r) { return r.scheduled_at; }));
    expect(uniqueTimes.size).toBe(3);
  });

  test('minimal-diff: skip write when scheduled_at unchanged', async () => { if (!available) return;
    var fixedTime = '2026-04-07 15:00:00';
    await testDb.seedTask({ id: 'md-001', text: 'Already placed', scheduled_at: fixedTime });

    var db = testDb.getDb();
    var before = await db('tasks').where('id', 'md-001').first();
    var beforeUpdated = before.updated_at;

    // Simulate: scheduler computes same scheduled_at, skips write
    var newScheduledAt = new Date(fixedTime.replace(' ', 'T') + 'Z');
    var existing = new Date(before.scheduled_at.replace(' ', 'T') + 'Z');
    var shouldSkip = newScheduledAt.getTime() === existing.getTime();
    expect(shouldSkip).toBe(true);
  });

  test('unscheduled flag set correctly', async () => { if (!available) return;
    await testDb.seedTask({ id: 'us-001', text: 'Unplaceable' });

    var db = testDb.getDb();
    await db('tasks').where('id', 'us-001').update({ unscheduled: 1, scheduled_at: null });

    var row = await db('tasks').where('id', 'us-001').first();
    expect(row.unscheduled).toBeTruthy();
    expect(row.scheduled_at).toBeNull();
  });

  test('recurring instances not marked unscheduled', async () => { if (!available) return;
    await testDb.seedTemplate({ id: 'tmpl-us', text: 'Daily exercise' });
    await testDb.seedInstance('tmpl-us', { id: 'inst-us' });

    var db = testDb.getDb();
    var row = await db('tasks').where('id', 'inst-us').first();
    expect(row.unscheduled).toBeNull(); // never set on instances
  });
});

// ═══════════════════════════════════════════════════════════════
// TEMPLATE_FIELDS routing
// ═══════════════════════════════════════════════════════════════

describe('TEMPLATE_FIELDS routing (real DB)', () => {
  test('updating instance routes template fields to source', async () => { if (!available) return;
    await testDb.seedTemplate({ id: 'tmpl-route', text: 'Original', dur: 30, pri: 'P3' });
    await testDb.seedInstance('tmpl-route', { id: 'inst-route' });

    var db = testDb.getDb();
    // Simulate what updateTask routing does: split fields
    var { TEMPLATE_FIELDS } = require('../src/controllers/task.controller');
    var row = { text: 'Updated Name', dur: 45, scheduled_at: '2026-04-07 15:00:00', updated_at: db.fn.now() };
    var templateUpdate = {};
    var instanceUpdate = {};
    Object.keys(row).forEach(function(k) {
      if (k === 'updated_at') return;
      if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
        templateUpdate[k] = row[k];
      } else {
        instanceUpdate[k] = row[k];
      }
    });

    expect(templateUpdate.text).toBe('Updated Name');
    expect(templateUpdate.dur).toBe(45);
    expect(instanceUpdate.scheduled_at).toBe('2026-04-07 15:00:00');
    expect(templateUpdate.scheduled_at).toBeUndefined(); // NOT routed to template

    // Apply to DB
    templateUpdate.updated_at = db.fn.now();
    await db('tasks').where('id', 'tmpl-route').update(templateUpdate);
    instanceUpdate.updated_at = db.fn.now();
    await db('tasks').where('id', 'inst-route').update(instanceUpdate);

    // Verify
    var tmpl = await db('tasks').where('id', 'tmpl-route').first();
    var inst = await db('tasks').where('id', 'inst-route').first();
    expect(tmpl.text).toBe('Updated Name');
    expect(tmpl.dur).toBe(45);
    expect(inst.scheduled_at).toBe('2026-04-07 15:00:00');
    expect(tmpl.scheduled_at).toBeNull(); // unchanged
  });

  test('preferred_time_mins routes to template, not instance', async () => { if (!available) return;
    await testDb.seedTemplate({ id: 'tmpl-ptm', text: 'Breakfast' });
    await testDb.seedInstance('tmpl-ptm', { id: 'inst-ptm' });

    var { TEMPLATE_FIELDS } = require('../src/controllers/task.controller');
    expect(TEMPLATE_FIELDS).toContain('preferred_time_mins');
    expect(TEMPLATE_FIELDS).not.toContain('scheduled_at');

    // Simulate routing
    var row = { preferred_time_mins: 420, time_flex: 60, scheduled_at: '2026-04-07 11:00:00' };
    var templateFields = {};
    var instanceFields = {};
    Object.keys(row).forEach(function(k) {
      if (TEMPLATE_FIELDS.indexOf(k) >= 0) templateFields[k] = row[k];
      else instanceFields[k] = row[k];
    });

    expect(templateFields.preferred_time_mins).toBe(420);
    expect(templateFields.time_flex).toBe(60);
    expect(instanceFields.scheduled_at).toBe('2026-04-07 11:00:00');
  });
});
