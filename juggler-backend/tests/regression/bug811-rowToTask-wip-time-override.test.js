/**
 * BUG-811 regression — rowToTask overwrites live scheduled_at time with
 * template preferred_time_mins for WIP (started) recurring instances.
 *
 * Root cause (taskMappers.js ~:250):
 *   if (src && src.preferred_time_mins != null && row.status !== 'disabled') {
 *     time = <template preferred-time 12hr string>;
 *   }
 * The guard only excludes 'disabled' — not 'wip'. A recurring_instance that the
 * user is actively working (status='wip') has a live, user-anchored scheduled_at
 * (e.g. 3:00 PM local) which should be the task.time. The template's
 * preferred_time_mins (e.g. 540 = 9:00 AM) overwrites it instead.
 *
 * Covers:
 *   - TRACEABILITY BUG-811 (taskMappers.js:~250)
 * Layer: unit (pure mapper — no DB)
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

// Timezone: America/New_York (UTC-4 in June — EDT)
// scheduled_at '2026-06-10 19:00:00' UTC = 3:00 PM EDT
// preferred_time_mins = 540 → 9:00 AM
// The WIP instance is being worked at 3:00 PM; task.time must stay '3:00 PM',
// NOT revert to '9:00 AM'.
const TZ = 'America/New_York';
const LIVE_SLOT_UTC = '2026-06-10 19:00:00'; // 3:00 PM EDT

function makeInstance(overrides) {
  return Object.assign({
    id: 'inst-811',
    master_id: 'tmpl-811',
    task_type: 'recurring_instance',
    status: 'wip',
    text: 'Bug-811 task',
    scheduled_at: LIVE_SLOT_UTC,
    desired_at: null,
    tz: TZ,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    earliest_start_at: null,
    location: '[]',
    tools: '[]',
    when: null,
    day_req: null,
    recurring: 1,
    rigid: 0,
    time_flex: null,
    split: null,
    split_min: null,
    split_total: 1,
    split_ordinal: 1,
    split_group: null,
    recur: null,
    source_id: 'tmpl-811',
    generated: 1,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    prev_when: null,
    travel_before: null,
    travel_after: null,
    preferred_time_mins: null, // instance itself has no preferred_time_mins
    unscheduled: null,
    overdue: null,
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: null,
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: 1,
    completed_at: null,
    end_date: null,
    rolling_anchor: null,
    date: '2026-06-10',
    created_at: '2026-06-10 00:00:00',
    updated_at: '2026-06-10 18:00:00'
  }, overrides);
}

function makeTemplate(overrides) {
  return Object.assign({
    id: 'tmpl-811',
    master_id: 'tmpl-811',
    task_type: 'recurring_template',
    status: '',
    text: 'Bug-811 task',
    scheduled_at: null,
    desired_at: null,
    tz: TZ,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    earliest_start_at: null,
    location: '[]',
    tools: '[]',
    when: null,
    day_req: null,
    recurring: 1,
    rigid: 0,
    time_flex: null,
    split: null,
    split_min: null,
    split_total: null,
    split_ordinal: null,
    split_group: null,
    recur: JSON.stringify({ type: 'daily' }),
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    prev_when: null,
    travel_before: null,
    travel_after: null,
    // Template says preferred 9:00 AM (540 minutes from midnight)
    preferred_time_mins: 540,
    unscheduled: null,
    overdue: null,
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: null,
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: null,
    completed_at: null,
    end_date: null,
    rolling_anchor: null,
    date: null,
    created_at: '2026-06-10 00:00:00',
    updated_at: '2026-06-10 00:00:00'
  }, overrides);
}

describe('BUG-811 — rowToTask: WIP instance keeps live scheduled_at time', () => {
  const sourceMap = { 'tmpl-811': makeTemplate() };

  // Inject a fixed now-context so the overdue predicate is deterministic
  const fixedNow = { todayKey: '2026-06-10', nowMins: 720 };

  it('BUG-811a: wip instance with live 3:00 PM slot — task.time must be "3:00 PM", NOT "9:00 AM" (preferred_time_mins=540)', () => {
    // Pre-fix: the preferred_time_mins branch at ~:250 overwrites time → "9:00 AM"
    // because `row.status !== 'disabled'` is TRUE for 'wip'.
    // After fix: the branch must also exclude 'wip' (or any non-unplaced instance
    // with a live scheduled_at).
    const task = rowToTask(makeInstance(), TZ, sourceMap, undefined, fixedNow);

    // This assertion FAILS on pre-fix code (returns '9:00 AM' from preferred_time_mins=540)
    // and PASSES after the fix (returns '3:00 PM' from the live scheduled_at).
    expect(task.time).toBe('3:00 PM');
  });

  it('BUG-811b: time derived from live scheduled_at, not template preferred_time_mins value', () => {
    const task = rowToTask(makeInstance(), TZ, sourceMap, undefined, fixedNow);
    // Confirm it is NOT the template value (9:00 AM = preferred_time_mins 540)
    expect(task.time).not.toBe('9:00 AM');
  });

  it('BUG-811c: different live slot — 11:30 AM UTC-4 = 7:30 AM EDT stays 7:30 AM', () => {
    // scheduled_at '2026-06-10 11:30:00' UTC = 7:30 AM EDT
    const task = rowToTask(
      makeInstance({ scheduled_at: '2026-06-10 11:30:00' }),
      TZ,
      sourceMap,
      undefined,
      fixedNow
    );
    // Pre-fix: returns '9:00 AM' (preferred_time_mins overwrite).
    // Post-fix: returns '7:30 AM'.
    expect(task.time).toBe('7:30 AM');
  });

  // ── REGRESSION GUARD: non-wip statuses that SHOULD use preferred_time_mins ──
  // An unplaced instance (scheduled_at=null) without a live slot should still
  // use the template preferred_time_mins as its display time.
  it('REG-811: unplaced instance (scheduled_at=null, status="") uses preferred_time_mins → "9:00 AM"', () => {
    const unplacedRow = makeInstance({ scheduled_at: null, status: '' });
    const task = rowToTask(unplacedRow, TZ, sourceMap, undefined, fixedNow);
    // No live slot → preferred_time_mins branch should fire → "9:00 AM"
    expect(task.time).toBe('9:00 AM');
  });

  // disabled instances are ALREADY excluded by the existing `row.status !== 'disabled'` guard
  it('REG-811: disabled instance is unaffected (existing guard)', () => {
    const disabledRow = makeInstance({ status: 'disabled', scheduled_at: '2026-06-10 19:00:00' });
    const task = rowToTask(disabledRow, TZ, sourceMap, undefined, fixedNow);
    // disabled rows skip the preferred_time_mins branch and keep their scheduled_at time
    expect(task.time).toBe('3:00 PM');
  });
});
