/**
 * W2 B6 — MAPPER CHARACTERIZATION PARITY (byte-identical relocation proof).
 *
 * This is the binding proof for WBS W2 acceptance (d): the relocated PURE
 * mappers in slices/task/domain/mappers/taskMappers.js produce output
 * BYTE-IDENTICAL to the legacy task.controller.js helpers for the W1 fixtures.
 *
 * HOW: import BOTH the legacy controller export AND the new pure mapper, feed
 * IDENTICAL input, and deep-equal the outputs. Same fixture shapes as the W1
 * golden-master (makeTaskRow / makeRecurringInstanceRow / makeSplitChunkRow /
 * makeRecurringTemplateRow).
 *
 * The controller pulls in src/db at require-time, so we mock it the same way the
 * golden-master does (the mappers under test touch NO DB — this mock only lets
 * the legacy controller module load).
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../../../helpers/mockChainDb');
const { mockDb } = createMockChainDb();
jest.mock('../../../../src/db', () => mockDb);
jest.mock('../../../../src/lib/db', () => {
  const actual = jest.requireActual('../../../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// Legacy (controller) exports — the oracle.
const legacy = require('../../../../src/controllers/task.controller');
// New PURE mappers — under test.
const mappers = require('../../../../src/slices/task/domain/mappers/taskMappers');
const { validateTaskInput, checkCalSyncEditGuard, guardFixedCalendarWhen } =
  require('../../../../src/slices/task/domain/validation/taskValidation');

const USER_ID = 'gm-user-001';
const TZ = 'America/New_York';

// ── Fixtures (same shapes as the W1 golden-master) ───────────────────────────
function makeTaskRow(overrides) {
  return Object.assign({
    id: 'task-gm-001', master_id: 'task-gm-001', user_id: USER_ID,
    task_type: 'task', text: 'Golden master task', status: '',
    scheduled_at: null, desired_at: null, tz: null, dur: 30, time_remaining: null,
    pri: 'P3', project: null, section: null, notes: null, url: null,
    deadline: null, earliest_start_at: null, location: '[]', tools: '[]',
    when: null, day_req: null, recurring: 0, rigid: 0, time_flex: null,
    split: null, split_min: null, split_total: null, split_ordinal: null, split_group: null,
    recur: null, source_id: null, generated: 0,
    gcal_event_id: null, msft_event_id: null, apple_event_id: null,
    apple_calendar_name: null, cal_sync_origin: null, cal_event_url: null,
    depends_on: '[]', date_pinned: 0, marker: 0, flex_when: 0, prev_when: null,
    travel_before: null, travel_after: null, preferred_time_mins: null,
    unscheduled: null, overdue: null, slack_mins: null,
    recur_start: null, recur_end: null, placement_mode: null,
    disabled_at: null, disabled_reason: null, occurrence_ordinal: null,
    completed_at: null, end_date: null, rolling_anchor: null,
    created_at: '2026-06-10 00:00:00', updated_at: '2026-06-10 00:00:00'
  }, overrides);
}
function makeRecurringInstanceRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-inst-001', master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_instance', recurring: 1, generated: 0,
    source_id: 'task-gm-tmpl-001', scheduled_at: '2026-06-10 14:00:00',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1
  }, overrides));
}
function makeRecurringTemplateRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-tmpl-001', master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_template', recurring: 1,
    recur: JSON.stringify({ type: 'daily' }), text: 'Daily template'
  }, overrides));
}
function makeSplitChunkRow(overrides) {
  return makeTaskRow(Object.assign({
    id: 'task-gm-split-001', master_id: 'task-gm-tmpl-001',
    task_type: 'recurring_instance', recurring: 1, source_id: 'task-gm-tmpl-001',
    scheduled_at: '2026-06-10 14:00:00', occurrence_ordinal: 1,
    split_ordinal: 1, split_total: 2, split_group: 'task-gm-tmpl-001-20260610', dur: 30
  }, overrides));
}

describe('B6 — rowToTask parity (legacy controller === pure mapper)', () => {
  beforeEach(() => {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const cases = {
    'plain task (no tz)': [makeTaskRow(), null, {}],
    'plain task (with tz)': [makeTaskRow({ scheduled_at: '2026-06-10 18:00:00' }), TZ, {}],
    'recurring instance (with tz)': [makeRecurringInstanceRow(), TZ, {}],
    'recurring instance (no tz)': [makeRecurringInstanceRow(), null, {}],
    'recurring template': [makeRecurringTemplateRow(), TZ, {}],
    'split chunk': [makeSplitChunkRow(), TZ, {}],
    'task with deadline + earliestStart': [makeTaskRow({ deadline: '2020-01-01', earliest_start_at: '2026-06-15' }), TZ, {}],
    'task with location/tools/recur JSON': [makeTaskRow({ location: '["home"]', tools: '["laptop"]', recur: JSON.stringify({ type: 'weekly' }) }), null, {}],
    'task with weather constraints': [makeTaskRow({ weather_precip: 'none', weather_cloud: 'clear', weather_temp_min: 50, weather_temp_max: 80, weather_temp_unit: 'F', weather_humidity_min: 10, weather_humidity_max: 90 }), null, {}],
    'task with null task_type (defaults task)': [makeTaskRow({ task_type: null }), null, {}],
    'instance with source merge': [makeRecurringInstanceRow(), TZ, { 'task-gm-tmpl-001': makeRecurringTemplateRow({ preferred_time_mins: 540 }) }],
    'terminal-status task (done)': [makeTaskRow({ status: 'done', scheduled_at: '2020-01-01 10:00:00' }), null, {}]
  };

  Object.entries(cases).forEach(([name, [row, tz, srcMap]]) => {
    test('byte-identical: ' + name, () => {
      // Deep clones so neither mapper sees mutations from the other (rowToTask
      // mutates `row` in the source-merge / terminal-clamp branches).
      const legacyOut = legacy.rowToTask(clone(row), tz, clone(srcMap));
      const pureOut = mappers.rowToTask(clone(row), tz, clone(srcMap));
      expect(pureOut).toEqual(legacyOut);
      // Stronger: byte-identical JSON serialization.
      expect(JSON.stringify(pureOut)).toBe(JSON.stringify(legacyOut));
    });
  });

  test('source-merge mutation behavior identical (orphan-warn branch does not throw without logger)', () => {
    const row = makeRecurringInstanceRow({ source_id: 'missing-tmpl' });
    expect(() => mappers.rowToTask(clone(row), TZ, {})).not.toThrow();
    expect(mappers.rowToTask(clone(row), TZ, {})).toEqual(legacy.rowToTask(clone(row), TZ, {}));
  });
});

describe('B6 — taskToRow parity (legacy controller === pure mapper)', () => {
  const cases = {
    'minimal create': { text: 'New task' },
    'full field set': {
      id: 'x1', taskType: 'task', text: 'T', dur: 45, pri: '2', project: 'P',
      status: 'wip', section: 'S', notes: 'n', url: 'http://x', deadline: '2020-01-01',
      earliestStart: '2026-06-15', location: ['home'], tools: ['laptop'], when: 'morning',
      dayReq: 'weekday', recurring: true, timeFlex: 30, split: true, splitMin: 15,
      recur: { type: 'weekly' }, sourceId: 'src', generated: true, dependsOn: ['a'],
      flexWhen: true, travelBefore: 10, travelAfter: 5, tz: 'America/New_York',
      recurStart: '2026-06-01', recurEnd: '2026-12-31', preferredTimeMins: 540,
      placementMode: 'fixed', scheduledAt: '2026-06-10T18:00:00Z'
    },
    'date+time (tz path)': { text: 'T', date: '2026-06-10', time: '2:00 PM' },
    'date only (noon desired_at)': { text: 'T', date: '2026-06-10' },
    'time only (pending)': { text: 'T', time: '2:00 PM' },
    'null scheduledAt clears': { text: 'T', scheduledAt: null },
    'pri normalization variants': { pri: 'p1' },
    'split null passthrough': { split: null },
    'weather fields': { weatherPrecip: 'none', weatherTempMin: 50, weatherHumidityMax: 90 },
    'snake-case travel fallback': { travel_before: 12, travel_after: 8 }
  };

  Object.entries(cases).forEach(([name, task]) => {
    test('byte-identical (minus updated_at Date): ' + name, () => {
      const legacyOut = legacy.taskToRow(clone(task), USER_ID, TZ);
      const pureOut = mappers.taskToRow(clone(task), USER_ID, TZ);
      // updated_at is `new Date()` in both — equal by being a Date, not by value.
      expect(legacyOut.updated_at).toBeInstanceOf(Date);
      expect(pureOut.updated_at).toBeInstanceOf(Date);
      delete legacyOut.updated_at;
      delete pureOut.updated_at;
      expect(pureOut).toEqual(legacyOut);
      expect(JSON.stringify(pureOut)).toBe(JSON.stringify(legacyOut));
    });
  });

  test('P1: taskToRow emits new Date() for updated_at (not db.fn.now())', () => {
    const row = mappers.taskToRow({ text: 'p1' }, USER_ID, TZ);
    expect(row.updated_at).toBeInstanceOf(Date);
    expect(Number.isNaN(row.updated_at.getTime())).toBe(false);
  });
});

describe('B6 — small pure helpers parity', () => {
  test('normalizePri parity', () => {
    // normalizePri is not a direct controller export — it is exercised through
    // taskToRow's `row.pri = normalizePri(task.pri)`. Compare the pure mapper's
    // normalizePri against the legacy taskToRow's normalized `pri` output.
    ['P1', 'p2', '3', '4', 'garbage', 'P9'].forEach((v) => {
      expect(mappers.normalizePri(v)).toBe(legacy.taskToRow({ pri: v }, USER_ID, TZ).pri);
    });
  });

  test('scheduledAtToISO parity (via rowToTask scheduledAt field)', () => {
    ['2026-06-10 14:00:00', '2026-06-10T14:00:00Z', null, ''].forEach((sa) => {
      const row = makeTaskRow({ scheduled_at: sa });
      expect(mappers.rowToTask(clone(row), null, {}).scheduledAt)
        .toBe(legacy.rowToTask(clone(row), null, {}).scheduledAt);
    });
  });

  test('safeParseJSON parity', () => {
    [['[1,2]', []], ['null', []], ['', []], ['bad', []], [null, []], [['a'], []]].forEach(([v, fb]) => {
      expect(mappers.safeParseJSON(v, fb)).toEqual(legacySafeParseJSON(v, fb));
    });
  });

  test('buildSourceMap parity', () => {
    const rows = [
      makeRecurringTemplateRow(),
      makeTaskRow({ id: 'legacy-src', recurring: 1, task_type: 'task' }),
      makeRecurringInstanceRow(),
      makeTaskRow({ id: 'plain' })
    ];
    expect(mappers.buildSourceMap(clone(rows))).toEqual(legacy.buildSourceMap(clone(rows)));
  });

  test('TEMPLATE_FIELDS list identical', () => {
    expect(mappers.TEMPLATE_FIELDS).toEqual(legacy.TEMPLATE_FIELDS);
  });
});

describe('B6 — validation/guard parity (relocated)', () => {
  test('validateTaskInput parity across representative bodies', () => {
    const bodies = [
      { _requireText: true, text: '' },
      { text: 'x'.repeat(501) },
      { notes: 'x'.repeat(5001) },
      { when: 'a,' + 'x'.repeat(31) },
      { dayReq: 'nope' },
      { dayReq: 'M,T,W' },
      { dur: -1 },
      { split: true, splitMin: 0, dur: 5 },
      { timeFlex: 999 },
      { deadline: 'not-a-date' },
      { deadline: '2026-01-01', earliestStart: '2026-02-01' },
      { recur: { type: 'fortnightly' } },
      { recur: { type: 'interval', every: 0, unit: 'days' } },
      { recur: { type: 'interval', every: 2, unit: 'fortnights' } },
      { placementMode: 'NOT_VALID' },
      { placementMode: 'fixed' },
      { placementMode: 'fixed', date: '2026-06-10' },
      { text: 'ok' }
    ];
    bodies.forEach((b) => {
      expect(validateTaskInput(clone(b))).toEqual(legacy.validateTaskInput(clone(b)));
    });
  });

  test('checkCalSyncEditGuard parity', () => {
    const existing = { cal_sync_origin: 'gcal' };
    [
      { status: 'done' },
      { text: 'edit' },
      { notes: 'n', text: 'x' },
      { _allowUnfix: true, placementMode: 'anytime' }
    ].forEach((body) => {
      expect(checkCalSyncEditGuard(clone(existing), clone(body)))
        .toEqual(legacy.checkCalSyncEditGuard(clone(existing), clone(body)));
    });
    // juggler-origin → null
    expect(checkCalSyncEditGuard({ cal_sync_origin: 'juggler' }, { text: 'x' }))
      .toEqual(legacy.checkCalSyncEditGuard({ cal_sync_origin: 'juggler' }, { text: 'x' }));
  });

  test('guardFixedCalendarWhen parity (mutation behavior)', () => {
    const target = { gcal_event_id: 'g1' };
    const rowPure = { placement_mode: 'anytime' };
    const rowLegacy = { placement_mode: 'anytime' };
    guardFixedCalendarWhen(rowPure, target);
    legacy.guardFixedCalendarWhen(rowLegacy, target);
    expect(rowPure).toEqual(rowLegacy);
    expect('placement_mode' in rowPure).toBe(false); // deleted on cal-linked, non-fixed
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
// Local re-impl mirror of safeParseJSON's contract for the comparison side that
// the controller doesn't export directly (it DOES export safeParseJSON).
function legacySafeParseJSON(v, fb) { return legacy.safeParseJSON(v, fb); }
