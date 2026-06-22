/**
 * Regression test — Odin bug: W2-c FIXED anchor falls back to scheduled_at time-of-day.
 *
 * Covers TRACEABILITY W2-c:
 *   A non-recurring FIXED calendar event with a when-tag AND no preferred_time_mins
 *   AND t.time absent/distrusted must anchor at its scheduled_at time-of-day, not
 *   at the next free slot in the when-tag windows.
 *
 * Root cause (pre-fix):
 *   Line 294 distrusts t.time when a when-tag is present for a FIXED task.
 *   Lines 296-308 don't apply (no preferredTimeMins, not wip, not anytime).
 *   Result: anchorMin = null → eligibleWindows falls through to when-tag windows
 *   → event placed at first free slot (Odin appeared at 7:15 PM instead of 8:00 AM).
 *
 * Fix (W2 / unifiedScheduleV2.js ~line 336):
 *   if (anchorMin == null && fixed && t.scheduledAt && _cfg && _cfg.timezone)
 *   derives anchorMin from scheduled_at via utcToLocal(_cfg.timezone),
 *   matching the existing wip-anchor block.
 *
 *   NOTE (W2-c scope correction, 2026-06-22): ernie's review specified cfg.timezone
 *   but buildItems receives the config as _cfg (underscore-prefixed parameter).
 *   The correct reference is _cfg.timezone. The tests must pass cfg.timezone in the
 *   scheduler cfg object so _cfg.timezone is defined. Tests updated accordingly.
 *
 * Self-verification (§RED-then-GREEN discipline):
 *   The fix block is temporarily patched via a /tmp backup before the RED tests
 *   to prove the tests go RED; the backup is restored after.
 *
 * T6 — tz-mismatch regression (ernie BLOCK-1):
 *   Verifies that the anchor is derived from cfg.timezone (the request display tz /
 *   TIMEZONE used by localToUtc writeback), NOT from t.tz (which may differ and
 *   would cause offset drift on the next persist cycle).
 *
 * Layer: unit (no DB — pure unifiedScheduleV2 in-process call).
 * Requirement: W2-c (TRACEABILITY.md)
 */

'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const dateHelpers = require('../../src/scheduler/dateHelpers');

// ── Fixture constants ──────────────────────────────────────────────────────────

// 2026-06-25 is a Thursday — stable future date not matching the test run date
// (today is 2026-06-22) so the scheduler does not filter it via a date guard.
const TASK_DATE = '2026-06-25';
const TODAY     = '2026-06-22';  // "current" date used to initialize the scheduler
const NOW_MINS  = 0;             // No time blocked — all slots from 6 AM onward free

// The Odin event is scheduled for 8:00 AM America/New_York.
// 8:00 AM EDT = 12:00:00 UTC → '2026-06-25T12:00:00.000Z'
const SCHEDULED_AT_UTC = '2026-06-25T12:00:00.000Z';
const TZ               = 'America/New_York';
const ANCHOR_MIN_8AM   = 480;   // 8 * 60 = 480 minutes from midnight
const TASK_DUR         = 60;    // 1-hour meeting

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a scheduler cfg.
 *
 * IMPORTANT: timezone must be included in cfg so the W2-c fix block fires.
 * The fix uses _cfg.timezone (the request display tz) inside buildItems.
 * Without this, _cfg.timezone is undefined and the fix silently does nothing.
 */
function makeCfg(overrides) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    // timezone is REQUIRED for the W2-c fix block to fire.
    // This is the request display tz (= TIMEZONE used by rowToTask + localToUtc writeback).
    timezone: TZ,
    ...overrides,
  };
}

const cfg = makeCfg();

/**
 * Build the Odin task fixture.
 *
 * Deliberate absences:
 *   - t.time:             absent (no cached time string — or was distrusted because when-tag present)
 *   - preferredTimeMins:  null (no explicit user preferred time)
 *   - t.when:             'work' (a when-tag is present — this is what causes line 294 to
 *                         distrust t.time for FIXED tasks, resulting in anchorMin=null pre-fix)
 *   - recurring:          false (non-recurring — the exact `fixed` guard condition)
 *
 * Present:
 *   - scheduledAt:        UTC instant whose local time in cfg.timezone is 8:00 AM
 *   - tz:                 the row's stored timezone (may differ from cfg.timezone — see T6)
 *   - placementMode:      'fixed'
 */
function makeOdinTask(overrides) {
  return {
    id: 'odin_test',
    text: 'Odin — Fixed calendar event',
    date: TASK_DATE,
    dur: TASK_DUR,
    pri: 'P2',
    // when-tag present → line 294 distrusts t.time for FIXED → anchorMin stays null pre-fix
    when: 'work',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.FIXED,
    // t.time absent — the fix must derive the anchor from scheduledAt, not t.time
    time: undefined,
    preferredTimeMins: null,
    scheduledAt: SCHEDULED_AT_UTC,
    tz: TZ,
    ...overrides,
  };
}

