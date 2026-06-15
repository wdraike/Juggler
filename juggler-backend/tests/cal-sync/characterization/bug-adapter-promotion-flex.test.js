/**
 * bug-adapter-promotion-flex.test.js
 *
 * Regression tests for ROADMAP 999.012 / JUG-MED-16:
 *   BUG-1 — Spurious promotion of flexible (anytime/null-anchor) tasks to
 *            placement_mode='fixed' on every sync of a timed event.
 *   BUG-2 — Controller provider-origin pull unconditionally overrides
 *            placement_mode=FIXED even for title/duration-only changes on
 *            flexible tasks (adapter-level coverage of the bug; see comment
 *            below for why the controller line itself is a separate concern).
 *
 * Design reference:
 *   juggler-backend/docs/architecture/SYNC-EVENT-TO-TASK-HANDOFF.md
 *   TRACEABILITY.md rows: BUG-1, BUG-2, INV-1
 *
 * ALL TESTS ARE PURE UNIT — no DB, no network, no credentials required.
 * The adapters call db.fn.now() synchronously (returns a knex raw expression,
 * not a DB query) — safe to call without a live connection.
 *
 * Test organisation:
 *   Section A — BUG-1: flexible task must NOT be promoted (RED on pre-fix code)
 *   Section B — BUG-2: title/dur-only change on flexible task — adapter must
 *                       NOT set fixed (RED on pre-fix code)
 *   Section C — Regression guards (must stay GREEN on pre-fix AND post-fix code):
 *               genuine date/time changes DO promote; all-day sets all_day;
 *               transparent events set reminder.
 *
 * Traceability:
 *   BUG-1  → Section A tests (must FAIL on pre-fix code)
 *   BUG-2  → Section B tests (must FAIL on pre-fix code)
 *   INV-1  → Section C tests (must PASS on pre-fix code; must still PASS post-fix)
 */

'use strict';

