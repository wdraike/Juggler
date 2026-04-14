/**
 * Unit tests for task.controller.js — focuses on mapping, validation,
 * time mode cleanup, preferred_time_mins, and TEMPLATE_FIELDS.
 */
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const { rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS } = require('../src/controllers/task.controller');
const TZ = 'America/New_York';

function makeRow(overrides) {
  return Object.assign({
    id: 'test-001', user_id: 'u1', task_type: 'task', text: 'Test',
    scheduled_at: null, desired_at: null, desired_date: null, tz: null,
    dur: 30, time_remaining: null, pri: 'P3', project: null, status: '',
    section: null, notes: null, due_at: null, start_after_at: null,
    location: '[]', tools: '[]', when: null, day_req: null,
    recurring: 0, rigid: 0, time_flex: null, split: null, split_min: null,
    recur: null, source_id: null, generated: 0,
    gcal_event_id: null, msft_event_id: null, depends_on: '[]',
    date_pinned: 0, marker: 0, flex_when: 0, prev_when: null,
    travel_before: null, travel_after: null,
    preferred_time_mins: null, unscheduled: null,
    recur_start: null, recur_end: null,
    disabled_at: null, disabled_reason: null,
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00'
  }, overrides);
}

function makeTemplate(overrides) {
  return makeRow(Object.assign({ task_type: 'recurring_template', recurring: 1 }, overrides));
}

function makeInstance(sourceId, overrides) {
  return makeRow(Object.assign({
    task_type: 'recurring_instance', recurring: 1, source_id: sourceId, generated: 0
  }, overrides));
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE_FIELDS
// ═══════════════════════════════════════════════════════════════

describe('TEMPLATE_FIELDS export', () => {
  test('is an array', () => {
    expect(Array.isArray(TEMPLATE_FIELDS)).toBe(true);
  });

  test('includes preferred_time_mins', () => {
    expect(TEMPLATE_FIELDS).toContain('preferred_time_mins');
  });

  test('does NOT include scheduled_at (instance-only field)', () => {
    expect(TEMPLATE_FIELDS).not.toContain('scheduled_at');
  });

  test('does NOT include desired_at (instance-only field)', () => {
    expect(TEMPLATE_FIELDS).not.toContain('desired_at');
  });

  test('includes all expected template fields', () => {
    var expected = ['text', 'dur', 'pri', 'project', 'when', 'day_req',
      'recurring', 'rigid', 'time_flex', 'split', 'split_min',
      'notes', 'marker', 'flex_when', 'preferred_time_mins'];
    expected.forEach(function(f) {
      expect(TEMPLATE_FIELDS).toContain(f);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// rowToTask: preferred_time_mins inheritance
// ═══════════════════════════════════════════════════════════════

describe('rowToTask: preferred_time_mins', () => {
  test('instance inherits time from template preferred_time_mins', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 720 }); // noon
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 11:00:00' }); // 7am UTC
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('12:00 PM');
    expect(task.preferredTimeMins).toBe(720);
  });

  test('instance inherits 7:00 AM from preferred_time_mins=420', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 420 });
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 16:00:00' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('7:00 AM');
  });

  test('instance uses own time when template has no preferred_time_mins', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: null });
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 15:00:00' }); // 11am ET
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('11:00 AM');
  });

  test('disabled instance does NOT inherit preferred_time_mins', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 720 });
    var inst = makeInstance('t1', { id: 'i1', status: 'disabled', scheduled_at: '2026-04-07 15:00:00' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('11:00 AM'); // own time, not 12:00 PM
  });

  test('midnight preferred_time_mins=0 produces 12:00 AM', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 0 });
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 15:00:00' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('12:00 AM');
  });

  test('preferred_time_mins with minutes (7:30 AM = 450)', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 450 });
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 15:00:00' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('7:30 AM');
  });

  test('preferred_time_mins 1080 = 6:00 PM', () => {
    var tmpl = makeTemplate({ id: 't1', preferred_time_mins: 1080 });
    var inst = makeInstance('t1', { id: 'i1', scheduled_at: '2026-04-07 15:00:00' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.time).toBe('6:00 PM');
  });
});

// ═══════════════════════════════════════════════════════════════
// rowToTask: template field inheritance
// ═══════════════════════════════════════════════════════════════

