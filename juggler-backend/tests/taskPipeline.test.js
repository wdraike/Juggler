/**
 * Task Pipeline Tests
 *
 * Tests the full DB-row → rowToTask → scheduler pipeline that production uses.
 * Covers: UTC derivation, template field inheritance, midnight fallback,
 * terminal status clamping, null handling, and the round-trip from
 * DB rows through the scheduler and back.
 *
 * These tests exercise the code paths that synthetic-task tests miss:
 * the rowToTask() derivation layer is the bridge between DB storage and
 * scheduler input, and bugs here (like the lunch-at-midnight issue)
 * are invisible to algorithm-only tests.
 */

// Mock DB module (task.controller requires it for db.fn.now())
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  mock.transaction = (cb) => cb(mock);
  mock.where = () => mock;
  mock.first = () => Promise.resolve(null);
  mock.select = () => Promise.resolve([]);
  mock.insert = () => Promise.resolve([]);
  mock.update = () => Promise.resolve(0);
  return mock;
});

const { rowToTask, taskToRow, buildSourceMap } = require('../src/controllers/task.controller');
const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TZ = 'America/New_York';

// Minimal DB row factory — mirrors actual MySQL row shape
function makeRow(overrides) {
  return {
    id: 'test_' + Math.random().toString(36).slice(2, 8),
    task_type: 'task',
    user_id: 'user1',
    text: 'Test Task',
    scheduled_at: new Date('2026-04-04T14:00:00Z'), // 10:00 AM ET
    original_scheduled_at: null,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    status: '',
    section: null,
    notes: '',
    due_at: null,
    start_after_at: null,
    location: '[]',
    tools: '[]',
    when: '',
    day_req: 'any',
    recurring: 0,
    rigid: 0,
    time_flex: null,
    split: 0,
    split_min: null,
    recur: null,
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    travel_before: null,
    travel_after: null,
    tz: null,
    recur_start: null,
    recur_end: null,
    disabled_at: null,
    disabled_reason: null,
    prev_when: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  };
}

function makeTemplateRow(overrides) {
  return makeRow({
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    ...overrides
  });
}

function makeInstanceRow(templateId, overrides) {
  return makeRow({
    task_type: 'recurring_instance',
    recurring: 1,
    source_id: templateId,
    generated: 0,
    ...overrides
  });
}

