/**
 * 999.4671 — a synced calendar event is a TIME BLOCK unless the user changes it
 * to a reminder IN JUGGLER.
 *
 * RULING (David 2026-07-27): provider free/busy transparency must never decide
 * placement_mode. Google marks a large class of events `transparency:
 * 'transparent'` ("Free") by default — every all-day event, and the events Gmail
 * auto-creates from confirmation mail (appointments, movie tickets). Mapping that
 * to PLACEMENT_MODES.REMINDER made those tasks dur=0 in the scheduler
 * (unifiedScheduleV2.js buildItems: `isMarker` → `dur = 0`, "markers never consume
 * occupancy"), so the scheduler happily placed other work straight over a doctor's
 * appointment.
 *
 * Dev-DB evidence (3308, 2026-07-27): active gcal-origin ledger rows 130 / 16575 /
 * 16604 are 60-minute timed events — "Appointment at Pulmonary Associates of
 * Richmond" 11:45–12:45, "telehealth appointment with Dr. Peter Nguyen" 13:00–14:00,
 * "The Odyssey - The IMAX 2D Experience" 15:05–16:05 — all sitting at
 * placement_mode='reminder' with `user_calendars` EMPTY (so calIngestMode defaults
 * to 'task' and transparency was the sole cause).
 *
 * REVERSES 999.2030's REMINDER→FIXED un-flip. That un-flip existed to rescue tasks
 * this same transparency mapping had wrongly demoted; with the cause removed, the
 * only way a synced task can be REMINDER is a deliberate Juggler-side choice, and
 * re-promoting it on the next pull would overwrite the user.
 *
 * Layer: unit — pure functions, no DB, no network, no wall-clock.
 */

'use strict';

process.env.NODE_ENV = 'test';

var { decideIngestEvent } = require('../../../src/slices/calendar/domain/ingest-event-decision');
var { decideProviderOriginPull } = require('../../../src/slices/calendar/domain/provider-origin-pull-decision');
var facade = require('../../../src/slices/calendar/facade');
var { PLACEMENT_MODES } = require('../../../src/lib/placementModes');
var taskMappers = require('../../../src/slices/task/domain/mappers/taskMappers');
var unifiedSchedule = require('../../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');

var TZ = 'America/New_York';

function makeEvent(overrides) {
  return Object.assign({
    id: 'evt_1',
    title: 'telehealth appointment with Dr. Peter Nguyen',
    startDateTime: '2026-06-15T13:00:00',
    endDateTime: '2026-06-15T14:00:00',
    isAllDay: false,
    durationMinutes: 60,
    isTransparent: false,
    description: ''
  }, overrides);
}

function ingestCtx(overrides) {
  return Object.assign({
    event: makeEvent(),
    existingTask: null,
    isPast: false,
    isJugglerOriginBody: false,
    orphanMatch: null,
    calIngestMode: 'task',
    pid: 'gcal',
    jugglerOrigin: 'juggler'
  }, overrides);
}

// ── Ingest: transparency must not demote a new event to a reminder ────────────
describe('999.4671 ingest: a transparent ("Free") provider event still becomes a time block', () => {
  test('timed transparent event → FIXED, not REMINDER', () => {
    var d = decideIngestEvent(ingestCtx({ event: makeEvent({ isTransparent: true }) }));
    expect(d.action).toBe('promote');
    expect(d.placementMode).toBe(PLACEMENT_MODES.FIXED);
    expect(d.isReminder).toBe(false);
    // The block must keep its real length — a 0-dur task consumes no occupancy.
    expect(d.dur).toBe(60);
  });

  test('all-day transparent event → ALL_DAY, not REMINDER', () => {
    var d = decideIngestEvent(ingestCtx({
      event: makeEvent({ isTransparent: true, isAllDay: true, durationMinutes: 30 })
    }));
    expect(d.placementMode).toBe(PLACEMENT_MODES.ALL_DAY);
  });

  test('opaque timed event → FIXED (unchanged)', () => {
    var d = decideIngestEvent(ingestCtx());
    expect(d.placementMode).toBe(PLACEMENT_MODES.FIXED);
  });

  // The per-calendar ingest_mode IS a Juggler-side choice, so it still wins.
  test('calIngestMode="reminder" still ingests as REMINDER (Juggler-side setting)', () => {
    var d = decideIngestEvent(ingestCtx({ calIngestMode: 'reminder' }));
    expect(d.placementMode).toBe(PLACEMENT_MODES.REMINDER);
    expect(d.isReminder).toBe(true);
  });
});

