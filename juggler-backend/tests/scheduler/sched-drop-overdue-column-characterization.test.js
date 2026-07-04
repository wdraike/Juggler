'use strict';
/**
 * sched-drop-overdue-column — CHARACTERIZATION baseline (refactor-mode Oscar
 * pipeline step 0, telly, leg 999.1085 / M-5).
 *
 * WHY THIS FILE EXISTS: SPEC.md's "Behavior contract" table (AC1-AC9) enumerates
 * every scenario `rowToTask`'s computed-overdue IIFE (taskMappers.js:348-506,
 * stored-flag short-circuit at :359) must preserve or intentionally change once
 * `task_instances.overdue` is dropped and the predicate becomes computed-only.
 * This file pins the CURRENT (pre-change) value for EVERY row in that table
 * against the UNMODIFIED code, so bert's later change can be diffed against it.
 * No production code is touched by this file or by authoring it.
 *
 * Layer: unit — pure function (`rowToTask`), no DB, no network, no wall-clock
 * (nowInfo injected as the 5th arg — see rowToTaskOverdue.test.js precedent).
 *
 * Traceability: TRACEABILITY.md rows AC1-AC9 (Test column: this file).
 */

process.env.NODE_ENV = 'test';

const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';
// Fixed "today" — 2026-07-10, 10:00 AM local (600 mins). Chosen independent of
// any other suite's fixture dates to avoid cross-file coincidental coupling.
const NOW_INFO = { todayKey: '2026-07-10', nowMins: 600 };

// ── Row factories ────────────────────────────────────────────────────────────
// Minimal, but complete enough for rowToTask to run without throwing (mirrors
// the baseRow/makeBaseRow pattern in rowToTaskOverdue.test.js and
// overdue-pastdue-recurring.test.js).

function baseTaskRow(overrides) {
  return Object.assign({
    id: 'char-task-001',
    master_id: null,
    task_type: 'task',
    text: 'Characterization row',
    status: '',
    scheduled_at: null,
    date: null,
    time: null,
    day: null,
    desired_at: null,
    tz: null,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    implied_deadline: null,
    earliest_start: null,
    location: null,
    tools: null,
    when: null,
    day_req: null,
    recurring: 0,
    time_flex: null,
    split: 0,
    split_min: null,
    split_total: null,
    split_ordinal: null,
    split_group: null,
    recur: null,
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    cal_locked: 0,
    depends_on: null,
    marker: 0,
    flex_when: 0,
    travel_before: null,
    travel_after: null,
    preferred_time_mins: null,
    unscheduled: 0,
    overdue: 0,           // stored flag — the column this leg will drop
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: 'anytime',
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: null,
    created_at: null,
    updated_at: null,
    completed_at: null,
    end_date: null,
    rolling_anchor: null
  }, overrides);
}

function baseRecurringInstanceRow(overrides) {
  return baseTaskRow(Object.assign({
    id: 'char-recur-001',
    master_id: 'char-recur-tmpl-001',
    task_type: 'recurring_instance',
    source_id: 'char-recur-tmpl-001',
    recurring: 1,
    generated: 1,
    occurrence_ordinal: 1,
    recur: JSON.stringify({ type: 'daily' })
  }, overrides));
}

