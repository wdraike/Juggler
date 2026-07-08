/**
 * BUG-5 (this leg, jug-overdue-flag-fork) — creation-time deadline
 * plausibility regression.
 *
 * validateTaskInput() currently only checks `body.deadline` is a
 * FORMAT-PARSEABLE date (taskValidation.js:156-159, `isNaN(new
 * Date(body.deadline).getTime())`). It never checks the deadline is not
 * already in the past, so CreateTask.execute (and BatchCreateTasks / MCP
 * create_task, create_tasks — all of which set `_requireText: true` per
 * CreateTask.js:101) will silently mint a task that is overdue from the
 * moment it is created (computeOverdueForRow immediately marks any task
 * with a non-null deadline overdue-eligible — taskMappers.js:270), with zero
 * user-visible signal anything unusual happened.
 *
 * Fixed reference date: this test uses '2020-01-01' as the past deadline —
 * a date unambiguously "before today" in EVERY IANA timezone, so the test
 * does not depend on / does not need to mock "now" and cannot flake near a
 * midnight tz boundary (taskValidation.js is a pure module today — no
 * injected clock; see this leg's INTAKE-BRIEF.json TZ-PURITY risk_flag for
 * why bert must not add a raw `new Date()` "now" comparison here).
 *
 * `validateTaskInput` is PURE (zero infra requires — module header, lines
 * 1-23) so this is a direct unit test, no DB / no mocking required.
 *
 * AC reference: acceptance_criteria AC4 in INTAKE-BRIEF.json.
 */

'use strict';

const { validateTaskInput } = require('../../../../src/slices/task/domain/validation/taskValidation');
const { getNowInTimezone } = require('../../../../../shared/scheduler/getNowInTimezone');

var PAST_DEADLINE = '2020-01-01'; // unambiguously before "today" in any tz
var FAR_FUTURE_DEADLINE = '2099-01-01';

