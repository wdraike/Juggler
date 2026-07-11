/**
 * Recurring Task Expansion Tests
 */

const { expandRecurring } = require('../../shared/scheduler/expandRecurring');
const { computeNextOccurrenceAnchor } = require('../src/lib/next-occurrence-anchor');

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

    // ZOE-JUG-002: placement_mode:'time_window' must be inherited by recurring instances
    test('instances inherit placement_mode time_window from template', () => {
      const src = makeSource({ placement_mode: 'time_window' });
      const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 21));
      expect(result).toHaveLength(1);
      expect(result[0].placement_mode).toBe('time_window');
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

  // REWRITTEN (juggler-anchor-column-cleanup W6, 2026-07-11): getAnchor() used
  // to branch on two SEPARATE fields (src.rollingAnchor for rolling masters,
  // src.nextOccurrenceAnchor for every other type) — both dropped in favor of
  // one unified src.nextStart, read for every recur type. The former "rolling
  // type ignores nextOccurrenceAnchor (uses rollingAnchor, unaffected)" test's
  // entire premise — two independent fields where one type must ignore the
  // other's value — no longer applies with a single shared field; it is
  // RETIRED, not renamed (its cross-check has no next_start-only equivalent;
  // rolling-specific anchor behavior stays covered by the 'rolling recurrence'
  // describe block below). The other two tests port directly: next_start
  // overriding/falling-back-to recurStart is now type-agnostic (previously
  // scoped to "non-rolling types" only), so they're generalized accordingly.
  describe('nextStart is the unified anchor for every recur type (juggler-anchor-column-cleanup)', () => {
    test('nextStart overrides recurStart for a weekly master', () => {
      // recurStart = 3/2 (Monday). nextStart advances the window to 3/16
      // (the master's own pattern already fired 3/2 and 3/9; this simulates the
      // anchor having moved forward past a terminal event) — biweekly
      // parity should now follow 3/16, not the stale recurStart.
      const src = makeSource({
        id: 'noa-bw',
        taskType: 'recurring_template',
        date: '2026-03-01',
        recurStart: '2026-03-02',
        nextStart: '2026-03-16',
        recur: { type: 'biweekly', days: 'M' }
      });
      const result = expandRecurring([src], new Date(2026, 2, 2), new Date(2026, 3, 6));
      const dates = result.map(t => t.date);
      expect(dates).toContain('2026-03-16');
      expect(dates).toContain('2026-03-30');
      // Old recurStart-based parity (3/2, 3/30 would still match by coincidence of
      // +28, but 3/9/3/23 must NOT appear either way) — the key assertion is that
      // 3/2 itself (before the new anchor) is no longer generated.
      expect(dates).not.toContain('2026-03-02');
      expect(dates).not.toContain('2026-03-09');
      expect(dates).not.toContain('2026-03-23');
    });

    test('null nextStart falls back to recurStart (pre-existing masters unaffected)', () => {
      const src = makeSource({
        id: 'noa-null',
        taskType: 'recurring_template',
        date: '2026-03-01',
        recurStart: '2026-03-02',
        nextStart: null,
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
  });

  // jug-weekly-recur-reshow (999.1372, Leg-B of SCHEDULER-SPEC IF.2 "Submit Weekly
  // UI Claim ×N unplaced"): a flexible-TPC master (timesPerCycle < selectedDayCount)
  // with a same-cycle 'done' instance on an EARLIER day still gets a fresh occurrence
  // picked for a LATER day in that same still-open cycle. Root cause has TWO
  // independently-sufficient mechanisms (see INTAKE-BRIEF.json root_cause):
  //   (1) expandRecurring.js candidates loop (`var c = new Date(startDate)`) never
  //       collects a date earlier than the scheduler run's 'today' — so an earlier
  //       same-cycle done/skip instance is invisible to bookedKeys/fulfilledInCycle
  //       even though instanceStatusBySourceDate (built from the FULL unwindowed
  //       allTasks) has the data.
  //   (2) `anchor = getAnchor(src, startDate)` resolves to `src.nextStart`
  //       when set (999.1091), which ADVANCES on every terminal event — and this same
  //       advancing anchor is reused as the TPC cycle-boundary epoch
  //       (`cycleStart = anchor + k*cycleDays`), so a terminal event mid-cycle can
  //       redefine the cycle boundary itself, re-orphaning the earlier fulfillment.
  // AC1-AC2: both the anchor-advanced (CASE A, production-matching) and the
  // non-advanced/null-anchor (CASE B, control) reproductions must be fixed.
  describe('jug-weekly-recur-reshow (999.1372): flexible-TPC same-cycle fulfillment must survive both mechanisms', () => {
    // CASE B (control) — exact repro.steps CASE B from INTAKE-BRIEF.json.
    test('AC1/AC2 CASE B — weekly, nextStart NOT advanced (null, falls back to recurStart): a done Monday must fulfill the whole cycle, zero new occurrences for it', () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 't1776649350872m2xp', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      const mondayDone = {
        id: 't1776649350872m2xp-32', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Submit Weekly UI Claim', status: 'done'
      };
      // today = 2026-07-07 (Tue, one day after the done Monday, same cycle).
      const result = expandRecurring([master, mondayDone], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // The cycle already fulfilled by Monday 7/6's done instance is [2026-07-06,
      // 2026-07-13). No date in that range may be generated — in particular NOT
      // 2026-07-08 (Wed), the exact reported production symptom (a fresh Wed pick
      // for a week the user already submitted their claim for on Monday).
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-07-08');
      // Positive half (zoe-jwrr-absence-only-assertions, 999.1372): absence alone
      // cannot distinguish "correctly skipped the fulfilled cycle" from "silently
      // suppressed ALL cycles" (an over-suppression regression that would still
      // pass the two assertions above and violate the juggler NEVER-MISSING
      // invariant). Pin the exact non-empty output: only the FOLLOWING un-fulfilled
      // cycle's Monday (7/13) and the cycle after (7/20) — nothing else, in window.
      expect(dates).toEqual(['2026-07-13', '2026-07-20']);
    });

    // CASE A (production-matching) — exact repro.steps CASE A from INTAKE-BRIEF.json:
    // nextStart already advanced by the 999.1091 done-event hook.
    test('AC1/AC2 CASE A — weekly, nextStart ALREADY ADVANCED (production match): a done Monday must still fulfill the cycle, zero new occurrences for it', () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' };
      // The exact live mechanism: marking Monday 'done' advances next_start
      // via computeNextOccurrenceAnchor (999.1091), landing on the following configured
      // day (Wed 2026-07-08) for this WRFM pattern — reproduced here, not hardcoded.
      const advancedAnchor = computeNextOccurrenceAnchor('done', '2026-07-06', null, recur);
      expect(advancedAnchor).toBe('2026-07-08'); // sanity: matches INTAKE-BRIEF.json repro
      const master = {
        id: 't1776649350872m2xp', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: advancedAnchor, dur: 30
      };
      const mondayDone = {
        id: 't1776649350872m2xp-32', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Submit Weekly UI Claim', status: 'done'
      };
      const result = expandRecurring([master, mondayDone], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-07-08');
      // Positive half (zoe-jwrr-absence-only-assertions, 999.1372) — same rationale
      // as CASE B above: pin the exact non-empty output so an over-suppression
      // regression (emptying ALL cycles, not just the fulfilled one) cannot pass.
      expect(dates).toEqual(['2026-07-13', '2026-07-20']);
    });

    // AC1/AC6 — biweekly flexible-TPC shares the identical mechanism (14-day cycle).
    test('AC1/AC6 — biweekly flexible-TPC: a done earlier day fulfills the 14-day cycle, zero extra occurrence later in the same cycle', () => {
      const recur = { type: 'biweekly', days: 'MW', timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 'bwmaster', taskType: 'recurring_template', text: 'Biweekly Report',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // Monday 2026-06-01 (cycle start) already done.
      const doneMonday = {
        id: 'bw-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-06-01', text: 'Biweekly Report', status: 'done'
      };
      // today = 2026-06-03 (Wed, later in the SAME 14-day cycle [06-01, 06-15)).
      const result = expandRecurring([master, doneMonday], new Date(2026, 5, 3), new Date(2026, 5, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-06-01' && d < '2026-06-15'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-06-03');
      // Positive half (zoe-jwrr-absence-only-assertions, 999.1372) — pin the exact
      // non-empty output (only the FOLLOWING un-fulfilled 14-day cycle's Monday,
      // 6/15, is in the [06-03,06-20) window) so an over-suppression regression
      // cannot pass alongside the absence-only checks above.
      expect(dates).toEqual(['2026-06-15']);
    });

    // AC1/AC6 — monthly flexible-TPC shares the identical mechanism (30-day cycle).
    test('AC1/AC6 — monthly flexible-TPC: a done earlier day fulfills the 30-day cycle, zero extra occurrence later in the same cycle', () => {
      const recur = { type: 'monthly', monthDays: [1, 15], timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 'monmaster', taskType: 'recurring_template', text: 'Monthly Review',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // 2026-06-01 already done.
      const doneJune1 = {
        id: 'mon-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-06-01', text: 'Monthly Review', status: 'done'
      };
      // today = 2026-06-03, later in the SAME 30-day cycle [06-01, 07-01).
      const result = expandRecurring([master, doneJune1], new Date(2026, 5, 3), new Date(2026, 7, 1), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-06-01' && d < '2026-07-01'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-06-15');
      // Positive half (zoe-jwrr-absence-only-assertions, 999.1372) — pin the exact
      // non-empty output for the two un-fulfilled 30-day cycles in the [06-03,08-01)
      // window (7/1 and 8/1) so an over-suppression regression cannot pass.
      expect(dates).toEqual(['2026-07-01', '2026-08-01']);
    });

    // AC5 — 'skip' is NOT a fulfillment. This is the mirror-image control: confirms
    // the fix (which must widen/stabilize cycle-boundary visibility) does NOT also
    // start treating a 'skip' as fulfilling — the backfill fillPolicy must still pick
    // a fresh occurrence in the cycle when the only earlier-in-cycle status is 'skip'.
    // This is expected GREEN both BEFORE and AFTER the fix (confirming, not
    // duplicating, R34.3/R34.4's keep/backfill skip semantics — see AC4).
    test('AC5 — a "skip" (not done) earlier in the cycle does NOT fulfill it: occurrence is still generated (must stay GREEN pre- and post-fix)', () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 't1776649350872m2xp', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      const mondaySkip = {
        id: 't1776649350872m2xp-32', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Submit Weekly UI Claim', status: 'skip'
      };
      const result = expandRecurring([master, mondaySkip], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // Skip does NOT fulfill the cycle — backfill fillPolicy must still pick a fresh
      // occurrence within the 7/6-7/12 cycle, unlike the 'done' cases above.
      expect(dates).toContain('2026-07-08');
    });

    // COMBO (telly REFER-b, --re-review): an earlier-in-cycle 'done' day PLUS a
    // later-cycle date already booked via opts.pendingBookedByDate — both must
    // contribute to the SAME cycle's fulfillment accounting. tpc=2, MWF: Monday
    // 7/6 done (earlier, pre-startDate) + Wednesday 7/8 pending (later-in-cycle,
    // reconcile-preserve). Booked = 1 done + 1 pending = 2 == tpc, so the
    // backfill fillPolicy must NOT pick a THIRD (phantom) date for Friday 7/10 —
    // that would be a double-book. Without widenedCycleCandidates covering
    // BOTH the done accounting (mechanism 1, pre-startDate visibility) and the
    // pending accounting together, the algorithm would only see 1 of the 2
    // booked slots and backfill a spurious 2nd new pick.
    test('AC-combo — earlier-in-cycle done day + later-cycle pendingBookedByDate day: pending still emits, no phantom 3rd (double-book) pick', () => {
      const recur = { type: 'weekly', days: 'MWF', timesPerCycle: 2, fillPolicy: 'backfill' };
      const master = {
        id: 'combomaster', taskType: 'recurring_template', text: 'Combo Check',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // Monday 7/6 — earlier-in-cycle, already done.
      const mondayDone = {
        id: 'combo-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Combo Check', status: 'done'
      };
      // Wednesday 7/8 — later-in-cycle, already booked via pendingBookedByDate
      // (simulates a prior scheduler run's pending pick the caller wants preserved).
      const pendingBookedByDate = { 'combomaster|2026-07-08': true };
      // today = 2026-07-07 (Tue) — AFTER the done Monday, same as CASE B/A.
      const result = expandRecurring(
        [master, mondayDone],
        new Date(2026, 6, 7),
        new Date(2026, 6, 20),
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // The pending Wednesday must still emit (reconcile-preserve).
      expect(dates).toContain('2026-07-08');
      // No phantom 3rd pick anywhere else in the cycle [07-06, 07-13) — in
      // particular NOT Friday 7/10, the backfill fillPolicy's next candidate
      // if the done Monday were invisible to the budget accounting.
      // Scoped to cycle 1 [07-06, 07-13) — later cycles in the window get their
      // own fresh tpc budget and are out of scope for this assertion.
      const cycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(cycleDates).toEqual(['2026-07-08']);
    });

    // Anchor-advanced corroboration (telly REFER-c, --re-review, optional):
    // weekly's CASE A already covers the anchor-ADVANCED (999.1091) state; this
    // adds ONE biweekly example to corroborate bert's finding that the fix is
    // type-agnostic (same shared TPC block, no per-type branching) rather than
    // re-deriving full coverage for every type.
    test('AC1/AC6 — biweekly flexible-TPC, nextStart ALREADY ADVANCED (anchor-advanced corroboration): a done earlier day must still fulfill the 14-day cycle', () => {
      const recur = { type: 'biweekly', days: 'MW', timesPerCycle: 1, fillPolicy: 'backfill' };
      // Same mechanism as weekly CASE A: marking Monday 6/1 'done' advances
      // next_start via computeNextOccurrenceAnchor (999.1091) to
      // the pattern's next own day (Wed 6/3) — reproduced here, not hardcoded.
      const advancedAnchor = computeNextOccurrenceAnchor('done', '2026-06-01', null, recur);
      expect(advancedAnchor).toBe('2026-06-03'); // sanity: matches this master's MW pattern
      const master = {
        id: 'bwmaster-adv', taskType: 'recurring_template', text: 'Biweekly Report',
        recur, recurStart: '2026-06-01', nextStart: advancedAnchor, dur: 30
      };
      const doneMonday = {
        id: 'bw-adv-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-06-01', text: 'Biweekly Report', status: 'done'
      };
      // today = 2026-06-03 (the advanced anchor's own date) — later in the SAME
      // 14-day cycle [06-01, 06-15). Without the stable-epoch fix, the mutable
      // advanced anchor would redefine cycleStart itself at 06-03, re-opening
      // the cycle for a fresh pick on that same date.
      const result = expandRecurring([master, doneMonday], new Date(2026, 5, 3), new Date(2026, 5, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-06-01' && d < '2026-06-15'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-06-03');
      // Positive-half regression pin (zoe election review, N-candidate: Candidate B
      // vs Candidate A vs baseline, 999.1372 fix-loop iteration 2). This exact
      // scenario — biweekly MW tpc=1, done Monday 2026-06-01 advances
      // next_start to Wed 2026-06-03 (an anchor date that is
      // off-parity from stableEpoch=recurStart=2026-06-01 under the naive
      // mutable-anchor biweekly check) — is RED on baseline (pre-any-fix) AND
      // under the REJECTED Candidate A (anchor-based parity revert), because
      // both leave the generation gate and the TPC candidate pool reading
      // biweekly parity from two independently-drifting epochs, which can
      // deadlock the pick/gate intersection to permanently empty. It is GREEN
      // only under the ELECTED Candidate B (matchesRecurrenceDay's new
      // optional parityAnchor param, sourced from the same stableEpoch the
      // candidate pool already uses) — pool and gate structurally cannot
      // disagree once they read the identical Date object. This assertion
      // pins that specific fix: without it, the deadlock class could silently
      // regress to emitting [] forever for any biweekly master whose anchor
      // drifts off-parity.
      expect(dates).toEqual(['2026-06-15']);
    });

    // edge_cases[1] (INTAKE-BRIEF.json, zoe-jwrr-absence-only-assertions fix):
    // a done/pending day genuinely in the PREVIOUS (already-closed) cycle must
    // NOT count toward the CURRENT cycle's fulfillment — the widened/stabilized
    // fulfillment accounting (999.1372) must not overcorrect into cross-cycle
    // leakage. Master's cycle boundaries (stableEpoch=recurStart=2026-06-01,
    // 7-day cycles): [06-29,07-06) is the PREVIOUS cycle, [07-06,07-13) is the
    // CURRENT still-open cycle containing 'today' (07-07).
    test('previous-cycle done day does NOT leak into current cycle fulfillment (no cross-cycle over-suppression)', () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 'prevcyclemaster', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // 2026-06-29 (Monday) is done — but that date falls in the PREVIOUS cycle
      // [06-29,07-06), not the current [07-06,07-13) one.
      const doneJune29 = {
        id: 'prevcycle-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-06-29', text: 'Submit Weekly UI Claim', status: 'done'
      };
      // today = 2026-07-07 (Tue), same as CASE A/B — but with NO done instance
      // in the current cycle, so the current cycle must still get a fresh pick.
      const result = expandRecurring([master, doneJune29], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // The current cycle [07-06,07-13) must NOT be suppressed by the previous
      // cycle's done day — pin the exact non-empty output (all 3 weekly cycles
      // in-window get a fresh pick: none was fulfilled in [07-06,07-27)).
      expect(dates).toEqual(['2026-07-08', '2026-07-15', '2026-07-20']);
    });

    // zoe-jwrr-keep-policy-change-untested (999.1372): bert's widened enumeration
    // (widenedCycleCandidates) also feeds hasSkipInCycle for the 'keep' fillPolicy
    // (expandRecurring.js ~L465), not just fulfilledInCycle for 'backfill' — every
    // pre-existing test in this describe block used fillPolicy:'backfill'. This
    // pins the 'keep' semantics: any skip ANYWHERE in the (now-widened) cycle view
    // — including a PRE-WINDOW, off-window-but-in-cycle day — freezes new picks
    // for that cycle (R34.3/R34.4 keep semantics), and the fix must not disturb it.
    test("keep fillPolicy — a pre-window skip earlier in the cycle freezes new picks for that cycle (widened hasSkipInCycle)", () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'keep' };
      const master = {
        id: 'keepmaster', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // Monday 2026-07-06 is skipped — BEFORE the scheduler run's startDate/'today'
      // (07-07), so only the widened (not window-bound) enumeration sees it.
      const mondaySkip = {
        id: 'keep-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Submit Weekly UI Claim', status: 'skip'
      };
      // today = 2026-07-07 (Tue), same cycle as the skip.
      const result = expandRecurring([master, mondaySkip], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // 'keep' + a skip anywhere in the cycle freezes new picks for THAT cycle —
      // no fresh occurrence in [07-06,07-13) — but the FOLLOWING un-fulfilled
      // cycle (07-13 onward) must still pick normally (keep is not a permanent
      // disable, only a per-cycle freeze).
      const cycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(cycleDates).toHaveLength(0);
      expect(dates).toEqual(['2026-07-13', '2026-07-20']);
    });

    // zoe-jwrr-keep-tpc2-hasskip-unpinned (WARN, zoe-REVIEW.json ~expandRecurring.js:516):
    // the tpc=1 keep test above is masked — at tpc=1, existingInCycle alone
    // (bookedKeys count, which includes the skip) already forces
    // slotsNeeded = max(0, 1-1) = 0 regardless of whether hasSkipInCycle reads
    // the widened cycle range or the window-bound cycleCandidates. A mutant
    // that narrows hasSkipInCycle back to window-bound cycleCandidates (the
    // pre-999.1372 narrowing) survives the whole suite at tpc=1. tpc=2 exposes
    // the real divergence: existingInCycle=1 (only the skip is "booked") but
    // tpc=2 leaves 1 nominal slot open, so ONLY an independently-detected
    // hasSkipInCycle (reading the WIDENED enumeration, which sees the
    // pre-window skip) correctly freezes the whole cycle to zero new picks;
    // a mutant reading window-bound cycleCandidates never sees the pre-window
    // skip and would emit a spurious 2nd pick (e.g. Wed 2026-07-08).
    test("keep fillPolicy — tpc=2: a pre-window skip within the widened cycle range still freezes ALL new picks (kills the window-bound-cycleCandidates mutant)", () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 2, fillPolicy: 'keep' };
      const master = {
        id: 'keeptpc2master', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // Monday 2026-07-06 is skipped — BEFORE the scheduler run's startDate/
      // 'today' (07-07), so only the WIDENED (not window-bound) enumeration
      // sees it. At tpc=1 (see test above) this scenario is masked by
      // existingInCycle math alone; tpc=2 requires hasSkipInCycle itself to
      // be correct.
      const mondaySkip = {
        id: 'keeptpc2-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-06', text: 'Submit Weekly UI Claim', status: 'skip'
      };
      // today = 2026-07-07 (Tue), same cycle as the pre-window skip.
      const result = expandRecurring([master, mondaySkip], new Date(2026, 6, 7), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // Zero picks anywhere in cycle 1 [07-06,07-13) despite tpc=2 and only 1
      // (skipped) of 2 slots "booked" — hasSkipInCycle must freeze the WHOLE
      // cycle, not just cap the remaining budget via existingInCycle.
      const cycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(cycleDates).toHaveLength(0);
    });

    // zoe-jwrr-roamed-done-invisible (BLOCK, fixed by bert via
    // enumerateBookedDatesInCycle/datesBySourceAll): a 'done' instance dated OFF
    // the master's pattern-enumerated days (e.g. dragged/roamed to a non-pattern
    // day by the user, or a flexible-TPC type with no DOW constraint) must still
    // fulfill its cycle — the fulfillment lookup must consult ACTUAL booked/
    // pending dates for the source, not just pattern-matching dates. Exact zoe
    // probe (1): weekly WRFM tpc=1, done Tue 2026-07-07 (not a WRFM day), today
    // 2026-07-08 (Wed, same cycle [07-06,07-13)) — pre-fix this emitted a fresh
    // 2026-07-09 occurrence in the same already-fulfilled cycle (the exact
    // production symptom); post-fix it must not.
    test('AC1/BLOCK-roamed — done instance dated OFF the pattern-enumerated days still fulfills the cycle (no phantom pick)', () => {
      const recur = { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' };
      const master = {
        id: 'roamedmaster', taskType: 'recurring_template', text: 'Submit Weekly UI Claim',
        recur, recurStart: '2026-06-01', nextStart: null, dur: 30
      };
      // Tuesday 2026-07-07 is done — NOT a WRFM (Wed/Thu/Fri/Mon) day, e.g. a
      // dragged/roamed instance — but still within the current cycle [07-06,07-13).
      const roamedDone = {
        id: 'roamed-1', taskType: 'recurring_instance', sourceId: master.id,
        date: '2026-07-07', text: 'Submit Weekly UI Claim', status: 'done'
      };
      // today = 2026-07-08 (Wed), same cycle as the off-pattern done Tuesday.
      const result = expandRecurring([master, roamedDone], new Date(2026, 6, 8), new Date(2026, 6, 20), {});
      const ours = result.filter(function(r) { return r.sourceId === master.id; });
      const dates = ours.map(function(r) { return r._candidateDate || r.date; });
      // No fresh pick anywhere in the fulfilled cycle [07-06,07-13) — in
      // particular NOT 2026-07-09 (Thu), the exact reported production symptom.
      const fulfilledCycleDates = dates.filter(function(d) { return d >= '2026-07-06' && d < '2026-07-13'; });
      expect(fulfilledCycleDates).toHaveLength(0);
      expect(dates).not.toContain('2026-07-09');
      // Positive half (zoe-jwrr-absence-only-assertions rationale applied here
      // too): pin the exact non-empty output for the FOLLOWING un-fulfilled
      // cycles in-window, so an over-suppression regression cannot pass.
      expect(dates).toEqual(['2026-07-13', '2026-07-20']);
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

    test('over-materialization cap: surplus pending beyond tpc are pruned (no phantom unplaced)', () => {
      // Cycle 1 (4/21-4/27): 2 done + 3 pending = 5 booked > tpc=4. Without the
      // cap, all 3 pending are kept (5 occurrences for a 4x/week task) and the
      // surplus surfaces as phantom "unplaced". With the cap, only tpc−terminal
      // = 4−2 = 2 (earliest) pending are kept; the 3rd is pruned by reconcile.
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-21', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 4 },
        recurStart: '2026-04-21', dayReq: 'any'
      };
      const done1 = { id: 'ex-d1', sourceId: 'ex', taskType: 'recurring_instance', date: '2026-04-21', text: 'Exercise', status: 'done' };
      const done2 = { id: 'ex-d2', sourceId: 'ex', taskType: 'recurring_instance', date: '2026-04-22', text: 'Exercise', status: 'done' };
      const pendingBookedByDate = {
        'ex|2026-04-23': true, 'ex|2026-04-24': true, 'ex|2026-04-25': true
      };
      const result = expandRecurring(
        [src, done1, done2],
        new Date(2026, 3, 21), // 4/21
        new Date(2026, 3, 27), // 4/27 (one cycle)
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      const dates = ours.map(r => r._candidateDate || r.date);
      // 2 earliest pending kept; 3rd pruned; no new picks (already at budget).
      expect(dates).toContain('2026-04-23');
      expect(dates).toContain('2026-04-24');
      expect(dates).not.toContain('2026-04-25');
      expect(ours.length).toBeLessThanOrEqual(2);
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

    test('skipping a FUTURE instance in the cycle preserves the skip (no resurrect)', () => {
      // Scenario: today is Monday 4/20. User has 4 pending Mon-Thu plus
      // a skipped Friday 4/24 (future — user said "not this week's Fri").
      // Scheduler must emit M/T/W/Th (preserving via ID-reuse), must NOT
      // emit Friday (terminal-dedup blocks it), and must NOT create a
      // replacement because the cycle is user-owned.
      const src = {
        id: 'ex', text: 'Exercise', taskType: 'recurring_template',
        date: '2026-04-20', dur: 30, pri: 'P2', recurring: true,
        recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
        recurStart: '2026-04-20', dayReq: 'any'
      };
      const pendingBookedByDate = {
        'ex|2026-04-20': true, // Mon
        'ex|2026-04-21': true, // Tue
        'ex|2026-04-22': true, // Wed
        'ex|2026-04-23': true  // Thu
      };
      const skippedFriday = {
        id: 'ex-5', sourceId: 'ex', taskType: 'recurring_instance',
        date: '2026-04-24', text: 'Exercise', status: 'skip'
      };
      const result = expandRecurring(
        [src, skippedFriday],
        new Date(2026, 3, 20), // today = Mon
        new Date(2026, 3, 26),
        { pendingBookedByDate: pendingBookedByDate }
      );
      const ours = result.filter(r => r.sourceId === 'ex');
      const dates = ours.map(r => r._candidateDate || r.date);
      expect(dates).toContain('2026-04-20');
      expect(dates).toContain('2026-04-21');
      expect(dates).toContain('2026-04-22');
      expect(dates).toContain('2026-04-23');
      // Friday skip is NOT resurrected
      expect(dates).not.toContain('2026-04-24');
      expect(dates).toHaveLength(4);
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

  describe('rolling recurrence', () => {
    const anchor = '2026-05-18'; // Monday

    function makeRolling(intervalDays, nextStart) {
      return {
        id: 'r1',
        text: 'Haircut',
        taskType: 'recurring_template',
        date: anchor,
        dur: 30,
        pri: 'P2',
        recurring: true,
        recur: { type: 'rolling', intervalDays, periodLabel: 'weekly', timesPerPeriod: 1 },
        recurStart: anchor,
        nextStart: nextStart || null,
        dayReq: 'any'
      };
    }

    // R5 (David 2026-06-29): a rolling task has only ONE active instance at a time —
    // "only scheduled at completion of the active instance; when completed, the next is
    // generated." So expandRecurring emits ONLY the next instance (anchor+interval), NOT
    // the whole horizon. Subsequent occurrences appear on later runs after completion
    // advances next_start. (Was: anchor+7,+14,+21 all at once — pre-R5 behavior.)
    test('7-day interval emits ONLY the next active instance (anchor+7)', () => {
      const src = makeRolling(7, null); // falls back to recurStart
      const result = expandRecurring(
        [src],
        new Date(2026, 4, 18), // 5/18
        new Date(2026, 5, 1)   // 6/1
      );
      const dates = result.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(dates).toEqual(['2026-05-25']); // single active instance only
      expect(dates).not.toContain('2026-06-01'); // next one waits for completion
      expect(dates).not.toContain('2026-05-18'); // anchor itself not emitted
    });

    test('3.5-day interval: emits ONLY the next active instance (anchor+4, rounded)', () => {
      const src = makeRolling(3.5, null);
      const result = expandRecurring(
        [src],
        new Date(2026, 4, 18),
        new Date(2026, 5, 1)
      );
      const dates = result.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(dates).toEqual(['2026-05-22']); // round(3.5) = +4; single active instance only
    });

    test('nextStart overrides recurStart', () => {
      const src = makeRolling(7, '2026-05-20'); // completed Wed, next due Wed+7
      const result = expandRecurring(
        [src],
        new Date(2026, 4, 20),
        new Date(2026, 5, 3)
      );
      const dates = result.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(dates).toContain('2026-05-27'); // 5/20 + 7
      expect(dates).not.toContain('2026-05-25'); // old recurStart-based date
    });

    test('existing terminal instance deduped', () => {
      const src = makeRolling(7, null);
      const existing = {
        id: 'r1-1', sourceId: 'r1', taskType: 'recurring_instance',
        date: '2026-05-25', status: 'done'
      };
      const result = expandRecurring(
        [src, existing],
        new Date(2026, 4, 18),
        new Date(2026, 5, 1)
      );
      const dates = result.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(dates).not.toContain('2026-05-25'); // already done — deduped
      expect(dates).toContain('2026-06-01');     // next slot still generated
    });

    test('null nextStart with null recurStart falls back to startDate', () => {
      const src = { ...makeRolling(7, null), recurStart: null, date: null };
      const result = expandRecurring(
        [src],
        new Date(2026, 4, 18),
        new Date(2026, 4, 25)
      );
      const dates = result.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(dates).toContain('2026-05-25'); // startDate + 7
    });

    test('null nextStart + old recurStart generates wrong date (demonstrates bug pre-backfill)', () => {
      // 2026-01-01 + 20*7 = 2026-05-21. With no nextStart the scheduler
      // falls back to recurStart and emits 5/21, violating the 7-day gap from
      // the 5/18 completion. runSchedule.js backfills next_start from
      // recurringHistoryByMaster before calling expandRecurring to prevent this.
      const bugSrc = { ...makeRolling(7, null), recurStart: '2026-01-01' };
      const today = new Date(2026, 4, 21); // 5/21
      const bugResult = expandRecurring([bugSrc], today, new Date(2026, 4, 28));
      const bugDates = bugResult.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(bugDates).toContain('2026-05-21'); // confirms the bug exists without backfill

      // After backfill: next_start set to 5/18 (the actual last completion)
      const fixedSrc = { ...makeRolling(7, '2026-05-18'), recurStart: '2026-01-01' };
      const fixResult = expandRecurring([fixedSrc], today, new Date(2026, 4, 28));
      const fixDates = fixResult.filter(r => r.sourceId === 'r1').map(r => r.date || r._candidateDate);
      expect(fixDates).not.toContain('2026-05-21'); // spacing respected
      expect(fixDates).toContain('2026-05-25');     // correct next date: 5/18 + 7
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

// ── BUG-814 repro: cancelled/disabled recurring_template must produce ZERO instances ──
//
// Root cause: expandRecurring.js:85 filter did not include 'cancelled' in the
// skip-list (only 'pause' and 'disabled'). A template with status='cancelled'
// (R55 soft-cancel) was treated as a live source and kept emitting fabricated
// instances, allowing the scheduler to resume a cancelled series.
//
// Fix applied: expandRecurring.js:85 adds `|| st === 'cancelled'` to the guard.
//
// Self-mutation note: removing 'cancelled' from the guard (reverting line 85)
// causes makeSource({status:'cancelled'}) to pass the filter and emit instances,
// flipping the `toHaveLength(0)` assertion to FAIL → RED.
describe('BUG-814 repro: cancelled/disabled recurring_template filtered in expandRecurring', () => {
  test('BUG-814-RED: template with status=cancelled produces zero fabricated instances', () => {
    // PRE-FIX: 'cancelled' was not in the skip-list → template treated as live source → emits instances.
    // POST-FIX: 'cancelled' is in the skip-list → filtered, zero instances emitted.
    const src = makeSource({ id: 'cancelled-tmpl', status: 'cancelled' });
    const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
    // POST-FIX: no instances generated for a cancelled template.
    expect(result).toHaveLength(0);
  });

  test('BUG-814-RED: template with status via statuses-map=cancelled produces zero instances', () => {
    // The statuses map (opts.statuses) overrides t.status in the filter.
    // runSchedule passes a statuses map to expandRecurring; this covers the
    // map-lookup path (st = statuses[t.id] || t.status || '').
    const src = makeSource({ id: 'tmpl-statmap', status: '' }); // raw status is '' (active)
    const result = expandRecurring(
      [src],
      new Date(2026, 2, 20), new Date(2026, 2, 25),
      { statuses: { 'tmpl-statmap': 'cancelled' } }  // statuses map overrides to 'cancelled'
    );
    // POST-FIX: statuses map says 'cancelled' → filtered, zero instances.
    expect(result).toHaveLength(0);
  });

  test('golden-master: active template (status="") still emits instances (filter does not over-exclude)', () => {
    // Regression guard: the fix must NOT exclude active (status='') templates.
    const src = makeSource({ id: 'active-tmpl', status: '' });
    const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
    // Active template: 3/21..3/25 = 5 instances (3/20 is source date, skipped).
    expect(result).toHaveLength(5);
  });

  test('disabled template also produces zero instances (paired with cancelled coverage)', () => {
    // 'disabled' was already in the skip-list pre-fix; confirm it still is post-fix.
    const src = makeSource({ id: 'disabled-tmpl', status: 'disabled' });
    const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25));
    expect(result).toHaveLength(0);
  });
});

describe('isAnchorDependentRecur — rolling', () => {
  test('rolling type is anchor-dependent', () => {
    const { isAnchorDependentRecur } = require('../../shared/scheduler/expandRecurring');
    expect(isAnchorDependentRecur({ type: 'rolling', intervalDays: 7 })).toBe(true);
  });
});