function makeCfg(overrides) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. rowToTask UTC Derivation
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: UTC derivation', () => {
  test('derives date/time/day from scheduled_at with timezone', () => {
    var row = makeRow({ scheduled_at: new Date('2026-04-04T14:00:00Z') }); // 10:00 AM ET
    var task = rowToTask(row, TZ, {});
    expect(task.date).toBe('4/4');
    expect(task.time).toBe('10:00 AM');
    expect(task.day).toBe('Sat');
  });

  test('returns null date/time when scheduled_at is null', () => {
    var row = makeRow({ scheduled_at: null });
    var task = rowToTask(row, TZ, {});
    expect(task.date).toBeNull();
    expect(task.time).toBeNull();
  });

  test('skips derivation when timezone is null (API mode)', () => {
    var row = makeRow({ scheduled_at: new Date('2026-04-04T14:00:00Z') });
    var task = rowToTask(row, null, {});
    // When tz is null, date/time are not derived from scheduled_at
    expect(task.date).toBeNull();
    expect(task.time).toBeNull();
    // But scheduledAt is still passed through
    expect(task.scheduledAt).toBeTruthy();
  });

  test('derives due from due_at DATE column', () => {
    var row = makeRow({ due_at: '2026-04-10' });
    var task = rowToTask(row, TZ, {});
    expect(task.due).toBe('4/10');
    expect(task.dueAt).toBeTruthy();
  });

  test('derives startAfter from start_after_at', () => {
    var row = makeRow({ start_after_at: '2026-04-06' });
    var task = rowToTask(row, TZ, {});
    expect(task.startAfter).toBe('4/6');
  });

  test('handles null due_at and start_after_at', () => {
    var row = makeRow({ due_at: null, start_after_at: null });
    var task = rowToTask(row, TZ, {});
    expect(task.due).toBeNull();
    expect(task.startAfter).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Template Field Inheritance
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: template field inheritance', () => {
  test('recurring instance inherits all TEMPLATE_FIELDS from source', () => {
    var template = makeTemplateRow({
      id: 'ht_test',
      text: 'Template Text',
      dur: 45,
      pri: 'P1',
      project: 'TestProject',
      when: 'morning',
      day_req: 'weekday',
      time_flex: 90,
      location: '["home"]',
      tools: '["phone"]',
      rigid: 0,
      split: 1,
      split_min: 30,
      flex_when: 1,
      notes: 'Template notes',
    });
    var instance = makeInstanceRow('ht_test', {
      id: 'rc_ht_test_44',
      text: 'Instance Text',  // will be overwritten by template
      dur: 30,                // will be overwritten
      pri: 'P4',             // will be overwritten
      when: null,             // will be inherited
      time_flex: null,        // will be inherited
      scheduled_at: new Date('2026-04-04T14:00:00Z'),
    });
    var srcMap = {}; srcMap['ht_test'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.text).toBe('Template Text');
    expect(task.dur).toBe(45);
    expect(task.pri).toBe('P1');
    expect(task.project).toBe('TestProject');
    expect(task.when).toBe('morning');
    expect(task.dayReq).toBe('weekday');
    expect(task.timeFlex).toBe(90);
    expect(task.split).toBe(true);
    expect(task.flexWhen).toBe(true);
  });

  test('disabled instance does NOT inherit template fields', () => {
    var template = makeTemplateRow({ id: 'ht_dis', text: 'New Name', dur: 60 });
    var instance = makeInstanceRow('ht_dis', {
      id: 'rc_dis_44',
      text: 'Old Name',
      dur: 30,
      status: 'disabled',
      scheduled_at: new Date('2026-04-04T14:00:00Z'),
    });
    var srcMap = {}; srcMap['ht_dis'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.text).toBe('Old Name');  // NOT inherited
    expect(task.dur).toBe(30);           // NOT inherited
  });

  test('instance with missing source in srcMap does not crash', () => {
    var instance = makeInstanceRow('nonexistent', {
      id: 'rc_missing_44',
      scheduled_at: new Date('2026-04-04T14:00:00Z'),
    });
    var task = rowToTask(instance, TZ, {});
    expect(task.id).toBe('rc_missing_44');
    expect(task.text).toBe('Test Task'); // keeps own field
  });

  test('null sourceMap does not crash', () => {
    var instance = makeInstanceRow('src1', { id: 'rc_null_44' });
    var task = rowToTask(instance, TZ, null);
    expect(task.id).toBe('rc_null_44');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Midnight Fallback for Recurring Instances
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: template preferred time override', () => {
  test('instance always gets time from template (not from stale scheduled_at)', () => {
    var template = makeTemplateRow({
      id: 'ht_lunch',
      scheduled_at: new Date('2026-02-21T17:00:00Z'), // 12:00 PM ET
      when: 'lunch',
      time_flex: 60,
    });
    var instance = makeInstanceRow('ht_lunch', {
      id: 'rc_lunch_44',
      scheduled_at: new Date('2026-04-04T04:00:00Z'), // midnight ET (scheduler cleared)
    });
    var srcMap = {}; srcMap['ht_lunch'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.time).toBe('12:00 PM');  // fell back to template
    expect(task.date).toBe('4/4');       // date from instance (correct day)
  });

  test('instance at midnight stays midnight when template is also midnight', () => {
    var template = makeTemplateRow({
      id: 'ht_mid',
      scheduled_at: new Date('2026-02-21T05:00:00Z'), // midnight ET
    });
    var instance = makeInstanceRow('ht_mid', {
      id: 'rc_mid_44',
      scheduled_at: new Date('2026-04-04T04:00:00Z'), // midnight ET
    });
    var srcMap = {}; srcMap['ht_mid'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.time).toBe('12:00 AM'); // both midnight, stays midnight
  });

  test('instance at midnight stays midnight when no sourceMap', () => {
    var instance = makeInstanceRow('ht_none', {
      id: 'rc_none_44',
      scheduled_at: new Date('2026-04-04T04:00:00Z'),
    });
    var task = rowToTask(instance, TZ, {});
    expect(task.time).toBe('12:00 AM'); // no source to fall back to
  });

  test('instance with stale scheduler time gets template time instead', () => {
    // The scheduler previously placed lunch at 7am (stale). Template says noon.
    // rowToTask should use the template's noon, not the stale 7am.
    var template = makeTemplateRow({
      id: 'ht_stale',
      scheduled_at: new Date('2026-02-21T17:00:00Z'), // 12:00 PM ET
      when: 'lunch',
      time_flex: 60,
    });
    var instance = makeInstanceRow('ht_stale', {
      id: 'rc_stale_44',
      scheduled_at: new Date('2026-04-04T11:00:00Z'), // 7:00 AM ET (scheduler's old placement)
    });
    var srcMap = {}; srcMap['ht_stale'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.time).toBe('12:00 PM');  // template time, NOT 7:00 AM
  });

  test('instance at midnight stays midnight when source has null scheduled_at', () => {
    var template = makeTemplateRow({ id: 'ht_nullsa', scheduled_at: null });
    var instance = makeInstanceRow('ht_nullsa', {
      id: 'rc_nullsa_44',
      scheduled_at: new Date('2026-04-04T04:00:00Z'),
    });
    var srcMap = {}; srcMap['ht_nullsa'] = template;
    var task = rowToTask(instance, TZ, srcMap);

    expect(task.time).toBe('12:00 AM');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Terminal Status Clamping
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: terminal status clamping', () => {
  test('done task with future scheduled_at is clamped to updated_at', () => {
    var pastUpdate = new Date(Date.now() - 3600000); // 1 hour ago
    var futureSchedule = new Date(Date.now() + 86400000); // tomorrow
    var row = makeRow({
      status: 'done',
      scheduled_at: futureSchedule,
      updated_at: pastUpdate,
    });
    var task = rowToTask(row, TZ, {});
    // scheduled_at should be clamped to updated_at (past), not future
    var sa = new Date(task.scheduledAt || row.scheduled_at);
    expect(sa.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('done task with past scheduled_at is not clamped', () => {
    var pastSchedule = new Date(Date.now() - 86400000);
    var row = makeRow({
      status: 'done',
      scheduled_at: pastSchedule,
      updated_at: new Date(),
    });
    var task = rowToTask(row, TZ, {});
    // Already in past, should not be changed
    expect(new Date(row.scheduled_at).getTime()).toBe(pastSchedule.getTime());
  });

  test('open task with future scheduled_at is NOT clamped', () => {
    var futureSchedule = new Date(Date.now() + 86400000);
    var row = makeRow({
      status: '',
      scheduled_at: futureSchedule,
    });
    var originalSa = row.scheduled_at.getTime();
    rowToTask(row, TZ, {});
    expect(row.scheduled_at.getTime()).toBe(originalSa);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. JSON Field Parsing
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: JSON field parsing', () => {
  test('parses JSON string location/tools/depends_on', () => {
    var row = makeRow({
      location: '["home","work"]',
      tools: '["phone","laptop"]',
      depends_on: '["task_1","task_2"]',
    });
    var task = rowToTask(row, TZ, {});
    expect(task.location).toEqual(['home', 'work']);
    expect(task.tools).toEqual(['phone', 'laptop']);
    expect(task.dependsOn).toEqual(['task_1', 'task_2']);
  });

  test('handles null JSON fields', () => {
    var row = makeRow({ location: null, tools: null, depends_on: null });
    var task = rowToTask(row, TZ, {});
    expect(task.location).toEqual([]);
    expect(task.tools).toEqual([]);
    expect(task.dependsOn).toEqual([]);
  });

  test('handles already-parsed arrays', () => {
    var row = makeRow({
      location: ['home'],
      tools: ['phone'],
      depends_on: ['t1'],
    });
    var task = rowToTask(row, TZ, {});
    expect(task.location).toEqual(['home']);
    expect(task.tools).toEqual(['phone']);
    expect(task.dependsOn).toEqual(['t1']);
  });

  test('handles empty string JSON fields', () => {
    var row = makeRow({ location: '', tools: '', depends_on: '' });
    var task = rowToTask(row, TZ, {});
    expect(task.location).toEqual([]);
    expect(task.tools).toEqual([]);
    expect(task.dependsOn).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Full Pipeline: rowToTask → scheduler
// ═══════════════════════════════════════════════════════════════════

describe('Full pipeline: rowToTask → scheduler', () => {
  test('recurring instance with template time schedules at correct flex window', () => {
    // Simulate: lunch template at noon, instance cleared to midnight by scheduler
    var template = makeTemplateRow({
      id: 'ht_lunch_pipe',
      text: 'Lunch',
      when: 'lunch',
      time_flex: 60,
      dur: 30,
      scheduled_at: new Date('2026-02-21T17:00:00Z'), // noon ET
    });
    var instance = makeInstanceRow('ht_lunch_pipe', {
      id: 'rc_lunch_pipe_44',
      date: '4/4',
      scheduled_at: new Date('2026-04-04T04:00:00Z'), // midnight ET
    });

    var srcMap = {}; srcMap['ht_lunch_pipe'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);

    // Verify time derived from template fallback
    expect(mapped.time).toBe('12:00 PM');
    expect(mapped.timeFlex).toBe(60);

    // Run through scheduler
    var cfg = makeCfg();
    var statuses = {}; statuses[mapped.id] = '';
    var result = unifiedSchedule([mapped], statuses, '4/4', 480, cfg); // 8am

    // Should be placed near noon (flex 660-780), NOT at midnight or 11am
    var placed = [];
    Object.values(result.dayPlacements).forEach(function(day) {
      day.forEach(function(p) {
        if (p.task && p.task.id === 'rc_lunch_pipe_44') placed.push(p);
      });
    });

    expect(placed.length).toBe(1);
    expect(placed[0].start).toBeGreaterThanOrEqual(660); // 11:00 AM
    expect(placed[0].start).toBeLessThanOrEqual(780);    // 1:00 PM
  });

  test('breakfast recurring with template time at 7am, nowMins past flex → missed', () => {
    var template = makeTemplateRow({
      id: 'ht_bf_pipe',
      text: 'Eat Breakfast',
      when: 'morning',
      time_flex: 60,
      dur: 30,
      scheduled_at: new Date('2026-02-21T12:00:00Z'), // 7:00 AM ET
    });
    var instance = makeInstanceRow('ht_bf_pipe', {
      id: 'rc_bf_pipe_44',
      date: '4/4',
      scheduled_at: new Date('2026-04-04T04:00:00Z'), // midnight ET (cleared)
    });

    var srcMap = {}; srcMap['ht_bf_pipe'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);

    expect(mapped.time).toBe('7:00 AM');

    // Run scheduler at 9am — flex window [360,480] is entirely past
    var cfg = makeCfg();
    var statuses = {}; statuses[mapped.id] = '';
    var result = unifiedSchedule([mapped], statuses, '4/4', 540, cfg); // 9am

    // Should be missed (not placed)
    var placed = [];
    Object.values(result.dayPlacements).forEach(function(day) {
      day.forEach(function(p) {
        if (p.task && p.task.id === 'rc_bf_pipe_44') placed.push(p);
      });
    });
    expect(placed.length).toBe(0);

    // Should be in unplaced with reason=missed
    var missed = result.unplaced.find(function(t) { return t.id === 'rc_bf_pipe_44'; });
    expect(missed).toBeDefined();
    expect(missed._unplacedReason).toBe('missed');
  });

  test('non-recurring task with future scheduled_at places normally', () => {
    var row = makeRow({
      id: 'task_normal',
      scheduled_at: new Date('2026-04-04T18:00:00Z'), // 2:00 PM ET
      dur: 60,
      pri: 'P2',
    });
    var task = rowToTask(row, TZ, {});
    expect(task.date).toBe('4/4');
    expect(task.time).toBe('2:00 PM');

    var cfg = makeCfg();
    var statuses = {}; statuses[task.id] = '';
    var result = unifiedSchedule([task], statuses, '4/4', 480, cfg);

    var placed = [];
    Object.values(result.dayPlacements).forEach(function(day) {
      day.forEach(function(p) {
        if (p.task && p.task.id === 'task_normal') placed.push(p);
      });
    });
    expect(placed.length).toBe(1);
  });

  test('multiple recurring instances from same template all inherit correctly', () => {
    var template = makeTemplateRow({
      id: 'ht_multi',
      text: 'Exercise',
      when: 'evening',
      dur: 30,
      pri: 'P3',
      scheduled_at: new Date('2026-02-21T23:00:00Z'), // 6:00 PM ET
    });

    var instances = [4, 5, 6].map(function(day) {
      return makeInstanceRow('ht_multi', {
        id: 'rc_ht_multi_4' + day,
        date: '4/' + day,
        scheduled_at: new Date('2026-04-0' + day + 'T23:00:00Z'),
      });
    });

    var srcMap = {}; srcMap['ht_multi'] = template;
    var tasks = instances.map(function(r) { return rowToTask(r, TZ, srcMap); });

    tasks.forEach(function(t) {
      expect(t.text).toBe('Exercise');
      expect(t.when).toBe('evening');
      expect(t.dur).toBe(30);
      expect(t.pri).toBe('P3');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. taskToRow reverse mapping
// ═══════════════════════════════════════════════════════════════════

describe('taskToRow: reverse mapping', () => {
  test('converts date + time to scheduled_at via timezone', () => {
    var row = taskToRow({ date: '4/4', time: '2:00 PM' }, 'user1', TZ);
    expect(row.scheduled_at).toBeTruthy();
    // 2:00 PM ET = 6:00 PM UTC (EDT offset = -4)
    var sa = new Date(row.scheduled_at);
    expect(sa.getUTCHours()).toBe(18);
  });

  test('sets _pendingTimeOnly when only time provided', () => {
    var row = taskToRow({ time: '3:00 PM' }, 'user1', TZ);
    expect(row._pendingTimeOnly).toBe('3:00 PM');
    expect(row.scheduled_at).toBeUndefined();
  });

  test('handles null date gracefully', () => {
    var row = taskToRow({ date: null }, 'user1', TZ);
    expect(row.scheduled_at).toBeNull();
  });

  test('handles empty string date', () => {
    var row = taskToRow({ date: '' }, 'user1', TZ);
    // Empty string date should clear scheduled_at
    expect(row.scheduled_at === null || row.scheduled_at === undefined).toBe(true);
  });

  test('scheduledAt ISO takes precedence over date+time', () => {
    var row = taskToRow({
      date: '4/4', time: '2:00 PM',
      scheduledAt: '2026-04-05T20:00:00Z'  // different day+time
    }, 'user1', TZ);
    var sa = new Date(row.scheduled_at);
    expect(sa.getUTCDate()).toBe(5); // from scheduledAt, not date
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Drag-Pin Fields
// ═══════════════════════════════════════════════════════════════════

describe('rowToTask: drag-pin fields', () => {
  test('prevWhen is exposed from prev_when column', () => {
    var row = makeRow({ prev_when: 'morning', when: 'fixed' });
    var task = rowToTask(row, TZ, {});
    expect(task.prevWhen).toBe('morning');
    expect(task.when).toBe('fixed');
  });

  test('prevWhen is null when not drag-pinned', () => {
    var row = makeRow({ prev_when: null });
    var task = rowToTask(row, TZ, {});
    expect(task.prevWhen).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. buildSourceMap
// ═══════════════════════════════════════════════════════════════════

describe('buildSourceMap', () => {
  test('maps recurring templates by id', () => {
    var rows = [
      makeTemplateRow({ id: 'ht_a', text: 'A' }),
      makeTemplateRow({ id: 'ht_b', text: 'B' }),
      makeRow({ id: 'regular_task' }),
    ];
    var srcMap = buildSourceMap(rows);
    expect(srcMap['ht_a']).toBeDefined();
    expect(srcMap['ht_a'].text).toBe('A');
    expect(srcMap['ht_b']).toBeDefined();
    expect(srcMap['regular_task']).toBeUndefined();
  });

  test('empty rows returns empty map', () => {
    var srcMap = buildSourceMap([]);
    expect(Object.keys(srcMap).length).toBe(0);
  });
});