var gcalAdapter  = require('../../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter  = require('../../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../../src/lib/cal-adapters/apple.adapter');
var { PLACEMENT_MODES } = require('../../../src/lib/placementModes');

var TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * A normalized timed event arriving from the calendar provider.
 * startDateTime is in the format returned by adapter normalizeEvent().
 */
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

/**
 * A currentTask that is flexible: no anchor date or time set.
 * Represents an anytime task that has never been scheduled to a fixed slot.
 */
function flexibleTask(overrides) {
  return Object.assign({
    placement_mode: PLACEMENT_MODES.ANYTIME,
    date: null,
    time: null
  }, overrides);
}

/**
 * A currentTask that already has a concrete anchor (date + time set).
 */
function anchoredTask(overrides) {
  return Object.assign({
    placement_mode: PLACEMENT_MODES.FIXED,
    date: '2026-06-15',
    time: '10:00 AM'
  }, overrides);
}

// ---------------------------------------------------------------------------
// Section A — BUG-1: flexible task must NOT be promoted to fixed
//
// Expected behaviour (per design doc): promotion to 'fixed' only when an
// ALREADY-ANCHORED task's date OR time actually changed.  A null→value
// transition (flexible task gaining its first computed anchor) is NOT a
// promotion trigger.
//
// On PRE-FIX code these tests FAIL because the condition
//   jd.date && jd.date !== currentTask?.date
// evaluates '2026-06-15' !== null → true, and FIXED is set spuriously.
// ---------------------------------------------------------------------------

describe('BUG-1 [RED on pre-fix]: flexible task must NOT be promoted on sync of timed event', function () {

  // ── A1: Google Calendar adapter ──────────────────────────────────────────

  describe('GCal adapter — applyEventToTaskFields', function () {
    it('A1-1: anytime task (date=null, time=null) syncing a timed event → placement_mode must NOT be fixed', function () {
      var event   = timedEvent();
      var current = flexibleTask();

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);

      // Post-fix contract: when no promotion is warranted the adapter omits the
      // placement_mode key entirely (does not write it to the DB update object).
      // Asserting key-absent is more specific than .not.toBe('fixed') — it would
      // also catch a future bug that set a DIFFERENT wrong placement_mode.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });

    it('A1-2: anytime task with placement_mode=anytime (explicit) → still must NOT be promoted', function () {
      var event   = timedEvent({ startDateTime: '2026-06-20T14:00:00', endDateTime: '2026-06-20T14:30:00' });
      var current = flexibleTask({ placement_mode: 'anytime' });

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: key absent — adapter does not write placement_mode when no
      // promotion fires.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });

    it('A1-3: task with date=undefined, time=undefined (undefined vs null — same bug path) → NOT fixed', function () {
      var event   = timedEvent();
      // Some code paths may produce undefined rather than null
      var current = { placement_mode: 'anytime', date: undefined, time: undefined };

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: undefined anchor is also a falsy guard — jd.date && currentTask?.date
      // short-circuits on undefined just as on null. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

  // ── A2: Microsoft Calendar adapter ───────────────────────────────────────

  describe('MSFT adapter — applyEventToTaskFields', function () {
    it('A2-1: anytime task (date=null, time=null) syncing a timed event → NOT fixed', function () {
      var event   = timedEvent({ startTimezone: 'Eastern Standard Time' });
      var current = flexibleTask();

      var fields = msftAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: key absent when no promotion fires.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });

    it('A2-2: anytime task with different timed event datetime → NOT fixed', function () {
      var event   = timedEvent({
        startDateTime: '2026-07-04T09:00:00',
        endDateTime:   '2026-07-04T09:30:00',
        startTimezone: 'Eastern Standard Time'
      });
      var current = flexibleTask({ placement_mode: 'anytime' });

      var fields = msftAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: null anchor, no promotion. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

  // ── A3: Apple Calendar adapter ───────────────────────────────────────────

  describe('Apple adapter — applyEventToTaskFields', function () {
    it('A3-1: anytime task (date=null, time=null) syncing a timed event → NOT fixed', function () {
      var event   = timedEvent();
      var current = flexibleTask();

      var fields = appleAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: key absent when no promotion fires.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });

    it('A3-2: anytime task with null anchor, different event date → NOT fixed', function () {
      var event   = timedEvent({
        startDateTime: '2026-08-01T15:00:00',
        endDateTime:   '2026-08-01T15:30:00'
      });
      var current = flexibleTask({ placement_mode: 'anytime' });

      var fields = appleAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: null anchor, no promotion. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

});

// ---------------------------------------------------------------------------
// Section B — BUG-2 (adapter surface): title/duration-only change on flexible
// task must NOT set placement_mode=fixed in the adapter.
//
// The controller's unconditional override (L1005) is the second mechanism for
// BUG-2.  That line forces FIXED AFTER the adapter call, so testing it requires
// hooking the controller — too heavyweight for a unit-layer RED test.  Instead
// we pin the adapter-layer invariant that guarantees the adapter itself is not
// contributing the FIXED write.  The controller BUG-2 line (cal-sync.controller
// ~L1005) is documented below; fixing BUG-2 fully requires removing that line.
//
// On PRE-FIX code these tests FAIL because the date/time comparison condition
// fires (null anchor vs non-null jd values).  They are equivalent to the A-block
// tests but framed around a "title-only changed" scenario for clarity.
// ---------------------------------------------------------------------------

describe('BUG-2 [RED on pre-fix, adapter surface]: title/dur-only change must NOT promote flexible task', function () {

  /**
   * NOTE on controller BUG-2 (L1005 of cal-sync.controller.js):
   *
   *   provPullFields.placement_mode = PLACEMENT_MODES.FIXED;  // unconditional
   *
   * This line fires for ANY provider-origin modification (gated only by lastModified
   * / etag), so even a title-only change on a flexible task gets FIXED written.
   * Fixing this requires gating the override: only write FIXED if the adapter's
   * returned provPullFields already contains placement_mode===FIXED (i.e. the
   * adapter's change-detection actually fired). The adapter-level regression tests
   * below prove the adapter is clean; the controller fix must be verified separately.
   *
   * Controller location: src/controllers/cal-sync.controller.js ~L1004-1005
   */

  describe('GCal adapter — title-only change on flexible task', function () {
    it('B1-1: title changed, date+time match task anchor → NOT fixed (date+time equal case)', function () {
      // Anchored task: date='2026-06-15', time='10:00 AM'
      // Event: same date+time, different title — only text changed.
      var event   = timedEvent({ title: 'Team Standup RENAMED' });
      var current = anchoredTask({ date: '2026-06-15', time: '10:00 AM' });

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);

      // When the adapter converts '2026-06-15T10:00:00' America/New_York →
      // jd.date='2026-06-15', jd.time='10:00 AM' — both match currentTask,
      // so dateChanged=false and timeChanged=false. No REMINDER (not transparent),
      // no ALL_DAY (not all-day). Post-fix contract: placement_mode key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });

    it('B1-2: flexible task (null anchor), title changed → NOT fixed', function () {
      // Same as A1-1 but framed as "title-only" to make the BUG-2 intent clear.
      var event   = timedEvent({ title: 'New Title From Provider' });
      var current = flexibleTask();

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: null anchor, no promotion. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

  describe('MSFT adapter — title-only change on flexible task', function () {
    it('B2-1: flexible task (null anchor), title changed → NOT fixed', function () {
      var event   = timedEvent({ title: 'Updated Title MSFT', startTimezone: 'Eastern Standard Time' });
      var current = flexibleTask();

      var fields = msftAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: null anchor, no promotion. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

  describe('Apple adapter — title-only change on flexible task', function () {
    it('B3-1: flexible task (null anchor), title changed → NOT fixed', function () {
      var event   = timedEvent({ title: 'Updated Title Apple' });
      var current = flexibleTask();

      var fields = appleAdapter.applyEventToTaskFields(event, TZ, current);
      // Post-fix: null anchor, no promotion. Key absent.
      expect('placement_mode' in fields).toBe(false);
      expect(fields.placement_mode).toBe(undefined);
    });
  });

});

// ---------------------------------------------------------------------------
// Section C — Regression guards (INV-1): intended promotion paths must still
// work after the bug fix.  These MUST PASS on pre-fix AND post-fix code.
// ---------------------------------------------------------------------------

describe('INV-1 [MUST STAY GREEN]: genuine change-detection promotion still fires', function () {

  // ── C1: Genuine date change on an anchored task ──────────────────────────

  describe('GCal adapter — genuine date change promotes anchored task', function () {
    it('C1-1: anchored task date changes 2026-06-01 → 2026-06-05 → placement_mode=fixed', function () {
      // Event is on 2026-06-05; currentTask was anchored on 2026-06-01.
      var event = timedEvent({
        startDateTime: '2026-06-05T10:00:00',
        endDateTime:   '2026-06-05T10:30:00'
      });
      var current = anchoredTask({ date: '2026-06-01', time: '10:00 AM' });

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  // ── C2: Genuine time change on an anchored task ──────────────────────────

  describe('GCal adapter — genuine time change promotes anchored task', function () {
    it('C2-1: anchored task time changes 10:00 AM → 2:00 PM → placement_mode=fixed', function () {
      // Same date (2026-06-15), different time.
      var event = timedEvent({
        startDateTime: '2026-06-15T14:00:00',
        endDateTime:   '2026-06-15T14:30:00'
      });
      var current = anchoredTask({ date: '2026-06-15', time: '10:00 AM' });

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  // ── C3: All-day event sets placement_mode=all_day, NOT fixed ─────────────

  describe('All three adapters — all-day event sets all_day mode', function () {
    var allDayEvent = {
      title: 'Conference Day',
      startDateTime: '2026-06-20',
      endDateTime: '2026-06-20',
      isAllDay:    true,
      durationMinutes: 0,
      isTransparent: false,
      description: ''
    };

    it('C3-1: GCal all-day event → placement_mode=all_day (not fixed)', function () {
      var current = flexibleTask();
      var fields  = gcalAdapter.applyEventToTaskFields(allDayEvent, TZ, current);

      expect(fields.placement_mode).toBe(PLACEMENT_MODES.ALL_DAY);
      expect(fields.placement_mode).not.toBe(PLACEMENT_MODES.FIXED);
    });

    it('C3-2: MSFT all-day event → placement_mode=all_day (not fixed)', function () {
      var current = flexibleTask();
      var fields  = msftAdapter.applyEventToTaskFields(allDayEvent, TZ, current);

      expect(fields.placement_mode).toBe(PLACEMENT_MODES.ALL_DAY);
      expect(fields.placement_mode).not.toBe(PLACEMENT_MODES.FIXED);
    });

    it('C3-3: Apple all-day event → placement_mode=all_day (not fixed)', function () {
      var current = flexibleTask();
      var fields  = appleAdapter.applyEventToTaskFields(allDayEvent, TZ, current);

      expect(fields.placement_mode).toBe(PLACEMENT_MODES.ALL_DAY);
      expect(fields.placement_mode).not.toBe(PLACEMENT_MODES.FIXED);
    });
  });

  // ── C4: Transparent event sets placement_mode=reminder ───────────────────
  //
  // NOTE: A transparent event on a FLEXIBLE task (null anchor) also triggers
  // BUG-1 — the FIXED block fires after REMINDER is set and overwrites it.
  // To isolate "transparent sets reminder" from BUG-1, we use an ANCHORED task
  // where jd.date/time match the current anchor — so dateChanged=false,
  // timeChanged=false, and the FIXED block does NOT fire even on pre-fix code.
  // This makes C4 a true regression guard (GREEN pre-fix AND post-fix).
  //
  // A1-1 through A3-2 and B-block tests already cover the flexible-task case.

  describe('All three adapters — transparent event sets reminder mode', function () {
    // Anchored task with SAME date/time as the timed event so BUG-1 does not
    // interfere.  isoToJugglerDate('2026-06-15T10:00:00', 'America/New_York')
    // produces { date: '2026-06-15', time: '10:00 AM' }.
    var transparentEvent = timedEvent({ isTransparent: true });
    var anchoredMatchingTask = anchoredTask({ date: '2026-06-15', time: '10:00 AM' });

    it('C4-1: GCal transparent event (anchored, matching date+time) → placement_mode=reminder', function () {
      var fields = gcalAdapter.applyEventToTaskFields(transparentEvent, TZ, anchoredMatchingTask);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.REMINDER);
    });

    it('C4-2: MSFT transparent event (anchored, matching date+time) → placement_mode=reminder', function () {
      var fields = msftAdapter.applyEventToTaskFields(transparentEvent, TZ, anchoredMatchingTask);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.REMINDER);
    });

    it('C4-3: Apple transparent event (anchored, matching date+time) → placement_mode=reminder', function () {
      var fields = appleAdapter.applyEventToTaskFields(transparentEvent, TZ, anchoredMatchingTask);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.REMINDER);
    });
  });

  // ── C5: MSFT and Apple genuine date change also promotes ──────────────────

  describe('MSFT adapter — genuine date change promotes anchored task', function () {
    it('C5-1: anchored task date changes → placement_mode=fixed', function () {
      var event = timedEvent({
        startDateTime: '2026-06-05T10:00:00',
        endDateTime:   '2026-06-05T10:30:00',
        startTimezone: 'Eastern Standard Time'
      });
      var current = anchoredTask({ date: '2026-06-01', time: '10:00 AM' });

      var fields = msftAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  describe('Apple adapter — genuine date change promotes anchored task', function () {
    it('C6-1: anchored task date changes → placement_mode=fixed', function () {
      var event = timedEvent({
        startDateTime: '2026-06-05T10:00:00',
        endDateTime:   '2026-06-05T10:30:00'
      });
      var current = anchoredTask({ date: '2026-06-01', time: '10:00 AM' });

      var fields = appleAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  // ── C7: Former reminder task with date+time change gets fixed ────────────
  // (Guards the reminder→fixed ordering that 01-adapter-gcal already pins —
  //  included here so this file is self-contained for the promotion bug leg.)

  describe('GCal adapter — formerly-reminder task with date/time change gets fixed', function () {
    it('C7-1: reminder task, event no longer transparent + date changes → fixed wins', function () {
      var event = timedEvent({
        startDateTime: '2026-05-25T10:00:00',
        endDateTime:   '2026-05-25T11:00:00',
        isTransparent: false
      });
      var current = {
        placement_mode: PLACEMENT_MODES.REMINDER,
        date: '2026-05-20',
        time: '9:00 AM'
      };

      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

});
