/**
 * push-eligibility.unit.test.js — DB-FREE decision-table unit tests for the pure
 * `isTaskPushEligible(ctx)` predicate extracted from the Phase 3a push-queue
 * filter in controllers/cal-sync.controller.js (999.1025 inc. 10).
 *
 * The filter decides which unledgered tasks become NEW provider events. Each skip
 * condition (already-processed / already-ledgered / merged-follower / terminal-or-
 * disabled / template / unscheduled / no-date-or-time / already-has-event-id-
 * unless-split-replaced / out-of-window) is pinned here as a boolean. PURE — the
 * pushQueue.push effect stays at the call site; the W4 golden axes A + N own the
 * DB-backed behavior.
 */

'use strict';

var { isTaskPushEligible } = require('../../src/slices/calendar/domain/push-eligibility');
var { PLACEMENT_MODES } = require('../../src/lib/placementModes');

var TODAY_START = new Date('2026-06-01T00:00:00Z');
var WINDOW_END = new Date('2026-08-01T00:00:00Z');
var IN_WINDOW = new Date('2026-06-15T09:00:00Z');

function makeTask(over) {
  return Object.assign({
    id: 't1', status: 'active', taskType: 'one-off', unscheduled: false,
    date: '2026-06-15', time: '09:00', _scheduled_at: IN_WINDOW,
    gcalEventId: null, msftEventId: null, appleEventId: null
  }, over || {});
}
function ctx(over) {
  return Object.assign({
    task: makeTask(),
    processedTaskIds: new Set(),
    ledgeredTaskIds: new Set(),
    mergedFollowers: {},
    splitReplacedIds: new Set(),
    eventIdCol: 'gcal_event_id',
    todayStart: TODAY_START,
    windowEnd: WINDOW_END
  }, over || {});
}

describe('isTaskPushEligible — the happy path', function () {
  it('1: fully eligible task → true', function () {
    expect(isTaskPushEligible(ctx())).toBe(true);
  });
  it("2: empty-string status is NOT in the skip list → still eligible", function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ status: '' }) }))).toBe(true);
  });
});

describe('isTaskPushEligible — Set / map membership skips', function () {
  it('3: already processed → false', function () {
    expect(isTaskPushEligible(ctx({ processedTaskIds: new Set(['t1']) }))).toBe(false);
  });
  it('4: already ledgered → false', function () {
    expect(isTaskPushEligible(ctx({ ledgeredTaskIds: new Set(['t1']) }))).toBe(false);
  });
  it('5: merged follower → false', function () {
    expect(isTaskPushEligible(ctx({ mergedFollowers: { t1: true } }))).toBe(false);
  });
});

describe('isTaskPushEligible — status gate (literal 5-status list incl. disabled)', function () {
  ['done', 'cancel', 'skip', 'pause', 'disabled'].forEach(function (st) {
    it('6.' + st + ': status ' + st + ' → false', function () {
      expect(isTaskPushEligible(ctx({ task: makeTask({ status: st }) }))).toBe(false);
    });
  });
  it('6.active: status active → true', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ status: 'active' }) }))).toBe(true);
  });
});

describe('isTaskPushEligible — shape gates', function () {
  it('7: recurring_template → false', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ taskType: 'recurring_template' }) }))).toBe(false);
  });
  it('8: unscheduled → false', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ unscheduled: true }) }))).toBe(false);
  });
  it('9: no date → false', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ date: null }) }))).toBe(false);
  });
  it('10: no time AND not all-day → false', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ time: null }) }))).toBe(false);
  });
  it('11: no time BUT all-day (placement_mode all_day) → true', function () {
    expect(isTaskPushEligible(ctx({
      task: makeTask({ time: null, placement_mode: PLACEMENT_MODES.ALL_DAY })
    }))).toBe(true);
  });
});

describe('isTaskPushEligible — existing event id + split replacement', function () {
  it('12: already has this provider event id, not split-replaced → false', function () {
    expect(isTaskPushEligible(ctx({ task: makeTask({ gcalEventId: 'evt-9' }) }))).toBe(false);
  });
  it('13: has event id BUT split-replaced → true (it will be re-pushed)', function () {
    expect(isTaskPushEligible(ctx({
      task: makeTask({ gcalEventId: 'evt-9' }),
      splitReplacedIds: new Set(['t1'])
    }))).toBe(true);
  });
  it('14: msft column reads msftEventId, not gcalEventId', function () {
    expect(isTaskPushEligible(ctx({
      eventIdCol: 'msft_event_id',
      task: makeTask({ gcalEventId: 'evt-9', msftEventId: null })   // gcal id ignored for msft
    }))).toBe(true);
    expect(isTaskPushEligible(ctx({
      eventIdCol: 'msft_event_id',
      task: makeTask({ msftEventId: 'm-1' })
    }))).toBe(false);
  });
  it('15: apple / unknown column reads appleEventId', function () {
    expect(isTaskPushEligible(ctx({
      eventIdCol: 'apple_event_id',
      task: makeTask({ appleEventId: 'a-1' })
    }))).toBe(false);
  });
});

describe('isTaskPushEligible — sync window', function () {
  it('16: scheduled before todayStart → false', function () {
    expect(isTaskPushEligible(ctx({
      task: makeTask({ _scheduled_at: new Date('2026-05-01T09:00:00Z') })
    }))).toBe(false);
  });
  it('17: scheduled after windowEnd → false', function () {
    expect(isTaskPushEligible(ctx({
      task: makeTask({ _scheduled_at: new Date('2026-09-01T09:00:00Z') })
    }))).toBe(false);
  });
  it('18: tz-less _scheduled_at string is parsed as UTC (replace-space-T + Z)', function () {
    expect(isTaskPushEligible(ctx({
      task: makeTask({ _scheduled_at: '2026-06-15 09:00:00' })
    }))).toBe(true);
    expect(isTaskPushEligible(ctx({
      task: makeTask({ _scheduled_at: '2026-05-01 09:00:00' })
    }))).toBe(false);
  });
});
