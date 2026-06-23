/**
 * Covers: R50 (past-due pinning — locked design), 999.671 (floating task must NOT be overdue)
 * User Stories: David's daily habits (Eat Breakfast, Eat Lunch, etc.) scheduled today at past times
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * Leg: juggler-overdue-pastdue-recurring
 *
 * BUG: rowToTask computed-overdue block:
 *   (1) hasHardCommitment = deadline || implied_deadline || FIXED — is FALSE for
 *       recurring time_window/time_blocks/anytime rows with implied_deadline=NULL
 *       → early-returns false; never reaches same-day time check.
 *   (2) scheduledMins same-day check only fires for placement_mode==='fixed'.
 *   Result: a recurring_instance with placement_mode='time_window', status='',
 *   scheduled TODAY at 07:30 local but now=21:00 local → overdue===FALSE (the bug).
 *
 * TODAY = 2026-06-22 (America/New_York, UTC-4 in June)
 * All scheduled_at values are UTC "YYYY-MM-DD HH:MM:SS" (dateStrings form as knex returns).
 *   07:30 local EDT → 11:30 UTC  → '2026-06-22 11:30:00'
 *   08:00 local EDT → 12:00 UTC  → '2026-06-22 12:00:00'
 *   07:00 local EDT → 11:00 UTC  → '2026-06-22 11:00:00'
 *   yesterday 07:30 EDT → 11:30 UTC → '2026-06-21 11:30:00'
 *
 * DETERMINISM: wall-clock access is suppressed by passing nowInfo to rowToTask
 * (5th arg). No Date.now(), no Math.random(), no I/O.
 *
 * SELF-MUTATION CONTRACT: the RED test (case 1) is verified to FAIL on the current
 * unpatched production code before the fix. See telly RED evidence in TEST-CATALOG.md.
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
// CASE 1 — RED (the bug)
//
// Recurring instance with placement_mode='time_window', no deadline, no
// implied_deadline, scheduled TODAY at 07:30 local (11:30 UTC). Now = 21:00.
// EXPECT overdue===true.
// This FAILS on current code (hasHardCommitment=false → returns false).
// ═══════════════════════════════════════════════════════════════════════════════

describe('BUG (RED) — recurring_instance time_window past TODAY not flagged overdue', () => {

  test('CASE-1-RED: time_window recurring, scheduled today 07:30, now 21:00 → overdue===true', () => {
    // This is the primary RED test. It MUST fail before the fix is applied.
    // It fails because: hasHardCommitment is false (no deadline, no implied_deadline,
    // placement_mode!=='fixed') → early return false; same-day time check never reached.
    const row = makeBaseRow({
      placement_mode: 'time_window',
      scheduled_at: '2026-06-22 11:30:00',  // 07:30 EDT (UTC-4)
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    // EXPECTED (correct behavior): overdue===true (scheduled today at 07:30, now 21:00 → past)
    // ACTUAL on buggy code: overdue===false (hasHardCommitment gate fails)
    expect(task.overdue).toBe(true);
  });

  test('CASE-1b-RED: time_blocks recurring, scheduled today 07:30, now 21:00 → overdue===true', () => {
    // Same bug surface for time_blocks placement mode.
    const row = makeBaseRow({
      placement_mode: 'time_blocks',
      scheduled_at: '2026-06-22 11:30:00',
      deadline: null,
      implied_deadline: null,
      overdue: null
    });
    const task = rowToTask(row, TZ, null, null, NOW_21_00);
    expect(task.overdue).toBe(true);
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
