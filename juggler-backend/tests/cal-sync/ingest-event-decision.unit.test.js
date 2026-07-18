/**
 * ingest-event-decision.unit.test.js — DB-FREE decision-table unit tests for the
 * pure `decideIngestEvent(ctx)` use-case carved out of cal-sync's Phase 3b
 * re-ingest loop in controllers/cal-sync.controller.js (999.1025 inc. 9).
 *
 * The loop walks every fetched provider event with no ledger yet and resolves it
 * to one of five outcomes, evaluated in this exact precedence:
 *   1. LINK          — event already bound to a task via its event-id column
 *   2. SKIP-PAST     — past event → task_id-NULL skip ledger row
 *   3. ORPHAN-RECLAIM— Juggler round-trip body + a matching unprocessed task
 *   4. ORPHAN-DELETE — Juggler round-trip body + no matching task
 *   5. PROMOTE       — genuine new future event → new task (placement/when/dur)
 *
 * PURE — decisions in, effects out. No DB, no HTTP, no clock, no crypto: the
 * caller keeps every INSERT buffer, stats counter, log, the orphan deleteEvent
 * call, and the processed-id bookkeeping. This test pins the action selection,
 * the LINK origin, and the PROMOTE field derivations; the DB-backed behavior
 * stays owned by the W4 golden (G-ingest axis).
 */

'use strict';

var { decideIngestEvent } = require('../../src/slices/calendar/domain/ingest-event-decision');
var { PLACEMENT_MODES } = require('../../src/lib/placementModes');

function makeEvent(over) {
  return Object.assign({
    title: 'Dentist appointment', isAllDay: false, isTransparent: false,
    durationMinutes: 60
  }, over || {});
}
function ctx(over) {
  return Object.assign({
    event: makeEvent(),
    existingTask: null,
    isPast: false,
    isJugglerOriginBody: false,
    orphanMatch: null,
    calIngestMode: 'task',
    pid: 'gcal',
    jugglerOrigin: 'juggler'
  }, over || {});
}

// ── 1. LINK — event already bound to a task ───────────────────────────────────

describe('decideIngestEvent — link (already bound)', function () {
  it('1: provider-ingested task (id prefixed pid_) → link, origin = pid', function () {
    var d = decideIngestEvent(ctx({ existingTask: { id: 'gcal_abc123' } }));
    expect(d.action).toBe('link');
    expect(d.origin).toBe('gcal');
  });

  it('2: Juggler-owned task manually linked → link, origin = juggler sentinel', function () {
    var d = decideIngestEvent(ctx({ existingTask: { id: 'task-42' } }));
    expect(d.action).toBe('link');
    expect(d.origin).toBe('juggler');
  });

  it('3: link WINS over isPast/round-trip/promote (evaluated first)', function () {
    var d = decideIngestEvent(ctx({
      existingTask: { id: 'msft_xyz' }, pid: 'msft',
      isPast: true, isJugglerOriginBody: true, orphanMatch: { id: 'o1' }
    }));
    expect(d.action).toBe('link');
    expect(d.origin).toBe('msft');
  });

  it('4: prefix must be an EXACT "<pid>_" head — apple_ task under gcal pid → juggler', function () {
    var d = decideIngestEvent(ctx({ existingTask: { id: 'apple_deadbeef' }, pid: 'gcal' }));
    expect(d.action).toBe('link');
    expect(d.origin).toBe('juggler');
  });
});

// ── 2. SKIP-PAST — past event, no ledger ──────────────────────────────────────

describe('decideIngestEvent — skip-past', function () {
  it('5: past event (not linked) → skip-past', function () {
    var d = decideIngestEvent(ctx({ isPast: true }));
    expect(d.action).toBe('skip-past');
  });

  it('6: skip-past WINS over round-trip/promote (evaluated before them)', function () {
    var d = decideIngestEvent(ctx({
      isPast: true, isJugglerOriginBody: true, orphanMatch: { id: 'o1' }
    }));
    expect(d.action).toBe('skip-past');
  });
});

// ── 3/4. ORPHAN reclaim vs delete — Juggler round-trip body ───────────────────

describe('decideIngestEvent — orphan round-trip', function () {
  it('7: round-trip body + matching unprocessed task → orphan-reclaim', function () {
    var d = decideIngestEvent(ctx({
      isJugglerOriginBody: true, orphanMatch: { id: 'src-task' }
    }));
    expect(d.action).toBe('orphan-reclaim');
  });

  it('8: round-trip body + NO matching task → orphan-delete', function () {
    var d = decideIngestEvent(ctx({ isJugglerOriginBody: true, orphanMatch: null }));
    expect(d.action).toBe('orphan-delete');
  });

  it('9: reclaim/delete only when body flagged — no marker → promote (not orphan)', function () {
    var d = decideIngestEvent(ctx({ isJugglerOriginBody: false, orphanMatch: { id: 'x' } }));
    expect(d.action).toBe('promote');
  });
});

// ── 5. PROMOTE — genuine new future event, with pure field derivations ────────

describe('decideIngestEvent — promote (new task)', function () {
  it('10: timed non-reminder event → promote, placement FIXED, when "", dur passthrough', function () {
    var d = decideIngestEvent(ctx({ event: makeEvent({ durationMinutes: 45 }) }));
    expect(d.action).toBe('promote');
    expect(d.placementMode).toBe(PLACEMENT_MODES.FIXED);
    expect(d.when).toBe('');
    expect(d.dur).toBe(45);
    expect(d.isReminder).toBe(false);
  });

  it('11: all-day event → placement ALL_DAY, when "allday", dur 0', function () {
    var d = decideIngestEvent(ctx({ event: makeEvent({ isAllDay: true, durationMinutes: 60 }) }));
    expect(d.action).toBe('promote');
    expect(d.placementMode).toBe(PLACEMENT_MODES.ALL_DAY);
    expect(d.when).toBe('allday');
    expect(d.dur).toBe(0);
    expect(d.isReminder).toBe(false);
  });

  it('12: reminder-mode calendar (timed) → placement REMINDER, isReminder true, when ""', function () {
    var d = decideIngestEvent(ctx({ calIngestMode: 'reminder' }));
    expect(d.action).toBe('promote');
    expect(d.placementMode).toBe(PLACEMENT_MODES.REMINDER);
    expect(d.isReminder).toBe(true);
    expect(d.when).toBe('');
  });

  it('13: reminder mode has NO effect on an all-day event → ALL_DAY, isReminder false', function () {
    var d = decideIngestEvent(ctx({
      calIngestMode: 'reminder', event: makeEvent({ isAllDay: true })
    }));
    expect(d.placementMode).toBe(PLACEMENT_MODES.ALL_DAY);
    expect(d.isReminder).toBe(false);
  });

  it('14: transparent event → placement REMINDER regardless of calendar/all-day', function () {
    var d = decideIngestEvent(ctx({ event: makeEvent({ isTransparent: true }) }));
    expect(d.action).toBe('promote');
    expect(d.placementMode).toBe(PLACEMENT_MODES.REMINDER);
    // isReminder tracks the calIngestMode reminder path, NOT transparency:
    expect(d.isReminder).toBe(false);
  });

  it('15: transparent WINS the placement ternary even for an all-day reminder-mode event', function () {
    var d = decideIngestEvent(ctx({
      calIngestMode: 'reminder',
      event: makeEvent({ isTransparent: true, isAllDay: true, durationMinutes: 30 })
    }));
    expect(d.placementMode).toBe(PLACEMENT_MODES.REMINDER);
    expect(d.when).toBe('allday');
    expect(d.dur).toBe(0);
  });
});