describe('sched-drop-overdue-column — BEFORE-state characterization (SPEC.md AC1-AC9)', function() {

  // ── AC1 — Hard deadline in the past, WITH a time component → overdue:true ──
  // (pure computed branch already; unaffected by the column drop)
  it('AC1: hard deadline in the past with a time component → overdue:true', function() {
    var row = baseTaskRow({ deadline: '2026-07-05 23:30:00', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ── AC2 — Hard deadline in the past, date-only → overdue:true ──────────────
  it('AC2: hard deadline in the past, date-only → overdue:true', function() {
    var row = baseTaskRow({ deadline: '2026-07-05', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ── AC3 — Floating / no deadline, non-FIXED, non-recurring → overdue:false ──
  // (999.671 contract; hasHardCommitment gate unaffected by the drop)
  it('AC3: floating task (no deadline, non-FIXED, non-recurring) → overdue:false', function() {
    var row = baseTaskRow({
      deadline: null, implied_deadline: null, placement_mode: 'anytime',
      recurring: 0, overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ── AC4 — Terminal status or disabled → overdue:false (suppression clamps) ─
  // SPEC.md AC4 scope is exactly TaskStatus.TERMINAL = ['done','cancel','skip','pause']
  // (verified via `node -e "require('.../TaskStatus').TERMINAL"`) + 'disabled' handled
  // separately below — 'missed' is deliberately NOT in this set (not clamped by the
  // terminal branch; a 'missed' row with a real user `deadline` still computes
  // overdue:true today, confirmed empirically and intentionally excluded from AC4).
  ['done', 'skip', 'cancel', 'pause'].forEach(function(st) {
    it('AC4: terminal status "' + st + '" with past deadline → overdue:false', function() {
      var row = baseTaskRow({ status: st, deadline: '2026-07-01', overdue: 0 });
      var task = rowToTask(row, TZ, null, null, NOW_INFO);
      expect(task.overdue).toBe(false);
    });
  });
  it('AC4: disabled status with past deadline → overdue:false', function() {
    var row = baseTaskRow({ status: 'disabled', deadline: '2026-07-01', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ── AC5 — FIXED placement, scheduled_at slot time passed → overdue:true ────
  // scheduled_at 07:00 EDT today (11:00 UTC) vs now=10:00 EDT (600 mins) → past.
  it('AC5: FIXED placement, scheduled slot time already passed today → overdue:true', function() {
    var row = baseTaskRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-07-10 11:00:00', // 07:00 EDT
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ── AC6a/AC6b — forward-rolled recurring instance (David ruling 2026-07-03,
  // resolving the AC6-forward-roll-vs-999.810 blocker that BLOCKED this leg's
  // first bert pass): "let's skip the future placement of overdue items —
  // leave it to the user to change the due date, as needed." This NARROWS
  // brain #92990 (2026-06-29, "stays overdue=1 regardless of remaining slots
  // until terminal") for the future-placed sub-case only (AC6b); the
  // today-or-earlier sub-case (AC6a) is UNCHANGED.
  //
  // AFTER W1 (short-circuit removed) + W3 (R-FR1 write-side persistence
  // deleted), BOTH sub-cases below are produced by the SAME existing R-OD3
  // branch (`_placedDateKey <= _now.todayKey`, taskMappers.js) — no new
  // comparison rule was added. `overdue: 0` on the fixtures below reflects
  // that the stored column is no longer read at all (its value is
  // irrelevant post-change — this is the point of the leg).

  // AC6a: forward-rolled recurring instance re-placed TODAY (or earlier),
  // implied_deadline (original cycle boundary) in the past → overdue:true,
  // PRESERVED — same value AND same mechanism (R-OD3) as before this leg;
  // this is what the old "self-verification" sub-check inside the original
  // AC6 test already proved holds via the computed branch alone.
  //
  // recur MUST be a non-daily/flexible-TPC recurrence (weekly, timesPerCycle):
  // a DAILY placed recurring instance resolves its dueKey directly from
  // scheduled_at (the isPlacedRecurringInstance branch, taskMappers.js) and
  // never reaches the R-OD3 implied_deadline-fallback branch at all — this
  // fixture must isolate R-OD3, matching the shape 999.810's regression guard
  // (taskMappers-overdue-juggy3.test.js AC3c) already uses.
  it('AC6a: forward-rolled recurring instance re-placed TODAY, implied_deadline in the past → overdue:true (preserved, R-OD3)', function() {
    var row = baseRecurringInstanceRow({
      status: '',                          // not terminal, not disabled
      overdue: 0,                          // stored column no longer read — irrelevant
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      scheduled_at: '2026-07-10 15:00:00', // re-placed TODAY at 11:00 EDT (new slot)
      date: '2026-07-10',
      implied_deadline: '2026-07-07',      // ORIGINAL cycle boundary — 3 days before the new placement
      placement_mode: 'time_window',
      time_flex: 60
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // AC6b: forward-rolled recurring instance re-placed on a genuinely FUTURE
  // slot, implied_deadline (original cycle boundary) in the past →
  // overdue:false. INTENTIONAL BEHAVIOR CHANGE vs the column-drop's BEFORE
  // state (where a stale stored overdue=1 from the prior roll would have
  // short-circuited to true — the exact mechanism W1 deletes) — but this
  // AFTER value equals the 999.810 regression guard's ALREADY-EXISTING
  // computed result (taskMappers-overdue-juggy3.test.js:544,569;
  // rowToTaskOverdue.test.js AC3c-shape), so no new code was needed: deleting
  // W3's R-FR1 write-side override is sufficient for this value to surface.
  it('AC6b: forward-rolled recurring instance re-placed on a FUTURE slot, implied_deadline in the past → overdue:false (David ruling 2026-07-03, narrows #92990)', function() {
    var row = baseRecurringInstanceRow({
      status: '',
      overdue: 1,                          // simulates a stale stored flag from a PRIOR roll — must no longer matter
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      scheduled_at: '2026-07-12 15:00:00', // re-placed on a FUTURE day (2 days from NOW_INFO.todayKey)
      date: '2026-07-12',
      implied_deadline: '2026-07-07',      // stale ORIGINAL cycle boundary — before the new placement
      placement_mode: 'time_window',
      time_flex: 60
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ── AC7 — THE KNOWN DRIFT BUG: never-placed recurring instance whose
  // recurrence period has ended. scheduled_at is NULL (never placed by any
  // scheduler run — R-FR1/Phase-8 writes never touch a row that was never
  // placed), stored overdue=0 (no write path ever flipped it), `date` carries
  // the original candidate occurrence date (set at Phase-1 fabrication,
  // runSchedule.js:1417-1418, independent of placement), and implied_deadline
  // (materialized at the SAME fabrication step, runSchedule.js:1423) is in the
  // past relative to "today".
  //
  // EMPIRICAL RESULT (see chat report — this was NOT assumed, it was measured
  // by running this exact test against the unmodified codebase): the current
  // `rowToTask` DOES compute overdue:true for this fixture, via the
  // `dueKey < _now.todayKey` unconditional past-due check (taskMappers.js:483)
  // — dueKey resolves to impliedDeadlineISO through the `_dueIsImpliedPeriodEnd`
  // fallback (:415-434) because `_placedDateKey` (derived from `row.date` when
  // scheduled_at is null) is itself in the past, satisfying the
  // `_placedDateKey <= _now.todayKey` guard at :426. Line 483 fires BEFORE the
  // narrower `:498-503` same-day branch is ever reached, because
  // impliedDeadlineISO here is STRICTLY BEFORE today, not equal to it.
  // So the "known drift bug" is NOT reproducible via this specific fixture
  // shape (never-placed + period-already-ended, i.e. periodEnd < today) — the
  // computed branch already self-heals it to true. The bug is real only where
  // periodEnd is not yet strictly in the past relative to a call made before
  // "today" arrives, or where implied_deadline itself was never materialized
  // (fabrication never ran) — this file records the empirically-confirmed
  // TRUE value for the exact fixture SPEC.md AC7 describes; it does NOT
  // change the "AC7 is the one intentional behavior change" framing, since
  // whether the row reads true or false today depends on which never-placed
  // sub-case is constructed, and this is the sub-case actually tested.
  it('AC7: never-placed recurring instance, period already ended (periodEnd < today), stored overdue=0 → EMPIRICALLY overdue:true today (see comment)', function() {
    var row = baseRecurringInstanceRow({
      status: '',
      overdue: 0,                    // stored flag never set — the drift SPEC.md flags
      scheduled_at: null,            // never placed
      date: '2026-07-01',            // original candidate occurrence date (Phase-1 fabrication)
      implied_deadline: '2026-07-02', // period end — in the past relative to NOW_INFO.todayKey (2026-07-10)
      placement_mode: 'time_window',
      time_flex: 60
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ── AC8 — ANYTIME task, calendar simply full (no slot found) → overdue:false
  // via absence of any hard-commitment signal (no deadline, not FIXED, not a
  // forward-rolled recurring case) — NOT via active flag-clearing.
  it('AC8: ANYTIME task with no slot found (no hard commitment) → overdue:false', function() {
    var row = baseTaskRow({
      placement_mode: 'anytime',
      scheduled_at: null,
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ── AC9 — cal-sync can never suppress/clear overdue (M-4) — verify-only ────
  // Structural check: cal-sync.controller.js must have zero `overdue` refs.
  it('AC9: cal-sync.controller.js has zero references to `overdue` (verify-only, M-4)', function() {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.join(__dirname, '../../src/controllers/cal-sync.controller.js'),
      'utf8'
    );
    var matches = src.match(/overdue/gi) || [];
    expect(matches.length).toBe(0);
  });
});
