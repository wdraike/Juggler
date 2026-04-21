/**
 * Recurring Task Expansion Tests
 */

const { expandRecurring } = require('../../shared/scheduler/expandRecurring');

function makeSource(overrides) {
  return {
    id: 'ht_1', text: 'Daily workout', date: '2026-03-20', dur: 30, pri: 'P1',
    recurring: true, rigid: false, recur: { type: 'daily' },
    dayReq: 'any', ...overrides
  };
}

describe('expandRecurring', () => {
  describe('daily recurrence', () => {
    test('generates instance for every day in range', () => {
      const src = makeSource({ date: '2026-03-20' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
      // 3/20 is source date (skipped), so instances for 3/21, 3/22, 3/23, 3/24, 3/25
      expect(result).toHaveLength(5);
    });

    test('skips source date', () => {
      const src = makeSource({ date: '2026-03-20' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 22));
      const dates = result.map(t => t.date);
      expect(dates).not.toContain('2026-03-20');
      expect(dates).toContain('2026-03-21');
      expect(dates).toContain('2026-03-22');
    });
  });

  describe('weekly recurrence', () => {
    test('generates only on specified days (MWF)', () => {
      const src = makeSource({
        date: '2026-03-16', // Monday
        recur: { type: 'weekly', days: 'MWF' }
      });
      // 3/16 Mon (source, skip), 3/17 Tue, 3/18 Wed, 3/19 Thu, 3/20 Fri, 3/21 Sat, 3/22 Sun, 3/23 Mon
      const result = expandRecurring([src], new Date(2026, 2, 16), new Date(2026, 2, 23));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-18'); // Wed
      expect(dates).toContain('2026-03-20'); // Fri
      expect(dates).toContain('2026-03-23'); // Mon
      expect(dates).not.toContain('2026-03-17'); // Tue
      expect(dates).not.toContain('2026-03-19'); // Thu
      expect(dates).not.toContain('2026-03-21'); // Sat
    });

    test('defaults to MTWRF (weekdays) when no days specified', () => {
      const src = makeSource({
        date: '2026-03-16',
        recur: { type: 'weekly' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 16), new Date(2026, 2, 22));
      const dates = result.map(t => t.date);
      // Weekdays only: 3/17 Tue, 3/18 Wed, 3/19 Thu, 3/20 Fri (not 3/21 Sat, 3/22 Sun)
      expect(dates).not.toContain('2026-03-21');
      expect(dates).not.toContain('2026-03-22');
    });
  });

  describe('biweekly recurrence', () => {
    test('generates every other week', () => {
      const src = makeSource({
        date: '2026-03-02', // Monday
        recur: { type: 'biweekly', days: 'M' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      // Week 0: 3/2 (source, skip). Week 1: 3/9 (odd week, skip). Week 2: 3/16 (even). Week 3: 3/23 (odd, skip). Week 4: 3/30 (even). Week 5: 4/6 (odd, skip)
      expect(dates).toContain('2026-03-16');
      expect(dates).toContain('2026-03-30');
      expect(dates).not.toContain('2026-03-09');
      expect(dates).not.toContain('2026-03-23');
    });
  });

  describe('monthly recurrence', () => {
    test('generates on specific dates (1st, 15th)', () => {
      const src = makeSource({
        date: '2026-03-01',
        recur: { type: 'monthly', monthDays: [1, 15] }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 4, 1));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-15');
      expect(dates).toContain('2026-04-01');
      expect(dates).toContain('2026-04-15');
    });

    test('handles "last" day of month', () => {
      const src = makeSource({
        date: '2026-02-01',
        recur: { type: 'monthly', monthDays: ['last'] }
      });
      const result = expandRecurring([src], new Date(2026, 1, 1), new Date(2026, 3, 30));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-02-28'); // Feb has 28 days in 2026
      expect(dates).toContain('2026-03-31'); // Mar has 31 days
    });

    test('handles "first" day of month', () => {
      const src = makeSource({
        date: '2026-02-15',
        recur: { type: 'monthly', monthDays: ['first'] }
      });
      const result = expandRecurring([src], new Date(2026, 1, 15), new Date(2026, 4, 1));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-01');
      expect(dates).toContain('2026-04-01');
    });
  });

  describe('interval recurrence', () => {
    test('every 3 days', () => {
      const src = makeSource({
        date: '2026-03-01',
        recur: { type: 'interval', every: 3, unit: 'days' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 2, 15));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-04');
      expect(dates).toContain('2026-03-07');
      expect(dates).toContain('2026-03-10');
      expect(dates).toContain('2026-03-13');
      expect(dates).not.toContain('2026-03-02');
      expect(dates).not.toContain('2026-03-05');
    });

    test('every 2 weeks', () => {
      const src = makeSource({
        date: '2026-03-01',
        recur: { type: 'interval', every: 2, unit: 'weeks' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 3, 30));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-15'); // 14 days after 3/1
      expect(dates).toContain('2026-03-29'); // 28 days after 3/1
      expect(dates).not.toContain('2026-03-08');
    });
  });

  describe('deduplication', () => {
    test('skips if ID already exists', () => {
      const existing = [
        makeSource({ date: '2026-03-20' }),
        { id: 'rc_ht_1_321', date: '2026-03-21', text: 'Daily workout' } // pre-existing instance
      ];
      const result = expandRecurring(existing, new Date(2026, 2, 20), new Date(2026, 2, 22));
      // 3/21 should be skipped (ID exists), only 3/22 generated
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-03-22');
    });

    test('skips if date+text combo exists', () => {
      const existing = [
        makeSource({ date: '2026-03-20' }),
        { id: 'other-id', date: '2026-03-21', text: 'Daily workout' }
      ];
      const result = expandRecurring(existing, new Date(2026, 2, 20), new Date(2026, 2, 22));
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-03-22');
    });
  });

  describe('day requirement filter', () => {
    test('weekday filter skips weekends', () => {
      const src = makeSource({
        date: '2026-03-20', // Friday
        dayReq: 'weekday',
        recur: { type: 'daily' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
      const dates = result.map(t => t.date);
      expect(dates).not.toContain('2026-03-21'); // Sat
      expect(dates).not.toContain('2026-03-22'); // Sun
      expect(dates).toContain('2026-03-23'); // Mon
    });
  });

  describe('field inheritance', () => {
    test('instances inherit template fields', () => {
      const src = makeSource({ text: 'Run 5k', dur: 45, pri: 'P1', project: 'Fitness' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 21));
      expect(result[0].text).toBe('Run 5k');
      expect(result[0].dur).toBe(45);
      expect(result[0].pri).toBe('P1');
      expect(result[0].project).toBe('Fitness');
    });

    test('ID is sourceId-ordinal (date-agnostic, reusable)', () => {
      const sourceId = '019d5dfa-a97c-7152-a799-f21ba1026db2';
      const src = makeSource({ id: sourceId });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 22));
      // First instance gets ordinal 1, second gets ordinal 2
      expect(result[0].id).toBe(sourceId + '-1');
      expect(result[0]._candidateDate).toBeDefined();
      if (result.length > 1) {
        expect(result[1].id).toBe(sourceId + '-2');
      }
    });
  });

  describe('recurStart is the anchor', () => {
    test('biweekly parity follows recurStart, not src.date', () => {
      // recurStart = 3/2 (week N). Biweekly-M should match 3/2, 3/16, 3/30 —
      // NOT 3/9, 3/23 (odd weeks). src.date intentionally differs from
      // recurStart to verify anchor swap is active.
      const src = makeSource({
        id: 'bw',
        taskType: 'recurring_template',
        date: '2026-03-01',            // Sunday — legacy scheduled_at date
        recurStart: '2026-03-02', // Monday — the true anchor
        recur: { type: 'biweekly', days: 'M' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-02');
      expect(dates).toContain('2026-03-16');
      expect(dates).toContain('2026-03-30');
      expect(dates).not.toContain('2026-03-09');
      expect(dates).not.toContain('2026-03-23');
    });

    test('interval anchor itself is an instance (>= 0 semantics)', () => {
      // recurStart = 3/1. every 3 days from that anchor: 3/1, 3/4, 3/7, ...
      const src = makeSource({
        id: 'iv',
        taskType: 'recurring_template',
        date: '2026-03-01',
        recurStart: '2026-03-01',
        recur: { type: 'interval', every: 3, unit: 'days' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 2, 10));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-01');
      expect(dates).toContain('2026-03-04');
      expect(dates).toContain('2026-03-07');
      expect(dates).toContain('2026-03-10');
    });

    test('recurStart null falls back to src.date', () => {
      const src = makeSource({
        id: 'fb',
        taskType: 'recurring_template',
        date: '2026-03-02',
        recur: { type: 'biweekly', days: 'M' }
        // no recurStart
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      // Should behave identically to the existing biweekly test — src.date
      // carries the anchor when recurStart is absent.
      expect(dates).toContain('2026-03-16');
      expect(dates).toContain('2026-03-30');
      expect(dates).not.toContain('2026-03-09');
      expect(dates).not.toContain('2026-03-23');
    });
  });

  describe('timesPerCycle with future-only existing instances', () => {
    // Repro: brand-new template, but prior scheduler runs persisted instances
    // only in cycles 2 and 3. Cycle 1 (today) has no existing instance. The
    // algorithm should still pick cycle 1's anchor (cycleStart = today), not
    // project idealDate forward from the max-existing-date into the future.
    test('cycle 1 picks cycleStart when no earlier placement exists', () => {
      // 2026-04-19 is a Sunday. 14-day window → cycles start 4/19, 4/26, 5/3.
      const src = {
        id: 'swuc',
        text: 'Submit Weekly UI Claim',
        taskType: 'recurring_template',
        date: '2026-04-19',
        dur: 30,
        pri: 'P1',
        recurring: true,
        recur: { type: 'weekly', days: 'MWRFUT', timesPerCycle: 1 },
        recurStart: '2026-04-19',
        dayReq: 'any'
      };
      // Seed existing instances at 4/26 and 5/3 (the two later cycles).
      const existingAt426 = {
        id: 'swuc-20', sourceId: 'swuc', taskType: 'recurring_instance',
        date: '2026-04-26', text: 'Submit Weekly UI Claim'
      };
      const existingAt53 = {
        id: 'swuc-21', sourceId: 'swuc', taskType: 'recurring_instance',
        date: '2026-05-03', text: 'Submit Weekly UI Claim'
      };
      const result = expandRecurring(
        [src, existingAt426, existingAt53],
        new Date(2026, 3, 19), // 4/19
        new Date(2026, 4, 3)   // 5/3
      );
      const ours = result.filter(r => r.sourceId === 'swuc');
      const dates = ours.map(r => r._candidateDate || r.date);
      // Cycle 1 should produce an instance on 4/19 (today), not 4/24.
      // Cycles 2 and 3 are already filled by existing rows → no new picks.
      expect(dates).toContain('2026-04-19');
      expect(dates).not.toContain('2026-04-24');
      expect(ours).toHaveLength(1);
    });

    test('pendingBookedByDate counts pending as cycle occupants (no rebook after skip)', () => {
      // Regression: user has tpc=4 weekly exercise. Originally picked 4/22,
      // 4/24, 4/26, 4/28. Skipped 4/22 4/24 4/26 — all terminal. 4/28 now
      // lives in the next cycle because of the 7-day anchor window.
      // Within cycle 1 (4/21-4/27) we have 3 skipped + 0 pending = 3 booked.
      // Caller ALSO passes pendingBookedByDate for 4/30, 5/2 etc. in cycle 2.
      // Cycle 2 should treat those pending as booked → slotsNeeded drops.
      const src = {
        id: 'ex',
        text: 'Exercise',
        taskType: 'recurring_template',
        date: '2026-04-21',
        dur: 30,
        pri: 'P2',
        recurring: true,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 4 },
        recurStart: '2026-04-21',
        dayReq: 'any'
      };
      // Seed three skipped instances in cycle 1 (they populate existingBySourceDate).
      const skipped1 = { id: 'ex-1', sourceId: 'ex', taskType: 'recurring_instance', date: '2026-04-22', text: 'Exercise', status: 'skip' };
      const skipped2 = { id: 'ex-2', sourceId: 'ex', taskType: 'recurring_instance', date: '2026-04-24', text: 'Exercise', status: 'skip' };
      const skipped3 = { id: 'ex-3', sourceId: 'ex', taskType: 'recurring_instance', date: '2026-04-26', text: 'Exercise', status: 'skip' };

      // Without the pending-counting fix, the algorithm would see 3 booked
      // (the skips) and pick a 4th date in cycle 1 (e.g., 4/21) every run.
      // With pendingBookedByDate populated for cycle 2 dates, the algorithm
      // also knows cycle 2 is already at its tpc budget (4 pending), so no
      // new cycle-2 picks. Cycle 1 still picks 1 new date because user hasn't
      // pending-booked it — expected, matches user's "3 skip = cycle 2/4"
      // reading only if they've also filled pending; here they haven't.
      //
      // The specific assertion: cycle 2 (4/28-5/4) has 4 pending dates passed
      // via opts.pendingBookedByDate → no new picks emitted for cycle 2.
      const pendingBookedByDate = {
        'ex|2026-04-28': true,
        'ex|2026-04-30': true,
        'ex|2026-05-02': true,
        'ex|2026-05-04': true
      };
      const result = expandRecurring(
        [src, skipped1, skipped2, skipped3],
        new Date(2026, 3, 21), // 4/21
        new Date(2026, 4, 4),  // 5/4
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      const dates = ours.map(r => r._candidateDate || r.date);
      // Cycle 2: the 4 pending dates emit (so reconcile preserves them),
      // and no NEW picks happen beyond those 4.
      ['2026-04-28', '2026-04-30', '2026-05-02', '2026-05-04'].forEach(d => {
        expect(dates).toContain(d);
      });
      // Cycle-2 non-pending candidate dates are NOT in output.
      ['2026-04-29', '2026-05-01', '2026-05-03'].forEach(d => {
        expect(dates).not.toContain(d);
      });
    });
  });

  describe('caller-normalized ISO dates block re-emission', () => {
    // Simulates the production runSchedule.js path: knex returns MySQL DATE as
    // ISO strings, runSchedule normalizes via isoToDateKey before calling
    // expandRecurring. Without the normalization, the keys are ISO-format and
    // the M/D lookup inside expandRecurring silently misses — which is the
    // "skip → comes right back" bug for tpc recurrences.
    const { isoToDateKey } = require('../src/scheduler/dateHelpers');

    test('terminal dedup with ISO-format date blocks re-emission after caller normalizes', () => {
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      // Three terminal-dedup synthetic rows as runSchedule would build them
      // from ISO-format DB `date` values (normalized via isoToDateKey).
      const dedupRows = ['2026-04-22', '2026-04-24', '2026-04-26'].map(function(iso, i) {
        return {
          id: '_dedup_ex_' + iso,
          sourceId: 'ex',
          taskType: 'recurring_instance',
          date: isoToDateKey(iso),
          text: '',
          status: 'done'
        };
      });
      const result = expandRecurring(
        [src].concat(dedupRows),
        new Date(2026, 3, 21),
        new Date(2026, 3, 27),
        {}
      );
      const dates = result.filter(r => r.sourceId === 'ex').map(r => r._candidateDate || r.date);
      // Three cycle-1 slots are terminal-booked; only one slot remains open.
      expect(dates).not.toContain('2026-04-22');
      expect(dates).not.toContain('2026-04-24');
      expect(dates).not.toContain('2026-04-26');
    });

    test('pendingBookedByDate dates emit as desired (so reconcile preserves them), no new picks', () => {
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      // Caller (runSchedule) derives these keys from ISO DB values via isoToDateKey.
      const pendingDates = ['2026-04-21', '2026-04-23', '2026-04-25', '2026-04-27'];
      const pendingBookedByDate = {};
      pendingDates.forEach(function(iso) {
        pendingBookedByDate['ex|' + isoToDateKey(iso)] = true;
      });
      const result = expandRecurring(
        [src],
        new Date(2026, 3, 21),
        new Date(2026, 3, 27),
        { pendingBookedByDate: pendingBookedByDate }
      );
      const dates = result.filter(r => r.sourceId === 'ex').map(r => r._candidateDate || r.date);
      // All 4 pending dates emit (reconcile will ID-reuse them). No new picks
      // beyond the existing pending.
      pendingDates.forEach(function(d) { expect(dates).toContain(d); });
      expect(dates).toHaveLength(4);
    });
  });

  describe('skip does not reshape cycle (tpc-refill avoidance)', () => {
    // User feedback: "skip should not reshape future dates". When the user
    // has 1 pending Exercise and skips it, the scheduler MUST NOT fill the
    // cycle back up to tpc with 3 brand-new dates — that's the "Exercise
    // keeps returning" bug.
    //
    // Rule: once ANY instance (pending OR terminal) exists in a cycle, the
    // cycle is "user-owned" — no refills. Fresh cycles (zero existing) get
    // the full tpc budget.
    test('cycle with 1 skip and 0 pending does not refill to tpc', () => {
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      // User skipped Tuesday — it's the ONLY instance they had (not the
      // typical 4). Without the fix: tpc=4 - 1 skip = 3 slotsNeeded, scheduler
      // picks 3 replacement dates and Exercise returns on W/Th/F.
      const skipped = {
        id: 'ex-1', sourceId: 'ex', taskType: 'recurring_instance',
        date: '2026-04-21', text: 'Exercise', status: 'skip'
      };
      const result = expandRecurring(
        [src, skipped],
        new Date(2026, 3, 21),
        new Date(2026, 3, 27),
        {}
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      expect(ours).toHaveLength(0);
    });

    test('fresh cycle with zero existing picks tpc slots', () => {
      // Sanity check: first-ever run still works — the rule triggers only
      // when existingInCycle > 0.
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      const result = expandRecurring(
        [src],
        new Date(2026, 3, 21),
        new Date(2026, 3, 27),
        {}
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      expect(ours).toHaveLength(4);
    });

    test('cycle with 2 pending + 1 skip emits the 2 pending and does NOT create a 4th', () => {
      // User had 3 instances, skipped one. Cycle budget consumed.
      // The 2 pending must still be emitted as desired so the reconcile
      // diff preserves them (ID-reuse keeps the DB rows). Without pending
      // in the desired set, they'd be deleted as "not desired".
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      const pendingBookedByDate = {
        'ex|2026-04-22': true,
        'ex|2026-04-23': true
      };
      const skipped = {
        id: 'ex-1', sourceId: 'ex', taskType: 'recurring_instance',
        date: '2026-04-21', text: 'Exercise', status: 'skip'
      };
      const result = expandRecurring(
        [src, skipped],
        new Date(2026, 3, 21),
        new Date(2026, 3, 27),
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      const dates = ours.map(r => r._candidateDate || r.date);
      // Pending dates emit — so reconcile preserves them.
      expect(dates).toContain('2026-04-22');
      expect(dates).toContain('2026-04-23');
      // Skipped date does NOT emit.
      expect(dates).not.toContain('2026-04-21');
      // No replacement for the skipped slot.
      expect(dates).toHaveLength(2);
    });

    test('steady state: 4 pending with no skip, all 4 emit (ID reuse preserves existing rows)', () => {
      // The normal "scheduler ran again, no user changes" case. All 4
      // pending dates must be in the desired set or reconcile deletes them.
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-20', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
        recurStart: '2026-04-20', dayReq: 'any'
      };
      const pendingBookedByDate = {
        'ex|2026-04-20': true,
        'ex|2026-04-21': true,
        'ex|2026-04-22': true,
        'ex|2026-04-23': true
      };
      const result = expandRecurring(
        [src],
        new Date(2026, 3, 20),
        new Date(2026, 3, 26),
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      const dates = ours.map(r => r._candidateDate || r.date);
      expect(dates).toContain('2026-04-20');
      expect(dates).toContain('2026-04-21');
      expect(dates).toContain('2026-04-22');
      expect(dates).toContain('2026-04-23');
      expect(dates).toHaveLength(4);
    });
  });

  describe('edge cases', () => {
    test('tasks without recur return empty', () => {
      const tasks = [{ id: 't1', text: 'Normal task', date: '2026-03-20' }];
      expect(expandRecurring(tasks, new Date(2026, 2, 20), new Date(2026, 2, 25))).toEqual([]);
    });

    test('empty sources return empty', () => {
      expect(expandRecurring([], new Date(2026, 2, 20), new Date(2026, 2, 25))).toEqual([]);
    });

    test('recurring_instance tasks are not treated as sources', () => {
      const tasks = [
        makeSource(),
        { id: 'rc_1', text: 'Instance', taskType: 'recurring_instance', recur: { type: 'daily' } }
      ];
      const result = expandRecurring(tasks, new Date(2026, 2, 20), new Date(2026, 2, 22));
      // Only the source should generate instances, not the instance itself
      const sourceIds = result.filter(t => t.sourceId === 'rc_1');
      expect(sourceIds).toHaveLength(0);
    });
  });
});