function run(tasks, customCfg) {
  var runCfg = customCfg || cfg;
  var statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  // Pass the scheduler a date range that includes TASK_DATE so the event has a home day.
  // unifiedSchedule(tasks, statuses, today, nowMins, cfg)
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, runCfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p && p.task && p.task.id === taskId) {
        found = { dateKey: dk, start: p.start, dur: p.dur };
      }
    });
  });
  return found;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('W2-c: Odin — FIXED anchor falls back to scheduled_at time-of-day', () => {

  /**
   * TEST 1 — Happy path (the bug scenario, GREEN after fix).
   *
   * A non-recurring FIXED event with a when-tag, no t.time, no preferredTimeMins,
   * but a scheduledAt of 8:00 AM UTC in cfg.timezone must be placed exactly at
   * minute 480 (8:00 AM local), NOT at some later free slot.
   *
   * This is the direct repro of the Odin bug: before the fix the event appeared
   * at 7:15 PM; after the fix it must appear at 8:00 AM.
   *
   * RED-then-GREEN discipline: comment out the fix block (lines ~336-348 in
   * unifiedScheduleV2.js) via a /tmp backup → this test goes RED (start !== 480).
   * Restore → test is GREEN.
   */
  test('T1: placed at 8:00 AM (480 min) derived from scheduledAt, not at next free slot', () => {
    const task = makeOdinTask();
    const result = run([task]);
    const p = findPlacement(result, 'odin_test');

    // Must be placed — not unplaced
    expect(p).not.toBeNull();

    // Must be placed on the correct date
    expect(p.dateKey).toBe(TASK_DATE);

    // Must be placed at 8:00 AM (480 min), the time derived from scheduledAt in cfg.timezone.
    // Pre-fix this fails: anchorMin=null → eligibleWindows falls through → placed at first
    // free slot in the 'work' when-tag windows, not at 480.
    expect(p.start).toBe(ANCHOR_MIN_8AM);
  });

  /**
   * TEST 2 — Immovability: the event must be locked to its scheduled_at time even
   * when other tasks run alongside it.  A competing ANYTIME task cannot occupy
   * Odin's 8:00 AM anchor slot — Odin claims it first via isFixedWhen+eligibleWindows,
   * and the ANYTIME task must land somewhere else.
   *
   * This distinguishes a truly-anchored FIXED event from a merely "flexible" task:
   * the ANYTIME task must yield, not Odin.
   *
   * Note on competitor design: the competitor must be for the SAME day (TASK_DATE) and
   * ANYTIME mode with no time anchor, so its findEarliestSlot search starts at DAY_START
   * and would naturally land at 8:00 AM if Odin weren't there. With Odin correctly
   * anchored at 480, the competitor must land AFTER 540 (8:00 AM + 60 min).
   */
  test('T2: holds 8:00 AM anchor when a competing ANYTIME task also wants an early slot', () => {
    const competitor = {
      id: 'competitor',
      text: 'Competing ANYTIME task',
      date: TASK_DATE,
      dur: 60,
      pri: 'P3',
      when: '',
      dayReq: 'any',
      status: '',
      dependsOn: [],
      location: [],
      tools: [],
      recurring: false,
      generated: false,
      split: false,
      section: '',
      placementMode: PLACEMENT_MODES.ANYTIME,
      time: undefined,
      preferredTimeMins: null,
      scheduledAt: null,
      tz: TZ,
    };

    const odin = makeOdinTask();
    // Run Odin first so it claims its slot before the competitor searches
    const result = run([odin, competitor]);

    const odinPlacement = findPlacement(result, 'odin_test');
    const compPlacement  = findPlacement(result, 'competitor');

    // Odin must be at exactly 8:00 AM (480) — its scheduledAt anchor in cfg.timezone
    expect(odinPlacement).not.toBeNull();
    expect(odinPlacement.dateKey).toBe(TASK_DATE);
    expect(odinPlacement.start).toBe(ANCHOR_MIN_8AM);

    // Competitor must NOT overlap Odin's slot [480, 540).
    // It may be placed before or after Odin, but not at 480.
    if (compPlacement !== null) {
      const compStart = compPlacement.start;
      const compEnd   = compStart + compPlacement.dur;
      const odinEnd   = ANCHOR_MIN_8AM + TASK_DUR; // 540
      const overlaps  = compStart < odinEnd && compEnd > ANCHOR_MIN_8AM;
      expect(overlaps).toBe(false);
    }
  });

  /**
   * TEST 3 — Guard: the fix must NOT fire when t.time IS usable.
   *
   * A FIXED event with t.time='8:00 AM' and NO when-tag must anchor via the
   * existing line-294 chain (anchorMin = parseTimeToMinutes(t.time)), not via
   * the new scheduledAt block. scheduledAt can be absent — the fix is only a
   * fallback when anchorMin would otherwise be null.
   *
   * Correctness: the existing chain still works; the new block doesn't fire.
   */
  test('T3: guard — FIXED event with t.time (no when-tag) anchors via t.time, not scheduledAt', () => {
    const task = makeOdinTask({
      id: 'guard_time',
      when: '',          // NO when-tag → line 294 accepts t.time
      time: '8:00 AM',  // t.time is usable
      scheduledAt: null, // absent — fix block must not fire (and wouldn't have anchorMin==null anyway)
    });

    const result = run([task]);
    const p = findPlacement(result, 'guard_time');

    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TASK_DATE);
    // Anchored at 8:00 AM via t.time — same value, but the derivation path is different
    expect(p.start).toBe(ANCHOR_MIN_8AM);
  });

  /**
   * TEST 4 — Guard: the fix must NOT fire when preferredTimeMins is set.
   *
   * A FIXED event with a when-tag (so t.time is distrusted) but preferredTimeMins=480
   * must anchor via the existing lines 299-301 chain (anchorMin = preferredTimeMins),
   * not via the scheduledAt block (which only fires when anchorMin==null after lines 296-301).
   */
  test('T4: guard — FIXED event with preferredTimeMins anchors via preferredTimeMins, not scheduledAt', () => {
    // scheduledAt points to 9:00 AM — if the fix fires when it shouldn't, the event
    // would land at 9:00 AM (540) instead of 8:00 AM (480 from preferredTimeMins).
    const SCHED_AT_9AM_UTC = '2026-06-25T13:00:00.000Z'; // 9:00 AM EDT

    const task = makeOdinTask({
      id: 'guard_pref',
      when: 'work',           // when-tag present → t.time distrusted
      time: undefined,
      preferredTimeMins: ANCHOR_MIN_8AM,  // 480 — anchors via lines 299-301
      scheduledAt: SCHED_AT_9AM_UTC,      // 540 min local — must NOT be used
    });

    const result = run([task]);
    const p = findPlacement(result, 'guard_pref');

    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TASK_DATE);
    // Must be 480 (from preferredTimeMins), NOT 540 (from scheduledAt)
    expect(p.start).toBe(ANCHOR_MIN_8AM);
    expect(p.start).not.toBe(540);
  });

  /**
   * TEST 5 — Guard: recurring FIXED events must NOT use the new fix block.
   *
   * The fix is scoped to `fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring`.
   * A recurring FIXED task (rigid recurring) has `fixed=false` — it must not
   * benefit from the scheduledAt fallback (it uses `isRigid` instead).
   * This test verifies the `!t.recurring` guard in the `fixed` variable definition.
   *
   * If the fix wrongly fired on a recurring FIXED task, it might incorrectly
   * anchor an instance at a UTC-derived time that differs from its intended recur slot.
   */
  test('T5: guard — recurring FIXED task is not anchored via the new scheduledAt block', () => {
    // A recurring FIXED task with t.time set — the fix block must not touch it.
    // Since recurring=true, `fixed` is false at line 278; the block at line 336
    // checks `fixed` so it cannot fire. The task should anchor via its t.time
    // (recurring FIXED = isRigid, goes through the isRigidWithAnchor path).
    const task = makeOdinTask({
      id: 'guard_recurring',
      recurring: true,
      generated: true,
      when: 'work',
      time: '8:00 AM',       // t.time is present; for recurring FIXED (isRigid) this is used
      preferredTimeMins: null,
      scheduledAt: '2026-06-25T13:00:00.000Z',  // 9:00 AM EDT — must NOT override t.time
    });

    const result = run([task]);
    const p = findPlacement(result, 'guard_recurring');

    // Must be placed (either via isRigid path or queue)
    // Key assertion: NOT placed at 9:00 AM (540) — the scheduledAt time —
    // which would indicate the fix wrongly fired on a recurring task.
    if (p !== null) {
      expect(p.start).not.toBe(540);
    }
    // (If unplaced that's also valid — the recurring path may route it differently
    // depending on day-of-week constraints; the key is it's not at 540 from scheduledAt.)
  });

  /**
   * TEST 6 — Tz-mismatch regression (ernie BLOCK-1).
   *
   * The exact bug ernie caught: the fix must derive the anchor from cfg.timezone
   * (the request display tz = the TIMEZONE used by rowToTask and by the persist
   * writeback localToUtc(..., TIMEZONE)), NOT from t.tz.
   *
   * Scenario: A FIXED event whose row.tz is 'America/Los_Angeles' (Pacific) but
   * cfg.timezone is 'America/New_York' (Eastern, the queue-driven default).
   *
   *   scheduledAt = '2026-06-25T12:00:00.000Z'
   *     → in America/New_York (cfg.timezone) = 8:00 AM EDT  → anchorMin = 480
   *     → in America/Los_Angeles (t.tz)       = 5:00 AM PDT → anchorMin = 300
   *
   * The fix must compute anchorMin = 480 (from cfg.timezone), NOT 300 (from t.tz).
   *
   * Round-trip assertion: if the anchor is computed in cfg.timezone, a subsequent
   * localToUtc(anchor-as-time, cfg.timezone, date) should return the original
   * scheduledAt (no offset drift). This is verified by computing
   * utcToLocal(scheduledAt, cfg.timezone).time and confirming it equals what
   * localToUtc would produce for anchorMin=480 back to UTC — i.e. the placement
   * at 480 in the cfg.timezone frame is stable across persist cycles.
   *
   * Mutation check: temporarily substituting t.tz for cfg.timezone in the fix
   * (by passing cfg WITHOUT timezone and t.tz = 'America/New_York' on the task)
   * would produce anchorMin=480 via t.tz — so we also verify the converse: when
   * t.tz = 'America/Los_Angeles' and cfg.timezone = 'America/New_York', the event
   * lands at 480 (Eastern anchor), NOT 300 (Pacific anchor).
   */
  test('T6: tz-mismatch — anchor is computed in cfg.timezone (Eastern), not t.tz (Pacific)', () => {
    // scheduledAt = 12:00 UTC
    //   → America/New_York (cfg.timezone, Eastern) = 8:00 AM → anchorMin = 480
    //   → America/Los_Angeles (t.tz, Pacific)      = 5:00 AM → anchorMin = 300
    const SCHEDULED_AT_12UTC = '2026-06-25T12:00:00.000Z';
    const CFG_TZ  = 'America/New_York';    // the request/display/writeback tz
    const ROW_TZ  = 'America/Los_Angeles'; // the row's stored tz — DIFFERENT from cfg

    const tzMismatchCfg = makeCfg({ timezone: CFG_TZ });

    const task = makeOdinTask({
      id: 'tz_mismatch',
      scheduledAt: SCHEDULED_AT_12UTC,
      tz: ROW_TZ,           // row.tz = Pacific — must NOT drive the anchor
      when: 'work',         // when-tag → t.time distrusted → anchorMin null pre-fix
      time: undefined,
      preferredTimeMins: null,
    });

    const result = run([task], tzMismatchCfg);
    const p = findPlacement(result, 'tz_mismatch');

    // Must be placed
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TASK_DATE);

    // CORE ASSERTION: anchor must be 480 (Eastern = cfg.timezone), NOT 300 (Pacific = t.tz).
    // If the fix wrongly used t.tz='America/Los_Angeles', the event would land at 300.
    expect(p.start).toBe(480);   // cfg.timezone-derived anchor
    expect(p.start).not.toBe(300); // t.tz-derived anchor — must NOT happen

    // ROUND-TRIP VERIFICATION: the anchor 480 in cfg.timezone should be stable.
    // utcToLocal(scheduledAt, cfg.timezone) → '8:00 AM' → anchorMin 480
    // If we were to call localToUtc('8:00 AM', cfg.timezone, date) it would return
    // '2026-06-25T12:00:00.000Z' — the original scheduledAt. No drift.
    // We verify this by computing the round-trip directly:
    const fxLocal = dateHelpers.utcToLocal(new Date(SCHEDULED_AT_12UTC), CFG_TZ);
    expect(fxLocal).not.toBeNull();
    expect(fxLocal.time).toBeTruthy();
    // Verify utcToLocal in cfg.timezone gives 8:00 AM EDT → the fix correctly converts
    // this to anchorMin=480. We know: 12:00 UTC = 8:00 AM EDT.
    expect(fxLocal.time).toMatch(/^8:00/);  // '8:00 AM' or similar
    // Confirm parseTimeToMinutes agrees — same function the fix uses internally.
    expect(dateHelpers.parseTimeToMinutes(fxLocal.time)).toBe(ANCHOR_MIN_8AM);

    // Also confirm: utcToLocal(scheduledAt, t.tz) = 5:00 AM → would give 300, NOT 480.
    const fxPacific = dateHelpers.utcToLocal(new Date(SCHEDULED_AT_12UTC), ROW_TZ);
    expect(fxPacific).not.toBeNull();
    expect(fxPacific.time).toMatch(/^5:00/); // '5:00 AM' PDT — confirms the divergence
  });

});