describe('rowToTask: template field inheritance', () => {
  test('instance inherits text, dur, pri, when from template', () => {
    var tmpl = makeTemplate({ id: 't1', text: 'Lunch', dur: 45, pri: 'P1', when: 'lunch' });
    var inst = makeInstance('t1', { id: 'i1' });
    var srcMap = { t1: tmpl };
    var task = rowToTask(inst, TZ, srcMap);
    expect(task.text).toBe('Lunch');
    expect(task.dur).toBe(45);
    expect(task.pri).toBe('P1');
    expect(task.when).toBe('lunch');
  });

  test('orphaned instance (missing source) warns but does not crash', () => {
    var inst = makeInstance('missing_tmpl', { id: 'i1' });
    var warn = jest.spyOn(console, 'warn').mockImplementation();
    var task = rowToTask(inst, TZ, {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Orphaned instance'));
    warn.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// rowToTask: terminal status clamping
// ═══════════════════════════════════════════════════════════════

describe('rowToTask: terminal status clamping', () => {
  test('done task with future scheduled_at gets clamped to now', () => {
    var future = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').replace('Z', '');
    var row = makeRow({ status: 'done', scheduled_at: future, updated_at: '2026-04-01 12:00:00' });
    var task = rowToTask(row, TZ, {});
    var sa = new Date(task.scheduledAt);
    expect(sa.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('done task with past scheduled_at is not clamped', () => {
    var row = makeRow({ status: 'done', scheduled_at: '2026-03-01 12:00:00' });
    var task = rowToTask(row, TZ, {});
    expect(task.scheduledAt).toBe('2026-03-01T12:00:00Z');
  });
});

// ═══════════════════════════════════════════════════════════════
// rowToTask: return object completeness
// ═══════════════════════════════════════════════════════════════

describe('rowToTask: return object', () => {
  test('includes all expected fields', () => {
    var row = makeRow({ scheduled_at: '2026-04-07 15:00:00', preferred_time_mins: 420 });
    var task = rowToTask(row, TZ, {});
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('taskType');
    expect(task).toHaveProperty('scheduledAt');
    expect(task).toHaveProperty('desiredAt');
    expect(task).toHaveProperty('desiredDate');
    expect(task).toHaveProperty('preferredTimeMins');
    expect(task).toHaveProperty('unscheduled');
    expect(task).toHaveProperty('datePinned');
    expect(task).toHaveProperty('marker');
    expect(task).toHaveProperty('flexWhen');
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow: date/time → scheduled_at + desired_at
// ═══════════════════════════════════════════════════════════════

describe('taskToRow: date/time conversion', () => {
  test('date + time → scheduled_at and desired_at', () => {
    var row = taskToRow({ date: '4/7', time: '2:00 PM' }, 'u1', TZ);
    expect(row.scheduled_at).toBeTruthy();
    expect(row.desired_at).toBeTruthy();
    expect(row.scheduled_at).toEqual(row.desired_at);
  });

  test('date only → scheduled_at at midnight, desired_date set', () => {
    var row = taskToRow({ date: '4/7' }, 'u1', TZ);
    expect(row.scheduled_at).toBeTruthy();
    expect(row.desired_date).toBe('2026-04-07');
  });

  test('time only → _pendingTimeOnly', () => {
    var row = taskToRow({ time: '3:00 PM' }, 'u1', TZ);
    expect(row._pendingTimeOnly).toBe('3:00 PM');
    expect(row.scheduled_at).toBeUndefined();
  });

  test('scheduledAt (UTC ISO) takes precedence over date+time', () => {
    var row = taskToRow({
      scheduledAt: '2026-04-07T18:00:00Z',
      date: '4/8', time: '9:00 AM'
    }, 'u1', TZ);
    expect(row.scheduled_at.toISOString()).toBe('2026-04-07T18:00:00.000Z');
    expect(row.desired_at.toISOString()).toBe('2026-04-07T18:00:00.000Z');
  });

  test('empty date clears scheduled_at and desired_at', () => {
    var row = taskToRow({ date: '' }, 'u1', TZ);
    expect(row.scheduled_at).toBeNull();
    expect(row.desired_at).toBeNull();
    expect(row.desired_date).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow: preferredTimeMins
// ═══════════════════════════════════════════════════════════════

describe('taskToRow: preferredTimeMins', () => {
  test('maps preferredTimeMins to preferred_time_mins', () => {
    var row = taskToRow({ preferredTimeMins: 720 }, 'u1', TZ);
    expect(row.preferred_time_mins).toBe(720);
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow: priority normalization
// ═══════════════════════════════════════════════════════════════

describe('taskToRow: priority', () => {
  test('normalizes lowercase p2 → P2', () => {
    var row = taskToRow({ pri: 'p2' }, 'u1', TZ);
    expect(row.pri).toBe('P2');
  });

  test('normalizes numeric 1 → P1', () => {
    var row = taskToRow({ pri: '1' }, 'u1', TZ);
    expect(row.pri).toBe('P1');
  });

  test('defaults to P3 for empty', () => {
    var row = taskToRow({ pri: '' }, 'u1', TZ);
    expect(row.pri).toBe('P3');
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow: JSON fields
// ═══════════════════════════════════════════════════════════════

describe('taskToRow: JSON fields', () => {
  test('location array → JSON string', () => {
    var row = taskToRow({ location: ['home', 'work'] }, 'u1', TZ);
    expect(row.location).toBe('["home","work"]');
  });

  test('tools array → JSON string', () => {
    var row = taskToRow({ tools: ['phone'] }, 'u1', TZ);
    expect(row.tools).toBe('["phone"]');
  });

  test('dependsOn array → JSON string', () => {
    var row = taskToRow({ dependsOn: ['t1', 't2'] }, 'u1', TZ);
    expect(row.depends_on).toBe('["t1","t2"]');
  });

  test('recur object → JSON string', () => {
    var row = taskToRow({ recur: { type: 'daily', days: 'MTWRF' } }, 'u1', TZ);
    expect(JSON.parse(row.recur)).toEqual({ type: 'daily', days: 'MTWRF' });
  });
});

// ═══════════════════════════════════════════════════════════════
// buildSourceMap
// ═══════════════════════════════════════════════════════════════

describe('buildSourceMap', () => {
  test('builds map from template rows', () => {
    var rows = [
      makeTemplate({ id: 't1', text: 'Lunch' }),
      makeTemplate({ id: 't2', text: 'Breakfast' }),
      makeRow({ id: 'regular', task_type: 'task' }),
    ];
    var map = buildSourceMap(rows);
    expect(map['t1'].text).toBe('Lunch');
    expect(map['t2'].text).toBe('Breakfast');
    expect(map['regular']).toBeUndefined();
  });
});
