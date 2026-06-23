/**
 * Covers: R50 (past-due pinning — locked design), 999.671 (floating task must NOT be overdue)
 * User Stories: David's daily habits (Eat Breakfast, Eat Lunch, etc.) scheduled today at past times
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * Leg: juggler-overdue-pastdue-recurring (Round 1) + juggler-overdue-reschedule (Round 2)
 *
 * BUG (Round 1): rowToTask computed-overdue block:
 *   (1) hasHardCommitment = deadline || implied_deadline || FIXED — is FALSE for
 *       recurring time_window/time_blocks/anytime rows with implied_deadline=NULL
 *       → early-returns false; never reaches same-day time check.
 *   (2) scheduledMins same-day check only fires for placement_mode==='fixed'.
 *   Result: a recurring_instance with placement_mode='time_window', status='',
 *   scheduled TODAY at 07:30 local but now=21:00 local → overdue===FALSE (the bug).
 *
 * BUG (Round 2 — AC4 revert): taskMappers.js:368-370 encodes a DAILY TYPE HEURISTIC that
 *   fires overdue at the SCHEDULED SLOT (scheduledMins < nowMins), not at WINDOW-CLOSE.
 *   Per LOCKED design (SPEC.md AC2/AC4): a windowed daily (e.g. morning, timeFlex=180,
 *   window=8am-11am) whose 8am slot passed at now=9am is still ROAMABLE (window still open)
 *   → overdue MUST be FALSE at 9am. It becomes overdue only when the window CLOSES at 11am.
 *   The slot-time heuristic is OFF-DESIGN: it fires at 8:01am instead of 11am.
 *
 * TODAY = 2026-06-22 (America/New_York, UTC-4 in June)
 * All scheduled_at values are UTC "YYYY-MM-DD HH:MM:SS" (dateStrings form as knex returns).
 *   07:30 local EDT → 11:30 UTC  → '2026-06-22 11:30:00'
 *   08:00 local EDT → 12:00 UTC  → '2026-06-22 12:00:00'
 *   07:00 local EDT → 11:00 UTC  → '2026-06-22 11:00:00'
 *   09:00 local EDT → 13:00 UTC  → '2026-06-22 13:00:00'
 *   11:30 local EDT → 15:30 UTC  → '2026-06-22 15:30:00'
 *   yesterday 07:30 EDT → 11:30 UTC → '2026-06-21 11:30:00'
 *
 * DETERMINISM: wall-clock access is suppressed by passing nowInfo to rowToTask
 * (5th arg). No Date.now(), no Math.random(), no I/O.
 *
 * SELF-MUTATION CONTRACT: RED tests are verified to FAIL on the current unpatched
 * production code before the fix. See telly RED evidence in TEST-CATALOG.md.
 *
 * Traceability: BUG row + FIX row in TRACEABILITY.md
 */

'use strict';

process.env.NODE_ENV = 'test';

