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

const { rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS, validateTaskInput, guardFixedCalendarWhen, safeParseJSON, updateTask } = require('../src/controllers/task.controller');
const TZ = 'America/New_York';

function makeRow(overrides) {
  return Object.assign({
    id: 'test-001', user_id: 'u1', task_type: 'task', text: 'Test',
    scheduled_at: null, desired_at: null, tz: null,
    dur: 30, time_remaining: null, pri: 'P3', project: null, status: '',
    section: null, notes: null, deadline: null, start_after_at: null,
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
      'recurring', 'placement_mode', 'time_flex', 'split', 'split_min',
      'notes', 'flex_when', 'preferred_time_mins'];
    expected.forEach(function(f) {
      expect(TEMPLATE_FIELDS).toContain(f);
    });
  });

  test('does NOT include rigid or marker (dropped in Phase 4)', () => {
    expect(TEMPLATE_FIELDS).not.toContain('rigid');
    expect(TEMPLATE_FIELDS).not.toContain('marker');
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
    expect(task).toHaveProperty('preferredTimeMins');
    expect(task).toHaveProperty('unscheduled');
    expect(task).toHaveProperty('placementMode');
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

  test('date only → scheduled_at at midnight, desired_at at noon', () => {
    var row = taskToRow({ date: '4/7' }, 'u1', TZ);
    expect(row.scheduled_at).toBeTruthy();
    expect(row.desired_at).toBeTruthy();
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

describe('validateTaskInput — anchor-dependent recur requires recurStart', () => {
  test('create rejects biweekly without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'biweekly', days: 'M' }
    });
    expect(errs.some(e => /Recurrence start date is required/i.test(e))).toBe(true);
  });

  test('create rejects interval without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'interval', every: 3, unit: 'days' }
    });
    expect(errs.some(e => /Recurrence start date is required/i.test(e))).toBe(true);
  });

  test('create rejects weekly+timesPerCycle without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'weekly', days: 'MTWRFUS', timesPerCycle: 1 }
    });
    expect(errs.some(e => /Recurrence start date is required/i.test(e))).toBe(true);
  });

  test('create allows biweekly WITH recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'biweekly', days: 'M' },
      recurStart: '2026-04-20'
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('create allows daily without recurStart (not anchor-dependent)', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'daily' }
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('create allows weekly (no tpc) without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'weekly', days: 'MWF' }
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('create allows monthly by monthDays without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'monthly', monthDays: [1, 15] }
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('update without _requireRecurStartIfAnchor: recurStart undefined is OK', () => {
    // Client only sending changed fields; existing DB recurStart remains.
    const errs = validateTaskInput({
      recur: { type: 'biweekly', days: 'M' }
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('update rejects explicit clearing of recurStart while anchor-dependent', () => {
    const errs = validateTaskInput({
      recur: { type: 'biweekly', days: 'M' },
      recurStart: ''
    });
    expect(errs.some(e => /cannot be cleared/i.test(e))).toBe(true);
  });

  test('update rejects null recurStart while anchor-dependent', () => {
    const errs = validateTaskInput({
      recur: { type: 'interval', every: 2, unit: 'weeks' },
      recurStart: null
    });
    expect(errs.some(e => /cannot be cleared/i.test(e))).toBe(true);
  });

  test('create rejects rolling without recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'rolling', every: 7, unit: 'days' }
    });
    expect(errs.some(e => /Recurrence start date is required/i.test(e))).toBe(true);
  });

  test('create allows rolling WITH recurStart', () => {
    const errs = validateTaskInput({
      _requireRecurStartIfAnchor: true,
      recur: { type: 'rolling', every: 7, unit: 'days' },
      recurStart: '2026-05-21'
    });
    expect(errs.some(e => /Recurrence start date/i.test(e))).toBe(false);
  });

  test('update rejects explicit clearing of recurStart on rolling', () => {
    const errs = validateTaskInput({
      recur: { type: 'rolling', every: 7, unit: 'days' },
      recurStart: null
    });
    expect(errs.some(e => /cannot be cleared/i.test(e))).toBe(true);
  });

  test('cross-field: placementMode fixed without scheduling info → error', () => {
    var errs = validateTaskInput({ placementMode: 'fixed' });
    expect(errs.some(function(e) { return /placementMode "fixed" requires a date/i.test(e); })).toBe(true);
  });

  test('cross-field: placementMode fixed with date+time → no error', () => {
    var errs = validateTaskInput({ placementMode: 'fixed', date: '2026-05-20', time: '10:00 AM' });
    expect(errs.some(function(e) { return /placementMode "fixed"/i.test(e); })).toBe(false);
  });

  test('cross-field: placementMode fixed with scheduledAt → no error', () => {
    var errs = validateTaskInput({ placementMode: 'fixed', scheduledAt: '2026-05-20T14:00:00Z' });
    expect(errs.some(function(e) { return /placementMode "fixed"/i.test(e); })).toBe(false);
  });

  test('cross-field: placementMode fixed with date only (no time) → no error', () => {
    // validateTaskInput uses OR: date | time | scheduledAt is sufficient.
    // The stricter date+time requirement lives in the createTask/updateTask handlers,
    // not in the shared validator. Date-only must pass validateTaskInput.
    var errs = validateTaskInput({ placementMode: 'fixed', date: '2026-05-20' });
    expect(errs.some(function(e) { return /placementMode "fixed"/i.test(e); })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow: placementMode — drag-to-fixed PATCH path
// ═══════════════════════════════════════════════════════════════

describe('taskToRow: placementMode drag-to-fixed', () => {
  test('PATCH with placementMode:fixed writes placement_mode=fixed', () => {
    var row = taskToRow({ placementMode: 'fixed', date: '2026-05-20', time: '2:00 PM' }, 'u1', TZ);
    expect(row.placement_mode).toBe('fixed');
  });

  test('PATCH with placementMode:anytime writes placement_mode=anytime', () => {
    var row = taskToRow({ placementMode: 'anytime' }, 'u1', TZ);
    expect(row.placement_mode).toBe('anytime');
  });

  test('PATCH without placementMode leaves placement_mode undefined (no server derivation)', () => {
    var row = taskToRow({ date: '2026-05-20', time: '2:00 PM' }, 'u1', TZ);
    expect(row.placement_mode).toBeUndefined();
  });

  test('invalid placementMode is passed through by taskToRow (validateTaskInput catches it before taskToRow is called)', () => {
    // validateTaskInput rejects unknown placementMode values before taskToRow is reached.
    // taskToRow itself no longer silently coerces to 'anytime' — it assigns directly.
    var row = taskToRow({ placementMode: 'bogus_mode' }, 'u1', TZ);
    expect(row.placement_mode).toBe('bogus_mode');
  });
});

// ═══════════════════════════════════════════════════════════════
// guardFixedCalendarWhen — placement_mode guard for cal-linked tasks
// ═══════════════════════════════════════════════════════════════

describe('guardFixedCalendarWhen', () => {
  test('strips non-fixed placement_mode when task is calendar-linked', () => {
    var row = { placement_mode: 'anytime' };
    var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBeUndefined();
  });

  test('preserves placement_mode:fixed on calendar-linked task', () => {
    var row = { placement_mode: 'fixed' };
    var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBe('fixed');
  });

  test('does NOT guard when task has no calendar link', () => {
    var row = { placement_mode: 'anytime' };
    var existing = { gcal_event_id: null, msft_event_id: null, apple_event_id: null };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBe('anytime');
  });

  test('does NOT guard when allowUnfix is set', () => {
    var row = { placement_mode: 'anytime' };
    var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
    guardFixedCalendarWhen(row, existing, { allowUnfix: true });
    expect(row.placement_mode).toBe('anytime');
  });

  test('guards on msft_event_id', () => {
    var row = { placement_mode: 'time_blocks' };
    var existing = { gcal_event_id: null, msft_event_id: 'msft_xyz', apple_event_id: null };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBeUndefined();
  });

  test('guards on apple_event_id', () => {
    var row = { placement_mode: 'time_window' };
    var existing = { gcal_event_id: null, msft_event_id: null, apple_event_id: 'apple_123' };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBeUndefined();
  });

  test('no-ops when guardTarget is null', () => {
    var row = { placement_mode: 'anytime' };
    guardFixedCalendarWhen(row, null, {});
    expect(row.placement_mode).toBe('anytime');
  });

  test('strips null placement_mode (null-clearing attempt) on calendar-linked task (RF2)', () => {
    // PATCH sends { placementMode: null } → taskToRow sets row.placement_mode = null.
    // Guard must catch this falsy case and strip the key so the DB write
    // does not overwrite 'fixed' with NULL.
    var row = { placement_mode: null };
    var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
    guardFixedCalendarWhen(row, existing, {});
    expect(row.placement_mode).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// W-C2 HTTP — PATCH /api/tasks/:id with invalid placementMode → 400
// ═══════════════════════════════════════════════════════════════

describe('updateTask HTTP: invalid placementMode → 400 (W-C2 HTTP)', () => {
  function makeUpdateReq(bodyOverrides) {
    return {
      user: { id: 'u1' },
      headers: { 'x-timezone': 'America/New_York' },
      params: { id: 'task-xyz' },
      query: {},
      planFeatures: null,
      planId: 'free',
      body: Object.assign({}, bodyOverrides)
    };
  }

  function makeUpdateRes() {
    var res = {
      statusCode: 200,
      _json: null,
      status: function(code) { res.statusCode = code; return res; },
      json: function(data) { res._json = data; return res; }
    };
    return res;
  }

  test('PATCH with totally_bogus placementMode → 400 with validation message', async () => {
    var req = makeUpdateReq({ placementMode: 'totally_bogus' });
    var res = makeUpdateRes();
    await updateTask(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/placementMode/);
    expect(res._json.error).toMatch(/totally_bogus/);
  });
});

// ═══════════════════════════════════════════════════════════════
// W-C2 unit — validateTaskInput rejects unknown placementMode
// ═══════════════════════════════════════════════════════════════

describe('validateTaskInput: unknown placementMode → validation error (W-C2)', () => {
  test('unknown placementMode value produces error containing mode name', () => {
    var errors = validateTaskInput({ placementMode: 'not_a_mode' });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('placementMode')
    ]));
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('not_a_mode')
    ]));
  });

  test('known placementMode anytime produces no error', () => {
    var errors = validateTaskInput({ placementMode: 'anytime' });
    expect(errors.some(function(e) { return /placementMode/i.test(e); })).toBe(false);
  });

  test('known placementMode fixed with date produces no placementMode error', () => {
    var errors = validateTaskInput({ placementMode: 'fixed', date: '2026-05-20' });
    expect(errors.some(function(e) { return /not valid/i.test(e); })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// W-W5 — safeParseJSON falsy-but-valid non-string passthrough
// ═══════════════════════════════════════════════════════════════

describe('safeParseJSON falsy passthrough (W-W5)', () => {
  test('non-string value 0 passes through (not substituted by fallback)', () => {
    // safeParseJSON(val, fallback): when val is not a string, returns val directly.
    // 0 is falsy — if the guard were `if (!val) return fallback` this would fail.
    var result = safeParseJSON(0, 'FALLBACK');
    expect(result).toBe(0);
    expect(result).not.toBe('FALLBACK');
  });

  test('false passes through (not substituted by fallback)', () => {
    var result = safeParseJSON(false, 'FALLBACK');
    expect(result).toBe(false);
    expect(result).not.toBe('FALLBACK');
  });

  test('empty array [] passes through as-is (truthy, non-string)', () => {
    var arr = [];
    var result = safeParseJSON(arr, 'FALLBACK');
    expect(result).toBe(arr);
    expect(result).not.toBe('FALLBACK');
  });

  test('null returns fallback', () => {
    var result = safeParseJSON(null, 'FALLBACK');
    expect(result).toBe('FALLBACK');
  });

  test('undefined returns fallback', () => {
    var result = safeParseJSON(undefined, 'FALLBACK');
    expect(result).toBe('FALLBACK');
  });

  test('valid JSON string is parsed', () => {
    var result = safeParseJSON('{"a":1}', null);
    expect(result).toEqual({ a: 1 });
  });

  test('already-parsed object {a:1} passes through unchanged (non-string passthrough)', () => {
    // ZOE-JUG-021: non-string values are returned as-is, not re-parsed
    var obj = { a: 1 };
    var result = safeParseJSON(obj, null);
    expect(result).toBe(obj);
    expect(result).toEqual({ a: 1 });
  });

  test('invalid JSON string returns fallback []', () => {
    // ZOE-JUG-021: parse errors return the fallback, not the raw string
    var result = safeParseJSON('bad json', []);
    expect(result).toEqual([]);
  });
});

describe('validateTaskInput — rolling recurrence type', () => {
  test('rolling is accepted as valid recur type', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling', every: 7, unit: 'days' } });
    expect(errs.some(e => /invalid recurrence type/i.test(e))).toBe(false);
    expect(errs.length).toBe(0); // tightened: no errors at all
  });

  test('unknown recur type rejected', () => {
    const errs = validateTaskInput({ recur: { type: 'quarterly' } });
    expect(errs.some(e => /invalid recurrence type/i.test(e))).toBe(true);
  });

  test('empty recur type rejected', () => {
    const errs = validateTaskInput({ recur: { type: '' } });
    expect(errs.some(e => /type is required/i.test(e))).toBe(true);
  });

  test('null recur type rejected', () => {
    const errs = validateTaskInput({ recur: { type: null } });
    expect(errs.some(e => /type is required/i.test(e))).toBe(true);
  });

  test('rolling with every=0 rejected', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling', every: 0, unit: 'days' } });
    expect(errs.some(e => /positive integer/i.test(e))).toBe(true);
  });

  test('rolling with every=-1 rejected', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling', every: -1, unit: 'days' } });
    expect(errs.some(e => /positive integer/i.test(e))).toBe(true);
  });

  test('rolling with every=Infinity rejected', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling', every: Infinity, unit: 'days' } });
    expect(errs.some(e => /positive integer/i.test(e))).toBe(true);
  });

  test('rolling with unit=years rejected', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling', every: 1, unit: 'years' } });
    expect(errs.some(e => /unit must be/i.test(e))).toBe(true);
  });

  test('rolling with valid units accepted', () => {
    ['days', 'weeks', 'months'].forEach(unit => {
      const errs = validateTaskInput({ recur: { type: 'rolling', every: 3, unit } });
      expect(errs.some(e => /unit must be/i.test(e))).toBe(false);
    });
  });

  test('rolling with undefined every and unit accepted (scheduler has defaults)', () => {
    const errs = validateTaskInput({ recur: { type: 'rolling' } });
    expect(errs.length).toBe(0);
  });

  test('Rolling (mixed case) accepted via toLowerCase', () => {
    const errs = validateTaskInput({ recur: { type: 'Rolling', every: 7, unit: 'days' } });
    expect(errs.some(e => /invalid recurrence type/i.test(e))).toBe(false);
  });
});