describe('validateTaskInput — creation-time past-deadline plausibility (BUG-5 / AC4)', () => {
  test('RED: create-path (_requireText:true, mirrors CreateTask.js:101) with a deadline already in the past is rejected', () => {
    var body = { _requireText: true, text: 'Task minted already overdue', deadline: PAST_DEADLINE };
    var errors = validateTaskInput(body);
    // Today (pre-fix) this is [] — the only deadline check is format-parseability.
    // Post-fix this MUST contain a plausibility-rejection error.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('; ')).toMatch(/deadline/i);
    expect(errors.join('; ')).toMatch(/past|today|future/i);
  });

  test('a deadline set to today or in the future on create is NOT rejected (no false-positive on the fix)', () => {
    var body = { _requireText: true, text: 'Future task', deadline: FAR_FUTURE_DEADLINE };
    var errors = validateTaskInput(body);
    expect(errors).toEqual([]);
  });

  test('EDGE CASE (edge_cases[0], INTAKE-BRIEF.json): a create-path body with NO deadline at all (placement_mode=fixed + past scheduled_at is the R50.1/R50.2 allowed past-due-pinned case) is unaffected — the new check must be scoped to the literal body.deadline field only', () => {
    var body = { _requireText: true, text: 'Fixed past-scheduled task, no deadline', placementMode: 'fixed', date: '2020-01-01', time: '09:00' };
    var errors = validateTaskInput(body);
    expect(errors).toEqual([]);
  });

  test('EDGE CASE (edge_cases[4], INTAKE-BRIEF.json): update-path (NO _requireText — mirrors UpdateTask.js/BatchUpdateTasks.js/MCP update_task) resending an unchanged already-past deadline must NOT be rejected — the new rule is create-only', () => {
    var body = { text: 'Editing an already-overdue task', deadline: PAST_DEADLINE };
    var errors = validateTaskInput(body);
    expect(errors).toEqual([]);
  });

  test('EDGE CASE: recurring template creation (create-path, no literal body.deadline — implied_deadline is computed downstream by the scheduler, not passed by the caller) is unaffected', () => {
    var body = {
      _requireText: true,
      text: 'Recurring template',
      recur: { type: 'weekly', days: 'MTWRF' },
    };
    var errors = validateTaskInput(body);
    expect(errors).toEqual([]);
  });

  // ── ernie-tz-1-test-gap / zoe-tz-testgap-1 closure ──────────────────────────
  //
  // The 5 tests above all use PAST_DEADLINE/FAR_FUTURE_DEADLINE literals years
  // from "today" — they exercise the reject/accept OUTCOME but never the tz
  // MECHANISM that decides "today". ernie-tz-1 found (and bert fixed) a bug
  // where the create-time check compared a UTC-parsed date-only `dlDate`
  // against a server-LOCAL midnight `new Date()`, false-rejecting legitimate
  // SAME-DAY deadlines for west-of-UTC servers/users. zoe empirically proved
  // (zoe-tz-testgap-1) that reintroducing that exact bug under
  // TZ=America/New_York left the 5 tests above green — the fix shipped
  // unguarded. These two cases pin the boundary the old literals dodge.
  describe('TZ boundary — same-day deadline acceptance (ernie-tz-1-test-gap / zoe-tz-testgap-1)', () => {
    var originalTz;

    beforeEach(() => {
      originalTz = process.env.TZ;
    });

    afterEach(() => {
      process.env.TZ = originalTz;
      jest.useRealTimers();
    });

    test('a deadline of "today" (per body.timezone/DEFAULT_TIMEZONE) is ACCEPTED when the process runs a west-of-UTC timezone — the naive UTC-vs-local-midnight comparison rejects this every time (not just in the evening), since a date-only string always parses as UTC midnight, hours before any west-of-UTC local midnight of the SAME calendar date', () => {
      process.env.TZ = 'America/New_York'; // west-of-UTC process/server timezone
      // Resolve "today" the SAME tz-aware way taskValidation.js's fix does
      // (getNowInTimezone(...).todayKey), so this test is not hostage to a
      // fixed calendar-date literal going stale.
      var todayKeyNY = getNowInTimezone('America/New_York').todayKey;
      var body = { _requireText: true, text: 'Same-day task (NY process tz)', deadline: todayKeyNY };
      var errors = validateTaskInput(body);
      expect(errors).toEqual([]);
    });

    test('the exact documented Cloud Run scenario (taskValidation.js comment: "fires every evening on Cloud Run, TZ=UTC"): server process runs UTC, caller supplies body.timezone="America/New_York", deadline is "today" in America/New_York at a fixed clock instant in the evening ET hours where UTC has ALREADY rolled to the next calendar day — ACCEPTED', () => {
      process.env.TZ = 'UTC'; // Cloud Run default server timezone
      // Fixed instant: 2026-07-08T21:00:00-04:00 (9pm EDT, July 8) ==
      // 2026-07-09T01:00:00Z — UTC's calendar day is already July 9 while
      // America/New_York's calendar day is still July 8.
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-07-09T01:00:00Z'));

      var body = {
        _requireText: true,
        text: 'Same-day task (Cloud Run evening scenario)',
        deadline: '2026-07-08', // "today" per America/New_York at this instant
        timezone: 'America/New_York',
      };
      var errors = validateTaskInput(body);
      // FIX proof: getNowInTimezone('America/New_York', <real clock @ fixed
      // instant>).todayKey === '2026-07-08' === dlKey → accepted.
      // Pre-fix, `new Date(); todayStart.setHours(0,0,0,0)` under process
      // TZ=UTC resolves to 2026-07-09T00:00:00Z (server's UTC "today"), and
      // `new Date('2026-07-08')` parses to 2026-07-08T00:00:00Z, which IS
      // < that server-local midnight — the old code would reject this.
      expect(errors).toEqual([]);
    });
  });
});
