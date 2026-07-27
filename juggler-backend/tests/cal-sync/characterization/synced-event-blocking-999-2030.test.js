/**
 * 999.2030 — Synced events must own their time slot exclusively.
 *
 * ORIGINAL (999.2030): a formerly-REMINDER task whose event became busy (not
 * transparent) with no date/time change was reset to ANYTIME, which is
 * non-blocking — other tasks could be scheduled over it. The fix promoted it to
 * FIXED instead.
 *
 * SUPERSEDED BY 999.4671 (David ruling 2026-07-27): that un-flip only existed to
 * repair tasks the transparency→REMINDER mapping had wrongly demoted in the first
 * place. With transparency removed from placement entirely, a synced task is FIXED
 * from ingest onward, and the only way it can be REMINDER is a deliberate
 * Juggler-side change — which no sync may overwrite. The un-flip is therefore gone;
 * re-running it would clobber the user.
 *
 * This file keeps the 999.2030 INVARIANT (a busy synced event ends up blocking)
 * and re-pins it at the layer that now decides it — ingest — plus the stickiness
 * that replaced the un-flip. Placement-mode-write coverage for all three adapters
 * lives in tests/cal-sync/synced-event-is-timeblock-999-4671.test.js.
 */

'use strict';

var gcalAdapter  = require('../../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter  = require('../../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../../src/lib/cal-adapters/apple.adapter');
var { decideIngestEvent } = require('../../../src/slices/calendar/domain/ingest-event-decision');
var { PLACEMENT_MODES } = require('../../../src/lib/placementModes');

var TZ = 'America/New_York';

function timedEvent(overrides) {
  return Object.assign({
    title: 'Team Standup',
    startDateTime: '2026-06-15T10:00:00',
    endDateTime:   '2026-06-15T10:30:00',
    isAllDay:      false,
    durationMinutes: 30,
    isTransparent: false,
    description:   ''
  }, overrides);
}

function ingestCtx(event) {
  return {
    event: event,
    existingTask: null,
    isPast: false,
    isJugglerOriginBody: false,
    orphanMatch: null,
    calIngestMode: 'task',
    pid: 'gcal',
    jugglerOrigin: 'juggler'
  };
}

describe('999.2030 invariant (via 999.4671): a synced event is blocking from ingest', () => {
  test('busy event → FIXED', () => {
    var d = decideIngestEvent(ingestCtx(timedEvent({ isTransparent: false })));
    expect(d.placementMode).toBe(PLACEMENT_MODES.FIXED);
  });

  test('free/transparent event → FIXED too (transparency no longer demotes)', () => {
    var d = decideIngestEvent(ingestCtx(timedEvent({ isTransparent: true })));
    expect(d.placementMode).toBe(PLACEMENT_MODES.FIXED);
  });
});

describe('999.4671: the REMINDER→FIXED un-flip is gone — Juggler-side choice is sticky', () => {
  var CASES = [
    ['GCal',  gcalAdapter,  {}],
    ['MSFT',  msftAdapter,  { startTimezone: 'Eastern Standard Time' }],
    ['Apple', appleAdapter, {}]
  ];

  test.each(CASES)('%s: reminder task + busy event, no date/time change → placement untouched', (name, adapter, extra) => {
    var event = timedEvent(Object.assign({ isTransparent: false }, extra));
    var current = {
      placement_mode: PLACEMENT_MODES.REMINDER,
      date: '2026-06-15',
      time: '10:00 AM'
    };
    var fields = adapter.applyEventToTaskFields(event, TZ, current);
    expect(fields.placement_mode).toBeUndefined();
  });
});
