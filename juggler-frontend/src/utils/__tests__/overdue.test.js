/**
 * W1 (D3) — overdue display must come from the canonical task.overdue (R50.6),
 * NEVER the scheduler placement _overdue. Regression: Day view marked floating
 * tasks overdue (placement _overdue=true) while Issues did not (task.overdue=false).
 *
 * 999.5116: isTaskOverdue must ALSO derive past-due from the task's own
 * scheduled date when the DB overdue flag has been cleared by the scheduler.
 * A task with a hard commitment (deadline, placementMode=fixed, or overdue=1)
 * whose scheduled date is in the past IS overdue, regardless of the DB flag.
 */
import { isTaskOverdue } from '../overdue';

describe('isTaskOverdue — canonical task.overdue is the only source (D3)', () => {
  test('overdue task, not done → overdue', () => {
    expect(isTaskOverdue({ overdue: true }, false)).toBe(true);
  });

  test('overdue task but done → not overdue', () => {
    expect(isTaskOverdue({ overdue: true }, true)).toBe(false);
  });

  test('floating task (task.overdue=false) is NOT overdue even if a caller had a placement _overdue (999.671)', () => {
    // The helper takes the TASK, so a placement _overdue can not leak in.
    expect(isTaskOverdue({ overdue: false, _overdue: true }, false)).toBe(false);
  });

  test('missing/undefined task or overdue → not overdue', () => {
    expect(isTaskOverdue({}, false)).toBe(false);
    expect(isTaskOverdue(null, false)).toBe(false);
    expect(isTaskOverdue(undefined, false)).toBe(false);
  });
});