// The sync controller passes rowToTask() output as `currentTask`/`task`, NOT a raw
// DB row — its key is camelCase `placementMode`. Building fixtures through the real
// mapper is load-bearing: hand-written `{ placement_mode: … }` literals made
// 999.2030's guard look green for months while it was dead in production against
// the actual caller (harrison finding 1). A key rename now fails here.
// scheduled_at 17:00Z == 1:00 PM America/New_York, matching makeEvent()'s anchor.
function syncedTask(placementMode, extra) {
  return taskMappers.rowToTask(Object.assign({
    id: 'gcal_appt', text: 'telehealth appointment', dur: 60,
    placement_mode: placementMode,
    scheduled_at: '2026-06-15T17:00:00.000Z'
  }, extra || {}), TZ);
}

describe('999.4671 fixture contract: rowToTask exposes placementMode, not placement_mode', () => {
  test('the sync-controller task shape has no snake_case placement key', () => {
    var t = syncedTask(PLACEMENT_MODES.REMINDER);
    expect(t.placementMode).toBe(PLACEMENT_MODES.REMINDER);
    expect(t.placement_mode).toBeUndefined();
    // The anchor the adapters diff against must also be present, or the
    // date/time-change promotion below would be vacuous.
    expect(t.date).toBe('2026-06-15');
    expect(t.time).toBe('1:00 PM');
  });
});

// ── Pull of an external edit: placement_mode is Juggler's, not the provider's ──
var ADAPTERS = [
  ['GCal',  facade.GoogleCalendarAdapter,    {}],
  ['MSFT',  facade.MicrosoftCalendarAdapter, { startTimezone: 'Eastern Standard Time' }],
  ['Apple', facade.AppleCalendarAdapter,     {}]
];

describe.each(ADAPTERS)('999.4671 %s adapter: transparency never rewrites placement_mode', (name, adapter, extra) => {
  test('event turning transparent does NOT demote a FIXED task to REMINDER', () => {
    var event = makeEvent(Object.assign({ isTransparent: true }, extra));
    var fields = adapter.applyEventToTaskFields(event, TZ, syncedTask(PLACEMENT_MODES.FIXED));
    expect(fields.placement_mode).toBeUndefined();
  });

  test('a Juggler-side REMINDER survives a pull of a busy (opaque) event', () => {
    var event = makeEvent(Object.assign({ isTransparent: false }, extra));
    var fields = adapter.applyEventToTaskFields(event, TZ, syncedTask(PLACEMENT_MODES.REMINDER));
    expect(fields.placement_mode).toBeUndefined();
  });

  test('an all-day event is still ALL_DAY even when transparent', () => {
    var event = makeEvent(Object.assign({
      isTransparent: true,
      isAllDay: true,
      startDateTime: '2026-06-15',
      endDateTime: '2026-06-16'
    }, extra));
    var fields = adapter.applyEventToTaskFields(event, TZ, null);
    expect(fields.placement_mode).toBe(PLACEMENT_MODES.ALL_DAY);
  });

  test('rescheduling the event in the provider does NOT un-do a Juggler-side REMINDER', () => {
    var event = makeEvent(Object.assign({
      startDateTime: '2026-06-15T15:00:00',
      endDateTime: '2026-06-15T16:00:00'
    }, extra));
    var fields = adapter.applyEventToTaskFields(event, TZ, syncedTask(PLACEMENT_MODES.REMINDER));
    expect(fields.placement_mode).toBeUndefined();
    // The reschedule itself still lands — only the placement is left alone.
    expect(fields.scheduled_at).toBeDefined();
  });

  test('a real date/time move still promotes to FIXED (999.2030 anchor rule kept)', () => {
    var event = makeEvent(Object.assign({
      startDateTime: '2026-06-15T15:00:00',
      endDateTime: '2026-06-15T16:00:00'
    }, extra));
    var fields = adapter.applyEventToTaskFields(event, TZ, syncedTask(PLACEMENT_MODES.ANYTIME));
    expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
  });
});

