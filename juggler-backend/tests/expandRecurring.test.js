/**
 * Recurring Task Expansion Tests
 */

const { expandRecurring } = require('../../shared/scheduler/expandRecurring');

function makeSource(overrides) {
  return {
    id: 'ht_1', text: 'Daily workout', date: '3/20', dur: 30, pri: 'P1',
    recurring: true, rigid: false, recur: { type: 'daily' },
    dayReq: 'any', ...overrides
  };
}

describe('expandRecurring', () => {
  describe('daily recurrence', () => {
    test('generates instance for every day in range', () => {
      const src = makeSource({ date: '3/20' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
      // 3/20 is source date (skipped), so instances for 3/21, 3/22, 3/23, 3/24, 3/25
      expect(result).toHaveLength(5);
    });

    test('skips source date', () => {
      const src = makeSource({ date: '3/20' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 22));
      const dates = result.map(t => t.date);
      expect(dates).not.toContain('3/20');
      expect(dates).toContain('3/21');
      expect(dates).toContain('3/22');
    });
  });

  describe('weekly recurrence', () => {
    test('generates only on specified days (MWF)', () => {
      const src = makeSource({
        date: '3/16', // Monday
        recur: { type: 'weekly', days: 'MWF' }
      });
      // 3/16 Mon (source, skip), 3/17 Tue, 3/18 Wed, 3/19 Thu, 3/20 Fri, 3/21 Sat, 3/22 Sun, 3/23 Mon
      const result = expandRecurring([src], new Date(2026, 2, 16), new Date(2026, 2, 23));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/18'); // Wed
      expect(dates).toContain('3/20'); // Fri
      expect(dates).toContain('3/23'); // Mon
      expect(dates).not.toContain('3/17'); // Tue
      expect(dates).not.toContain('3/19'); // Thu
      expect(dates).not.toContain('3/21'); // Sat
    });

    test('defaults to MTWRF (weekdays) when no days specified', () => {
      const src = makeSource({
        date: '3/16',
        recur: { type: 'weekly' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 16), new Date(2026, 2, 22));
      const dates = result.map(t => t.date);
      // Weekdays only: 3/17 Tue, 3/18 Wed, 3/19 Thu, 3/20 Fri (not 3/21 Sat, 3/22 Sun)
      expect(dates).not.toContain('3/21');
      expect(dates).not.toContain('3/22');
    });
  });

  describe('biweekly recurrence', () => {
    test('generates every other week', () => {
      const src = makeSource({
        date: '3/2', // Monday
        recur: { type: 'biweekly', days: 'M' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      // Week 0: 3/2 (source, skip). Week 1: 3/9 (odd week, skip). Week 2: 3/16 (even). Week 3: 3/23 (odd, skip). Week 4: 3/30 (even). Week 5: 4/6 (odd, skip)
      expect(dates).toContain('3/16');
      expect(dates).toContain('3/30');
      expect(dates).not.toContain('3/9');
      expect(dates).not.toContain('3/23');
    });
  });

  describe('monthly recurrence', () => {
    test('generates on specific dates (1st, 15th)', () => {
      const src = makeSource({
        date: '3/1',
        recur: { type: 'monthly', monthDays: [1, 15] }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 4, 1));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/15');
      expect(dates).toContain('4/1');
      expect(dates).toContain('4/15');
    });

    test('handles "last" day of month', () => {
      const src = makeSource({
        date: '2/1',
        recur: { type: 'monthly', monthDays: ['last'] }
      });
      const result = expandRecurring([src], new Date(2026, 1, 1), new Date(2026, 3, 30));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2/28'); // Feb has 28 days in 2026
      expect(dates).toContain('3/31'); // Mar has 31 days
    });

    test('handles "first" day of month', () => {
      const src = makeSource({
        date: '2/15',
        recur: { type: 'monthly', monthDays: ['first'] }
      });
      const result = expandRecurring([src], new Date(2026, 1, 15), new Date(2026, 4, 1));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/1');
      expect(dates).toContain('4/1');
    });
  });

  describe('interval recurrence', () => {
    test('every 3 days', () => {
      const src = makeSource({
        date: '3/1',
        recur: { type: 'interval', every: 3, unit: 'days' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 2, 15));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/4');
      expect(dates).toContain('3/7');
      expect(dates).toContain('3/10');
      expect(dates).toContain('3/13');
      expect(dates).not.toContain('3/2');
      expect(dates).not.toContain('3/5');
    });

    test('every 2 weeks', () => {
      const src = makeSource({
        date: '3/1',
        recur: { type: 'interval', every: 2, unit: 'weeks' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 3, 30));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/15'); // 14 days after 3/1
      expect(dates).toContain('3/29'); // 28 days after 3/1
      expect(dates).not.toContain('3/8');
    });
  });

  describe('deduplication', () => {
    test('skips if ID already exists', () => {
      const existing = [
        makeSource({ date: '3/20' }),
        { id: 'rc_ht_1_321', date: '3/21', text: 'Daily workout' } // pre-existing instance
      ];
      const result = expandRecurring(existing, new Date(2026, 2, 20), new Date(2026, 2, 22));
      // 3/21 should be skipped (ID exists), only 3/22 generated
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('3/22');
    });

    test('skips if date+text combo exists', () => {
      const existing = [
        makeSource({ date: '3/20' }),
        { id: 'other-id', date: '3/21', text: 'Daily workout' }
      ];
      const result = expandRecurring(existing, new Date(2026, 2, 20), new Date(2026, 2, 22));
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('3/22');
    });
  });

  describe('day requirement filter', () => {
    test('weekday filter skips weekends', () => {
      const src = makeSource({
        date: '3/20', // Friday
        dayReq: 'weekday',
        recur: { type: 'daily' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
      const dates = result.map(t => t.date);
      expect(dates).not.toContain('3/21'); // Sat
      expect(dates).not.toContain('3/22'); // Sun
      expect(dates).toContain('3/23'); // Mon
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
        date: '3/1',            // Sunday — legacy scheduled_at date
        recurStart: '2026-03-02', // Monday — the true anchor
        recur: { type: 'biweekly', days: 'M' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/2');
      expect(dates).toContain('3/16');
      expect(dates).toContain('3/30');
      expect(dates).not.toContain('3/9');
      expect(dates).not.toContain('3/23');
    });

    test('interval anchor itself is an instance (>= 0 semantics)', () => {
      // recurStart = 3/1. every 3 days from that anchor: 3/1, 3/4, 3/7, ...
      const src = makeSource({
        id: 'iv',
        taskType: 'recurring_template',
        date: '3/1',
        recurStart: '2026-03-01',
        recur: { type: 'interval', every: 3, unit: 'days' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 1), new Date(2026, 2, 10));
      const dates = result.map(t => t.date);
      expect(dates).toContain('3/1');
      expect(dates).toContain('3/4');
      expect(dates).toContain('3/7');
      expect(dates).toContain('3/10');
    });

    test('recurStart null falls back to src.date', () => {
      const src = makeSource({
        id: 'fb',
        taskType: 'recurring_template',
        date: '3/2',
        recur: { type: 'biweekly', days: 'M' }
        // no recurStart
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      // Should behave identically to the existing biweekly test — src.date
      // carries the anchor when recurStart is absent.
      expect(dates).toContain('3/16');
      expect(dates).toContain('3/30');
      expect(dates).not.toContain('3/9');
      expect(dates).not.toContain('3/23');
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
        date: '4/19',
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
        date: '4/26', text: 'Submit Weekly UI Claim'
      };
      const existingAt53 = {
        id: 'swuc-21', sourceId: 'swuc', taskType: 'recurring_instance',
        date: '5/3', text: 'Submit Weekly UI Claim'
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
      expect(dates).toContain('4/19');
      expect(dates).not.toContain('4/24');
      expect(ours).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    test('tasks without recur return empty', () => {
      const tasks = [{ id: 't1', text: 'Normal task', date: '3/20' }];
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