describe('999.5116: isTaskOverdue derives past-due from scheduled date', () => {
  // Use a fixed "now" so tests are deterministic. Aug 2026.
  // 999.15604: the instant is anchored with Z and the zone is passed explicitly.
  // A zone-less literal is parsed in the HOST zone, so once the predicate began
  // resolving "today" in a named timezone these cases passed on an Eastern box
  // and failed under CI's TZ=UTC (the FE suite, unlike the juggler backend one,
  // is not TZ-pinned by run-suite.sh).
  var TZ = 'America/New_York';
  var now = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT
  var todayKey = '2026-08-03';

  test('task with overdue=0 but scheduled in the past + hard commitment → overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      deadline: '2025-01-15',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('task with overdue=0, scheduled in past, placementMode=fixed → overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      placementMode: 'fixed',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('task with overdue=0, scheduled in past, no hard commitment → NOT overdue (floating)', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      // no deadline, no fixed placement → floating, not overdue per 999.671
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('task scheduled in the future → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: '2026-12-15',
      time: '14:00',
      deadline: '2026-12-15',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('task scheduled today but in the past, FIXED placement → overdue', () => {
    // 999.15604: the intra-day threshold survives only for a fixed-time
    // commitment — the slot time IS the due time (AC3). Unchanged from 999.5116
    // except that the commitment is now stated as `placementMode: fixed`; the
    // deadline-only variant of this case moved to the 999.15604 block below,
    // where David's ruling makes it NOT overdue until the day ends.
    var task = {
      overdue: 0,
      date: todayKey,
      time: '08:00', // 8am, now is noon
      placementMode: 'fixed',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('task scheduled today but in the future → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: todayKey,
      time: '18:00', // 6pm, now is noon
      deadline: todayKey,
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('done task with past scheduled date → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      deadline: '2025-01-15',
    };
    expect(isTaskOverdue(task, true, now, TZ)).toBe(false);
  });

  test('task with overdue=1 still shows overdue regardless of date', () => {
    var task = {
      overdue: 1,
      date: '2026-12-15',
      time: '14:00',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('task with no date/time but overdue=0 → NOT overdue', () => {
    var task = { overdue: 0 };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });
});

/**
 * 999.15604 — a DATE-ONLY deadline is an END-OF-DAY commitment.
 *
 * David, from dev: two tasks with a deadline of today displayed as overdue while
 * the day was still running. Two defects produced it, both in this helper:
 *
 *  (a) the intra-day threshold was applied to ANY hard commitment, so a task the
 *      scheduler happened to place at 08:00 read overdue from 08:01 even though
 *      its only commitment was "sometime today". The backend SSOT
 *      (taskMappers.computeOverdueForRow) computes an intra-day threshold ONLY
 *      for placement_mode=fixed and placed daily-recurring instances — a
 *      deadline-driven task is compared day-to-day. The display disagreed.
 *
 *  (b) todayKey came from nowDate.toISOString() (UTC) while nowMins came from
 *      getHours() (LOCAL). West of UTC the UTC date rolls first, so from 20:00
 *      EDT every today-dated task with a commitment compared against TOMORROW's
 *      key and read overdue — "before midnight", exactly as reported.
 */
describe('999.15604: date-only deadline is end-of-day, in the user timezone', () => {
  var TZ = 'America/New_York';

  test('AC1 — a date-only deadline of TODAY is not overdue at midday', () => {
    // 12:00 EDT. Placed at 08:00, i.e. the slot is already past.
    var now = new Date('2026-08-03T16:00:00Z');
    var task = { overdue: 0, date: '2026-08-03', time: '08:00', deadline: '2026-08-03' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('AC1 — still not overdue at 23:59 local, the last moment of the day', () => {
    // 23:59 EDT on Aug 3 = 03:59Z on Aug 4 — the UTC day has already rolled.
    var now = new Date('2026-08-04T03:59:00Z');
    var task = { overdue: 0, date: '2026-08-03', time: '08:00', deadline: '2026-08-03' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('AC2 — overdue at 00:00 local the next day', () => {
    // 00:00 EDT Aug 4 = 04:00Z.
    var now = new Date('2026-08-04T04:00:00Z');
    var task = { overdue: 0, date: '2026-08-03', time: '08:00', deadline: '2026-08-03' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('the un-injected path re-reads the clock — a tab open across midnight still flips', () => {
    // isTaskOverdue caches getNowInTimezone per (tz, minute) because it runs in
    // six components' render bodies and building an Intl.DateTimeFormat per task
    // per frame is ~13x the cost. If that key ever loses its minute bucket the
    // cache never expires: an SPA left open overnight keeps comparing against
    // yesterday's todayKey and NOTHING goes overdue again — this ticket's bug
    // inverted. Drives the real clock path (no `now` argument), so the cache is
    // actually exercised.
    // This project runs jest 27: `useFakeTimers({now, doNotFake})` is the jest-28
    // signature and is IGNORED here — the clock stays real and the test passes
    // against whatever today happens to be (the repo's own timezone.test.js uses
    // setSystemTime with no fake timers at all, which is the same no-op). The
    // 'modern' string form is what jest 27 honours. The assertion below proves
    // the clock is actually controlled before relying on it.
    jest.useFakeTimers('modern');
    try {
      jest.setSystemTime(new Date('2026-08-04T03:59:00Z')); // 23:59 EDT Aug 3
      expect(new Date(Date.now()).toISOString()).toBe('2026-08-04T03:59:00.000Z');

      var task = { overdue: 0, deadline: '2026-08-03', _displayTz: TZ };
      expect(isTaskOverdue(task, false, undefined)).toBe(false);

      jest.setSystemTime(new Date('2026-08-04T04:01:00Z')); // 00:01 EDT Aug 4
      expect(isTaskOverdue(task, false, undefined)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a frozen (disabled) instance never computes overdue', () => {
    // computeOverdueForRow short-circuits `disabled` before any commitment gate,
    // and disabled is deliberately not in TERMINAL_STATUSES, so isDone misses it.
    var now = new Date('2026-08-03T16:00:00Z');
    // overdue: 1 on purpose — the freeze must out-rank the stored flag, which is
    // the whole point of checking `disabled` BEFORE trusting it. With overdue: 0
    // this fixture passes under either ordering and pins nothing.
    var task = {
      overdue: 1, status: 'disabled', placementMode: 'all_day', date: '2026-08-01',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
  });

  test('a FIXED task whose time is unreadable still compares its DAY', () => {
    var now = new Date('2026-08-03T16:00:00Z');
    var past = { overdue: 0, placementMode: 'fixed', date: '2026-08-01', time: 'sometime' };
    var today = { overdue: 0, placementMode: 'fixed', date: '2026-08-03', time: 'sometime' };
    expect(isTaskOverdue(past, false, now, TZ)).toBe(true);
    expect(isTaskOverdue(today, false, now, TZ)).toBe(false);
  });

  test('a legacy isAllDay flag does NOT outrank a fixed placement (backend gates on placement_mode)', () => {
    var now = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT
    var task = {
      overdue: 0, isAllDay: true, placementMode: 'fixed',
      date: '2026-08-03', time: '08:00',
    };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('999.15816 — deadline with a time component uses that time for the overdue threshold', () => {
    // 999.15816: deadline is now a DATETIME column. A non-midnight time
    // component IS honoured by both the backend (computeOverdueForRow) and
    // this display predicate. This replaces the former "AC3 DEFERRED" test
    // which asserted the time was ignored — that deferral is now resolved.
    var now = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT
    var withTime = { overdue: 0, date: '2026-08-03', time: '08:00', deadline: '2026-08-03T09:00:00' };
    // 12:00 EDT >= 09:00 deadline → overdue
    expect(isTaskOverdue(withTime, false, now, TZ)).toBe(true);

    // Before the deadline time: NOT overdue
    var beforeTime = new Date('2026-08-03T12:00:00Z'); // 08:00 EDT
    expect(isTaskOverdue(withTime, false, beforeTime, TZ)).toBe(false);
  });

  test('an un-hydrated task (optimistic create) uses the CONFIGURED zone, not New York', () => {
    // createTask/attemptAddBatch build task objects locally, so they carry no
    // _displayTz until the next SSE upsert. Falling back to the NY default would
    // reproduce this very ticket for a Pacific user creating a task at 21:30.
    var now = new Date('2026-08-04T04:30:00Z'); // 21:30 PDT Aug 3 / 00:30 EDT Aug 4
    var task = { overdue: 0, deadline: '2026-08-03' };
    window.localStorage.setItem('juggler-user-tz', 'America/Los_Angeles');
    try {
      expect(isTaskOverdue(task, false, now)).toBe(false);
    } finally {
      window.localStorage.removeItem('juggler-user-tz');
    }
  });

  test('an all_day row with NO deadline is judged by its day — the day itself is the commitment', () => {
    // The backend makes a resolvable all-day date a hard-commitment source of
    // its own (_isAllDayWithResolvableDate). Gating on deadline-or-fixed made
    // this unreachable for the ordinary shape: an all-day event carries no
    // separate deadline, so nothing rendered overdue for it at all.
    var now = new Date('2026-08-03T16:00:00Z');
    var pastDay = { overdue: 0, placementMode: 'all_day', date: '2026-08-01' };
    var todayDay = { overdue: 0, placementMode: 'all_day', date: '2026-08-03' };
    expect(isTaskOverdue(pastDay, false, now, TZ)).toBe(true);
    expect(isTaskOverdue(todayDay, false, now, TZ)).toBe(false);
  });

  test('an all_day row is judged by its DAY, not by a later deadline', () => {
    var now = new Date('2026-08-03T16:00:00Z');
    var pastDay = {
      overdue: 0, placementMode: 'all_day', date: '2026-08-01', deadline: '2026-08-10',
    };
    expect(isTaskOverdue(pastDay, false, now, TZ)).toBe(true);
  });

  test('a MULTIDAY all_day row runs until its end date, not its start date', () => {
    // Priority is end_date > scheduled date > date (backend all_day formula).
    // Reading `date` first would badge a still-running multiday event overdue.
    var now = new Date('2026-08-03T16:00:00Z');
    var running = { overdue: 0, placementMode: 'all_day', date: '2026-08-01', endDate: '2026-08-05' };
    var finished = { overdue: 0, placementMode: 'all_day', date: '2026-08-01', endDate: '2026-08-02' };
    expect(isTaskOverdue(running, false, now, TZ)).toBe(false);
    expect(isTaskOverdue(finished, false, now, TZ)).toBe(true);
  });

  test('an all_day row with no resolvable day falls back to its deadline', () => {
    var now = new Date('2026-08-03T16:00:00Z');
    var tbd = { overdue: 0, placementMode: 'all_day', date: 'TBD', deadline: '2026-08-01' };
    expect(isTaskOverdue(tbd, false, now, TZ)).toBe(true);
  });

  test('AC4 — the midnight boundary follows the user timezone, not UTC', () => {
    // 22:00 EDT Aug 3 = 02:00Z Aug 4. Pre-fix this compared against the UTC key
    // '2026-08-04' and reported overdue two hours early.
    var now = new Date('2026-08-04T02:00:00Z');
    var task = { overdue: 0, date: '2026-08-03', time: '08:00', deadline: '2026-08-03' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(false);
    // Same instant for a user in Europe/London (03:00 BST, Aug 4) IS past their
    // midnight, so the same row is overdue for them.
    expect(isTaskOverdue(task, false, now, 'Europe/London')).toBe(true);
  });

  test('the timezone can ride on the task, as hydration stamps it', () => {
    // Deliberately NOT New York: the storage fallback resolves to New York on an
    // empty localStorage, so a NY stamp would agree with the fallback and this
    // test could not tell the two apart — it would stay green with the
    // _displayTz branch deleted outright.
    var now = new Date('2026-08-04T02:00:00Z'); // 22:00 EDT Aug 3 / 11:00 JST Aug 4
    var stamped = { overdue: 0, deadline: '2026-08-03', _displayTz: 'Asia/Tokyo' };
    var unstamped = { overdue: 0, deadline: '2026-08-03' };
    expect(isTaskOverdue(stamped, false, now)).toBe(true);    // Tokyo already rolled
    expect(isTaskOverdue(unstamped, false, now)).toBe(false); // NY has not
  });

  test('a deadline in the PAST is still overdue — the fix does not blunt the badge', () => {
    var now = new Date('2026-08-03T16:00:00Z');
    var task = { overdue: 0, date: '2026-08-03', time: '18:00', deadline: '2026-08-02' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('a FIXED task placed earlier today is overdue — intra-day rule kept where it belongs', () => {
    var now = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT
    var task = { overdue: 0, date: '2026-08-03', time: '08:00', placementMode: 'fixed' };
    expect(isTaskOverdue(task, false, now, TZ)).toBe(true);
  });

  test('12-hour hydrated times are read as written — a 6 PM slot is not "6 AM, long past"', () => {
    // hydrateTaskTimezones writes task.time via convertTimeForDisplay, which
    // emits "6:00 PM" — split(':') read that as 360 minutes, so every evening
    // task looked hours overdue by lunchtime.
    var now = new Date('2026-08-03T16:00:00Z'); // 12:00 EDT
    var evening = { overdue: 0, date: '2026-08-03', time: '6:00 PM', placementMode: 'fixed' };
    var morning = { overdue: 0, date: '2026-08-03', time: '8:00 AM', placementMode: 'fixed' };
    expect(isTaskOverdue(evening, false, now, TZ)).toBe(false);
    expect(isTaskOverdue(morning, false, now, TZ)).toBe(true);
    // Midnight is 12 AM, not 12 PM — the classic 12-hour off-by-twelve.
    var midnight = { overdue: 0, date: '2026-08-03', time: '12:00 AM', placementMode: 'fixed' };
    expect(isTaskOverdue(midnight, false, now, TZ)).toBe(true);
  });
});