// rowToTask is a pure mapper — no DB mock needed.
const { rowToTask } = require('../../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';

// ── Fixed now-contexts ───────────────────────────────────────────────────────
// nowInfo shape: { todayKey: 'YYYY-MM-DD', nowMins: number (0-1439) }

const NOW_21_00 = { todayKey: '2026-06-22', nowMins: 21 * 60 };       // 21:00 local = 1260
const NOW_07_00 = { todayKey: '2026-06-22', nowMins: 7 * 60 };        // 07:00 local = 420
// Round 2 — windowed daily window-close tests (AC4)
// Window: scheduled_at=08:00 EDT (12:00 UTC), timeFlex=180 → window closes 11:00 EDT (15:00 UTC)
const NOW_09_00 = { todayKey: '2026-06-22', nowMins: 9 * 60 };        // 09:00 local = 540 (slot passed, window open)
const NOW_11_30 = { todayKey: '2026-06-22', nowMins: 11 * 60 + 30 };  // 11:30 local = 690 (window closed)

// ── Row factories ────────────────────────────────────────────────────────────

function makeBaseRow(overrides) {
  return Object.assign({
    id: 'test-overdue-001',
    master_id: 'test-overdue-001',
    task_type: 'recurring_instance',
    text: 'Eat Breakfast',
    status: '',
    scheduled_at: null,
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
    recur: null,
    source_id: 'tmpl-breakfast-001',
    generated: 1,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    cal_locked: 0,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    prev_when: null,
    travel_before: null,
    travel_after: null,
    preferred_time_mins: null,
    unscheduled: null,
    overdue: null,      // stored flag — null means "no stored overdue"
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: 'time_window',
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: 1,
    completed_at: null,
    end_date: null,
    rolling_anchor: null,
    unplaced_reason: null,
    unplaced_detail: null,
    date: '2026-06-22',
    created_at: '2026-06-20 00:00:00',
    updated_at: '2026-06-20 00:00:00'
  }, overrides);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 1 — Windowed daily window-close semantics (AC4 — Round 2 RED tests)
//
// LOCKED design (SPEC.md AC2/AC4): overdue fires at WINDOW-CLOSE, NOT at the
// scheduled slot. A windowed daily (morning, timeFlex=180) scheduled at 08:00
// with window closing at 11:00:
//   - now=09:00 (slot passed, window still open) → overdue MUST be FALSE (can still roam)
//   - now=11:30 (window closed) → overdue MUST be TRUE
//
// CURRENT CODE BUG (taskMappers.js:368-370, :404-405):
//   _isDailyRecur check + scheduledMins < nowMins fires at 8:01am (slot-time heuristic).
//   This is OFF-DESIGN. The mapper does NOT read timeFlex so it can't compute window-close.
//
// CASE-1a: now=09:00, slot passed (8am), window open (closes 11am) → overdue MUST be FALSE
//   RED on current code: current heuristic returns TRUE (8:01am < 9am → fires early)
//
// CASE-1b: WEEKLY/flexible recurring past today → overdue===FALSE (preserved from Round 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('AC4 (RED) — windowed daily: overdue at WINDOW-CLOSE, not at scheduled slot', () => {

  test('CASE-1a (RED): windowed daily, scheduled 08:00, timeFlex=180 (window closes 11:00), now=09:00 (slot passed, window open) → overdue MUST be FALSE', () => {
    // BEFORE (Round-1 assertion): this test asserted overdue===true at now=21:00 (no timeFlex).
    // AFTER (Round-2 / AC4 window-close): the LOCKED design says a windowed daily is overdue
    // only at WINDOW-CLOSE. At now=9am the window (8am + 3h = 11am) is still open — the
    // instance is still roamable within today. overdue MUST be FALSE at 9am.
    //
    // Current code fires TRUE at 9am (scheduledMins=480 < nowMins=540) — that is the bug.
    // This test will be RED on the current (unpatched) mapper code.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',               // daily habit — period is the occurrence day
      scheduled_at: '2026-06-22 12:00:00',     // 08:00 EDT (UTC-4 → 12:00 UTC)
      time_flex: 180,                          // 3-hour window → closes 11:00 EDT (15:00 UTC)
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00);
    // EXPECTED (window-close semantics): overdue===false (window still open at 9am)
    // ACTUAL on current code: overdue===true (slot-time heuristic fires at 8:01am)
    expect(task.overdue).toBe(false);
  });

  test('CASE-1a-preferred (RED — AC2b spec oracle): windowed daily PLACED EARLY at 07:00 but preferred_time_mins=08:00 (480), timeFlex=180 (window closes 11:00), now=09:00 → overdue MUST be FALSE (window-close uses preferred_time_mins NOT slot)', () => {
    // SPEC AC2b: "window-close = preferred_time_mins + time_flex, INDEPENDENT of placed slot."
    // Task placed EARLIER than preferred (slot=07:00 EDT = 11:00 UTC, preferred=08:00 EDT = 480 min).
    // window-close = preferred (480) + flex (180) = 660 (11:00 AM EDT).
    // now=09:00 (540) < 660 → window still open → overdue MUST be FALSE.
    //
    // CRITICAL: if the code uses scheduledMins+timeFlex instead of preferredTimeMins+timeFlex,
    // windowClose = 420 + 180 = 600 (10:00 AM). At now=540 (09:00) < 600 → still false by
    // coincidence. To make the test discriminating we use now=10:30 (630 min):
    //   Slot-based:     windowClose=420+180=600; now=630>=600 → overdue=TRUE  (wrong per spec)
    //   Preferred-based: windowClose=480+180=660; now=630<660  → overdue=FALSE (correct per spec)
    //
    // dateStrings trap: scheduled_at='2026-06-22 11:00:00' = 07:00 EDT (UTC-4 = 11:00 UTC).
    // preferred_time_mins=480 means 08:00 local (the preferred, different from the placed slot).
    const NOW_10_30 = { todayKey: '2026-06-22', nowMins: 10 * 60 + 30 }; // 10:30 local = 630
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 11:00:00',   // PLACED at 07:00 EDT (earlier than preferred)
      preferred_time_mins: 480,              // PREFERRED = 08:00 EDT → window-close = 11:00
      time_flex: 180,                        // 3-hour window from preferred (NOT from slot)
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_10_30);
    // SPEC oracle: preferred_time_mins (480) + time_flex (180) = window-close 660 (11:00 AM).
    // now=630 (10:30) < 660 → window still open → overdue MUST be FALSE.
    //
    // CURRENT CODE BUG: uses scheduledMins (420) + time_flex (180) = 600 (10:00 AM).
    // now=630 >= 600 → current code returns TRUE. This test is RED on current code.
    expect(task.overdue).toBe(false);
  });

  test('CASE-1b: WEEKLY/flexible recurring (roams the cycle, reschedulable) past today → overdue===FALSE', () => {
    // David: "Call Mom can be rescheduled". A weekly/timesPerCycle recurrence can
    // still be done in a later slot this cycle → NOT overdue until the cycle boundary.
    const row = makeBaseRow({
      placement_mode: 'time_blocks',
      recur: '{"type":"weekly","days":"MTWRFUS","fillPolicy":"any"}',
      scheduled_at: '2026-06-22 16:15:00',
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 2 — Preserve FIXED (no regression)
//
// FIXED placement mode, same-day past-time → overdue===true ALREADY (guard passes
// because placement_mode===FIXED → hasHardCommitment=true). This should continue to
// work after the fix.
// ═══════════════════════════════════════════════════════════════════════════════

describe('REGRESSION GUARD — FIXED placement_mode today past-time already works', () => {

  test('CASE-2: fixed, scheduled today 08:00, now 21:00 → overdue===true (must keep passing)', () => {
    const row = makeBaseRow({
      task_type: 'recurring_instance',
      placement_mode: 'fixed',
      scheduled_at: '2026-06-22 12:00:00',  // 08:00 EDT
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 3 — Preserve 999.671 floating (must NOT be overdue)
//
// A floating one-off (placement_mode='anytime', recurring=0, no deadline, no
// implied_deadline) at a past soft-preferred time today → overdue===false.
// The 999.671 contract: floating tasks are NEVER overdue from a past soft time.
// ═══════════════════════════════════════════════════════════════════════════════

describe('REGRESSION GUARD — 999.671 floating one-off never overdue (no deadline, no hard commitment)', () => {

  test('CASE-3: anytime, non-recurring, no deadline, scheduled today at past time → overdue===false', () => {
    const row = makeBaseRow({
      task_type: 'task',
      recurring: 0,
      source_id: null,
      placement_mode: 'anytime',
      scheduled_at: '2026-06-22 11:30:00',  // 07:30 EDT (past)
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    // Must remain false — 999.671 contract
    expect(task.overdue).toBe(false);
  });

  test('CASE-3b: time_window non-recurring, no deadline, scheduled today at past time → overdue===false', () => {
    // Even a time_window task that is NOT recurring should not be overdue without a commitment.
    // (The fix must scope to recurring_instance with a placed time, not all time_window tasks.)
    const row = makeBaseRow({
      task_type: 'task',
      recurring: 0,
      source_id: null,
      placement_mode: 'time_window',
      scheduled_at: '2026-06-22 11:30:00',
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    // This should stay false — no hard commitment, no recurrence → not overdue
    // NOTE: whether this should be true or false depends on the fix design.
    // Per R50 + 999.671: a non-recurring flexible task without a deadline is floating → false.
    // If the fix scopes to recurring_instance rows, this stays false. Record as REGRESSION guard.
    expect(task.overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 4 — Terminal status suppression
//
// Same recurring instance as case 1 but status='done'/'skip'/'missed' → overdue===false.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Terminal status suppression — overdue must be false for done/skip/missed', () => {

  ['done', 'skip', 'missed'].forEach(function(st) {
    test('CASE-4-' + st + ': time_window recurring, today past-time, status=' + st + ' → overdue===false', () => {
      const row = makeBaseRow({
        placement_mode: 'time_window',
        scheduled_at: '2026-06-22 11:30:00',
        deadline: null,
        implied_deadline: null,
        status: st,
        overdue: null
      });
      const task = rowToTask(row, TZ, null, null, NOW_21_00);
      expect(task.overdue).toBe(false);
    });
  });

  test('CASE-4-disabled: time_window recurring, today past-time, status=disabled → overdue===false', () => {
    // disabled is not TERMINAL but frozen — must also suppress overdue
    const row = makeBaseRow({
      placement_mode: 'time_window',
      scheduled_at: '2026-06-22 11:30:00',
      deadline: null,
      implied_deadline: null,
      status: 'disabled',
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 5 — Not-yet-past same day
//
// Recurring instance scheduled today 07:30 but nowInfo = today 07:00 (BEFORE the
// time) → overdue===false (not past yet).
// ═══════════════════════════════════════════════════════════════════════════════

describe('Not-yet-past same day — recurring today but not yet past → overdue===false', () => {

  test('CASE-5: time_window recurring, scheduled today 07:30, now 07:00 (before) → overdue===false', () => {
    // nowMins=420 (07:00) < scheduledMins=450 (07:30) → not overdue
    const row = makeBaseRow({
      placement_mode: 'time_window',
      scheduled_at: '2026-06-22 11:30:00',  // 07:30 EDT
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_07_00);
    expect(task.overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 6 — Past-day recurring (sanity; should already pass for FIXED)
//
// Recurring instance scheduled YESTERDAY, status='' → overdue===true.
// FIXED already catches this (dueKey < todayKey). Verify same holds after fix
// for time_window too.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Past-DAY recurring — yesterday instance → overdue===true', () => {

  test('CASE-6a: fixed, scheduled yesterday → overdue===true (already green)', () => {
    const row = makeBaseRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-06-21 11:30:00',  // yesterday 07:30 EDT
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(true);
  });

  test('CASE-6b-RED: time_window, scheduled yesterday → overdue===true', () => {
    // dueKey = '2026-06-21' < todayKey '2026-06-22' → should be true once past-day check lands.
    // On current code: hasHardCommitment=false → returns false (the bug).
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-21 11:30:00',  // yesterday 07:30 EDT
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 7 — Stored overdue flag short-circuits (regression guard)
//
// When row.overdue=1 (stored), the computed path must be skipped and return true
// regardless of placement_mode or time.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Stored overdue flag short-circuit — stored overdue=1 always wins', () => {

  test('CASE-7: row.overdue=1 stored, anytime non-recurring → overdue===true (short-circuit)', () => {
    const row = makeBaseRow({
      task_type: 'task',
      recurring: 0,
      source_id: null,
      placement_mode: 'anytime',
      scheduled_at: null,
      deadline: null,
      implied_deadline: null,
      status: '',
      overdue: 1  // stored flag set
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FUTURE-CARE NOTE: flexible-TPC recurring (multiple-per-week)
//
// Per R50 LOCKED design: a flexible-TPC recurring instance (e.g. 3x/week) is NOT
// overdue until its cycle boundary (the end of the recurrence period), NOT just
// because its scheduled time has passed within the week. bert + the design own
// the cycle-boundary semantics. The fix must NOT mark a within-cycle flexible-TPC
// instance as overdue just because its scheduled time is past.
//
// This guard is labeled FUTURE-CARE and scoped to the daily-habit case above.
// A dedicated flexible-TPC guard test should be added once the R50 cycle-boundary
// implementation is finalized.
// ═══════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// CASE 8 — AC4 Part 3 (Round 2 RED) — windowed daily PAST window-close → overdue=true
//
// Same daily instance as CASE-1a (scheduled 08:00, timeFlex=180, window closes 11:00)
// but now=11:30 (window closed). Overdue MUST be TRUE.
//
// This also happens to pass on current code (11:30 > 8:00 → slot-time heuristic fires).
// Kept as a GREEN post-fix regression guard to confirm window-close detection works.
// ═══════════════════════════════════════════════════════════════════════════════

describe('AC4 Part 3 — windowed daily past window-close at 11:30 → overdue=true', () => {

  test('CASE-8: windowed daily, scheduled 08:00, timeFlex=180 (window closes 11:00), now=11:30 (window closed) → overdue MUST be TRUE', () => {
    // Window close = 08:00 + 3h = 11:00. now=11:30 → window closed → overdue=true.
    // On current code this also passes (slot-time heuristic: 480 < 690 → true).
    // After the window-close fix this should still pass (window-close check: 11:30 > 11:00 → true).
    // This is a GREEN anchor for the fix: the two CASE-1a/CASE-8 pair bracket the
    // window — false before close, true after — and both must hold post-fix.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',    // 08:00 EDT
      time_flex: 180,                          // window closes 11:00 EDT (15:00 UTC)
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_11_30);
    expect(task.overdue).toBe(true);
  });

});


// ═══════════════════════════════════════════════════════════════════════════════
// CASE 9 — AC2 (SPEC daily half) — WINDOW-LESS daily → overdue only at midnight
//
// A window-less (anytime, no timeFlex) daily instance scheduled today at 08:00.
// Effective deadline = min(period-boundary, window-close) = min(midnight, midnight) = midnight.
// now=09:00 → NOT overdue (before midnight).
// now=21:00 → NOT overdue (still before midnight — the period ends at midnight).
//
// CURRENT CODE BUG: the slot-time heuristic fires at 8:01am for anytime daily too
// (if placement_mode matches and _isDailyRecur=true). This is off-design for anytime.
// This test (now=9am → false) will be RED on current code if the heuristic applies to
// anytime mode; it may pass if the mode check excludes anytime. Verify below.
//
// NOTE: The SPEC says "window-less → overdue at midnight". The midnight check is
// effectively "past day" (dueKey < todayKey) which fires once the day is over.
// So for today's anytime instance, now=9am → false, now=21:00 → also false (still today).
// Overdue fires tomorrow when dueKey ('2026-06-22') < todayKey ('2026-06-23').
// ═══════════════════════════════════════════════════════════════════════════════

describe('AC2 daily half — window-less (anytime) daily → overdue only at midnight (next-day)', () => {

  test('CASE-9a (RED if anytime heuristic fires): anytime daily, scheduled 08:00, no timeFlex, now=09:00 → overdue MUST be FALSE (window is midnight)', () => {
    // Effective deadline = midnight. At 9am the window is still open → not overdue.
    // Current code: _isDailyRecur=true, scheduledMins=480 < nowMins=540 → fires TRUE (if anytime
    // is captured by isPlacedRecurringInstance). This is the RED case if anytime is included.
    // If anytime is NOT included (current code gates on placement_mode !== FIXED), this may pass.
    // Either way the expected answer is FALSE. Document the actual result in TEST-CATALOG.
    const row = makeBaseRow({
      placement_mode: 'anytime',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',    // 08:00 EDT
      time_flex: null,                         // no timeFlex → window-less → overdue at midnight
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00);
    expect(task.overdue).toBe(false);
  });

  test('CASE-9b: anytime daily, scheduled 08:00 TODAY, now=21:00 → overdue still FALSE (window closes at midnight, still today)', () => {
    // TODAY is still the same key as scheduled. Midnight has not passed → not overdue yet.
    // The period boundary for a day-locked daily = next day. Until that day change, overdue=false.
    const row = makeBaseRow({
      placement_mode: 'anytime',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',    // 08:00 EDT, today
      time_flex: null,
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    // Window closes at midnight (end of today). now=21:00 is still today → not overdue.
    expect(task.overdue).toBe(false);
  });

  test('CASE-9c: anytime daily, scheduled YESTERDAY 08:00, now=09:00 today → overdue TRUE (period ended at midnight)', () => {
    // Yesterday's anytime instance: period ended at midnight between yesterday and today.
    // now is today → past the period boundary → overdue.
    const row = makeBaseRow({
      placement_mode: 'anytime',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-21 12:00:00',    // yesterday 08:00 EDT
      time_flex: null,
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00);
    // dueKey = '2026-06-21' < todayKey '2026-06-22' → past day → overdue
    expect(task.overdue).toBe(true);
  });

});


// ═══════════════════════════════════════════════════════════════════════════════
// CASE 10 — time_flex=0 edge case (bert Round-2 REFER→telly)
//
// time_flex=0 is the degenerate window: windowCloseMins = scheduledMins + 0.
// This means overdue fires IMMEDIATELY at the scheduled slot (window has zero width).
// At now === scheduledMins (exact slot minute): nowMins >= windowCloseMins (0 window)
// → overdue MUST be TRUE.
// At now < scheduledMins: overdue still FALSE (slot not yet reached).
//
// The current code path: `row.time_flex > 0` gates the windowed check.
// time_flex=0 does NOT enter the windowed path (0 is not > 0) — it falls through
// to the window-less daily path (no intra-day overdue before midnight).
// This means time_flex=0 behaves identically to time_flex=null (no window).
//
// CHARACTERIZATION: document the current behavior and confirm the boundary.
// The SPEC does not define time_flex=0 explicitly; this is an edge-case characterization
// that pins the current implementation for bert/cookie to review if the design requires
// time_flex=0 to mean "overdue exactly at slot" vs "no window" (same as null).
//
// REFER→cookie: time_flex=0 boundary is design-ambiguous. Current code treats it as
// window-less (falls through). If the design requires immediate-overdue at slot for
// time_flex=0, bert must change `row.time_flex > 0` to `row.time_flex >= 0`.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// CASE 10 — AC2c: time_flex BOUNDARY tests (SPEC oracle — two DISTINCT cases)
//
// SPEC AC2c (locked 2026-06-23):
//   time_flex == 0  → window-close = the slot minute itself (zero-width window:
//                     pin at slot, no roam). Overdue EXACTLY at the slot minute.
//   time_flex == null → window-close = midnight (anytime / no window). Overdue
//                     only at period boundary (next day).
//
// These are TWO DISTINCT behaviors. The tests below encode both precisely.
// ═══════════════════════════════════════════════════════════════════════════════

describe('CASE 10 — AC2c: time_flex=0 vs time_flex=null DISTINCT boundary (SPEC oracle)', () => {

  test('CASE-10a (RED — AC2c spec oracle): time_flex=0, scheduled 08:00, now=09:00 → overdue MUST be TRUE (zero-width window: overdue at slot minute)', () => {
    // SPEC AC2c: time_flex==0 → window-close = slot minute itself.
    // windowCloseMins = scheduledMins + 0 = 480. now=09:00 (540) >= 480 → overdue=TRUE.
    //
    // CURRENT CODE BUG: guard is `row.time_flex > 0` (not `>= 0`), so time_flex=0
    // does NOT enter the windowed branch. Falls through to window-less path → returns
    // FALSE (same as time_flex=null). This is off-spec.
    //
    // EXPECTED (spec oracle): TRUE.  RED on current code.
    // Fix required: change `row.time_flex > 0` to `row.time_flex != null && row.time_flex >= 0`
    // (or equivalent) in taskMappers.js so time_flex=0 enters the windowed path.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',  // 08:00 EDT
      time_flex: 0,                          // zero-width window → overdue at slot minute
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00); // now=09:00, slot=08:00
    // SPEC: windowCloseMins=480+0=480; now=540 >= 480 → overdue=TRUE
    expect(task.overdue).toBe(true);
  });

  test('CASE-10a-before: time_flex=0, scheduled 08:00, now=07:00 → overdue MUST be FALSE (slot not yet reached)', () => {
    // now=07:00 (420) < windowCloseMins=480 → slot not yet reached → overdue=FALSE.
    // This must hold both on current code and post-fix.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',  // 08:00 EDT
      time_flex: 0,
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_07_00); // now=07:00
    expect(task.overdue).toBe(false);
  });

  test('CASE-10null: time_flex=null (window-less), scheduled 08:00 TODAY, now=09:00 → overdue MUST be FALSE (window=midnight, not yet midnight)', () => {
    // SPEC AC2c: time_flex==null → window-close = midnight (anytime daily).
    // now=09:00, still today → NOT overdue until midnight (next-day check).
    // DISTINCT from time_flex=0: null means "no window" → no intra-day overdue.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-22 12:00:00',  // 08:00 EDT, today
      time_flex: null,                       // no window → midnight deadline
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00);
    // window-less → no intra-day overdue → false at 9am
    expect(task.overdue).toBe(false);
  });

  test('CASE-10b: time_flex=0, scheduled YESTERDAY 08:00, now=09:00 today → overdue TRUE (past-day boundary fires regardless)', () => {
    // time_flex=0 on a past-day instance: dueKey < todayKey → overdue fires at the
    // past-day gate regardless of the windowed path. This confirms the two paths are
    // independent: windowed intra-day (today only) vs past-day (any timeFlex value).
    const row = makeBaseRow({
      placement_mode: 'time_window',
      recur: '{"type":"daily"}',
      scheduled_at: '2026-06-21 12:00:00',  // yesterday 08:00 EDT
      time_flex: 0,                          // zero-minute window
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_09_00); // today=2026-06-22, now=09:00
    // dueKey='2026-06-21' < todayKey='2026-06-22' → past-day gate fires → overdue===true
    expect(task.overdue).toBe(true);
  });

});


// ═══════════════════════════════════════════════════════════════════════════════
// CASE 10 — AC4 preservation of existing GREEN tests post-window-close fix
//
// After the window-close fix (bert's task), these tests from other CASEs must
// remain GREEN. They document the boundary behavior the fix must not break:
//   - FIXED placement → overdue at scheduled time (CASE-2)
//   - 999.671 floating → never overdue (CASE-3)
//   - Terminal status suppression (CASE-4)
//   - Not-yet-past same day (CASE-5)
//   - Stored overdue flag short-circuit (CASE-7)
// All of those are defined above and should remain GREEN. This block is a
// commentary anchor for the catalog — no new test code.
//
// SUMMARY of RED/GREEN status on CURRENT (unpatched) code for Round 2:
//   CASE-1a (windowed daily now=9am → false): RED   ← new Round 2 RED
//   CASE-1b (weekly past → false):            GREEN (preserved)
//   CASE-8  (windowed daily now=11:30 → true): GREEN (passes on current code, anchor)
//   CASE-9a (anytime daily now=9am → false):   VERIFY BELOW
//   CASE-9b (anytime daily now=21:00 → false): VERIFY BELOW
//   CASE-9c (anytime daily yesterday → true):  GREEN (past-day check)
// ═══════════════════════════════════════════════════════════════════════════════