// ── Ingest-only calendars: the FIXED force must not eat a Juggler reminder ────
describe('999.4671 ingest-only pull: forcePlacementFixed spares a Juggler-side REMINDER', () => {
  function pullCtx(task) {
    return {
      task: task,
      event: makeEvent(),
      ledger: { origin: 'gcal', provider_event_id: 'evt_1' },
      pid: 'gcal',
      isIngestOnly: true,
      jugglerOrigin: 'juggler',
      isTaskTerminal: false,
      calendarLabels: {}
    };
  }

  test('a non-reminder task is still forced back to FIXED (repair path kept)', () => {
    var d = decideProviderOriginPull(pullCtx(syncedTask(PLACEMENT_MODES.ANYTIME)));
    expect(d.action).toBe('pull');
    expect(d.forcePlacementFixed).toBe(true);
  });

  test('a REMINDER task is pulled but NOT forced to FIXED', () => {
    var d = decideProviderOriginPull(pullCtx(syncedTask(PLACEMENT_MODES.REMINDER)));
    expect(d.action).toBe('pull');
    expect(d.forcePlacementFixed).toBe(false);
  });
});

// ── The consequence the ruling is actually about: no double-booking ───────────
describe('999.4671 scheduler: a synced FIXED event owns its slot', () => {
  var TODAY = '2026-03-22';
  var cfg = { timeBlocks: DEFAULT_TIME_BLOCKS, toolMatrix: DEFAULT_TOOL_MATRIX, splitMinDefault: 15 };

  function overlapsAppointment(placement) {
    var start = placement.start;
    var end = placement.start + placement.dur;
    return start < 840 && end > 780;   // appointment 13:00–14:00 = [780, 840)
  }

  // The filler is load-bearing, NOT scenery: with only a 60-minute companion task
  // the scheduler parks it at 08:00 and the assertion passes even with the
  // appointment as a dur=0 REMINDER — i.e. green on both broken and fixed code
  // (harrison finding 4; the TRAPS.md non-occupying-blocker pattern). A 5-hour
  // P1 task genuinely competes for the 13:00–14:00 window, so the two states
  // diverge: FIXED → filler cannot fit and is left unplaced; REMINDER → filler
  // spreads across 12:00–17:00 and swallows the appointment.
  function appointmentTask(placementMode) {
    return {
      id: 'gcal_appt', text: 'telehealth appointment', date: TODAY, time: '1:00 PM',
      dur: 60, pri: 'P3', when: '', dayReq: 'any', status: '',
      placementMode: placementMode
    };
  }
  var FILLER = {
    id: 'filler', text: 'long block of deep work', date: TODAY,
    dur: 300, pri: 'P1', when: '', dayReq: 'any', status: '',
    placementMode: PLACEMENT_MODES.ANYTIME
  };

  function placementsOver(result) {
    var day = result.dayPlacements[TODAY] || [];
    return day.filter(function(p) {
      return p.task && p.task.id !== 'gcal_appt' && overlapsAppointment(p);
    });
  }

  test('a competing task is not placed over a 13:00–14:00 synced FIXED appointment', () => {
    var result = unifiedSchedule([appointmentTask(PLACEMENT_MODES.FIXED), FILLER], {}, TODAY, 480, cfg);
    expect(placementsOver(result)).toHaveLength(0);
  });

  // Counterfactual that makes the test above non-vacuous: the SAME workload with
  // the appointment misclassified as a REMINDER does double-book it. This is the
  // exact defect 999.4671 fixes at ingest — pinned here so a future change that
  // re-demotes synced events cannot pass the assertion above by accident.
  test('the same workload DOES double-book when the appointment is a REMINDER (dur=0 marker)', () => {
    var result = unifiedSchedule([appointmentTask(PLACEMENT_MODES.REMINDER), FILLER], {}, TODAY, 480, cfg);
    expect(placementsOver(result).length).toBeGreaterThan(0);
  });

  // WHY the misclassification double-books: REMINDER placements are dur=0 markers
  // that deliberately coexist with real work. Pinned so the mechanism stays visible.
  test('the same appointment as a REMINDER consumes no occupancy (dur=0 marker)', () => {
    var tasks = [
      {
        id: 'gcal_appt', text: 'telehealth appointment', date: TODAY, time: '1:00 PM',
        dur: 60, pri: 'P3', when: '', dayReq: 'any', status: '',
        placementMode: PLACEMENT_MODES.REMINDER
      }
    ];
    var result = unifiedSchedule(tasks, {}, TODAY, 480, cfg);
    var day = result.dayPlacements[TODAY] || [];
    var appt = day.filter(function(p) { return p.task && p.task.id === 'gcal_appt'; });
    expect(appt.length).toBeGreaterThan(0);
    appt.forEach(function(p) { expect(p.dur).toBe(0); });
  });
});
