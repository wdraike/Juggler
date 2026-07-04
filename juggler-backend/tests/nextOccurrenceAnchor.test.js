const { isPatternRecurMaster, computeNextOccurrenceAnchor } = require('../src/lib/next-occurrence-anchor');

describe('isPatternRecurMaster', () => {
  test('returns true for weekly recur type', () => {
    expect(isPatternRecurMaster({ recur: JSON.stringify({ type: 'weekly', days: 'M' }) })).toBe(true);
  });
  test('returns false for rolling recur type', () => {
    expect(isPatternRecurMaster({ recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }) })).toBe(false);
  });
  test('returns false for null recur', () => {
    expect(isPatternRecurMaster({ recur: null })).toBe(false);
  });
  test('returns true for monthly/interval/yearly-as-interval', () => {
    expect(isPatternRecurMaster({ recur: JSON.stringify({ type: 'monthly', monthDays: [11, 22] }) })).toBe(true);
    expect(isPatternRecurMaster({ recur: JSON.stringify({ type: 'interval', every: 3, unit: 'days' }) })).toBe(true);
    expect(isPatternRecurMaster({ recur: JSON.stringify({ type: 'interval', every: 1, unit: 'years' }) })).toBe(true);
  });
});

describe('computeNextOccurrenceAnchor', () => {
  test('cancel: returns null (no anchor change)', () => {
    const recur = { type: 'weekly', days: 'W' };
    expect(computeNextOccurrenceAnchor('cancel', '2026-07-08', null, recur)).toBe(null);
  });

  test('non-terminal status: returns null', () => {
    const recur = { type: 'weekly', days: 'W' };
    expect(computeNextOccurrenceAnchor('pending', '2026-07-08', null, recur)).toBe(null);
  });

  test('rolling type: returns null (rolling-anchor.js owns that column)', () => {
    const recur = { type: 'rolling', intervalDays: 7 };
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', null, recur)).toBe(null);
  });

  test('missing instanceDate: returns null', () => {
    const recur = { type: 'weekly', days: 'W' };
    expect(computeNextOccurrenceAnchor('done', null, null, recur)).toBe(null);
  });

  // daily -> next day (David: "it will likely be today [near-term]")
  test('daily: done advances anchor to the next day', () => {
    const recur = { type: 'daily' };
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', null, recur)).toBe('2026-07-09');
  });

  test('daily: skip advances the same as done', () => {
    const recur = { type: 'daily' };
    expect(computeNextOccurrenceAnchor('skip', '2026-07-08', null, recur)).toBe('2026-07-09');
  });

  // weekly single day-of-week -> same weekday next week
  test('weekly single-day (Wed only): done advances to next Wednesday', () => {
    const recur = { type: 'weekly', days: 'W' };
    // 2026-07-08 is a Wednesday.
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', null, recur)).toBe('2026-07-15');
  });

  // weekly multi-day (Mon/Wed/Fri) -> next day IN THE LIST, wrapping to next week's
  // first configured day after the last — David's synthesis, "11->22->11" pattern
  // applied to weekly.
  test('weekly multi-day (Mon/Wed/Fri): Monday done advances to Wednesday (same week)', () => {
    const recur = { type: 'weekly', days: 'MWF' };
    // 2026-07-06 is a Monday.
    expect(computeNextOccurrenceAnchor('done', '2026-07-06', null, recur)).toBe('2026-07-08');
  });

  test('weekly multi-day (Mon/Wed/Fri): Wednesday done advances to Friday (same week)', () => {
    const recur = { type: 'weekly', days: 'MWF' };
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', null, recur)).toBe('2026-07-10');
  });

  test('weekly multi-day (Mon/Wed/Fri): Friday done wraps to next Monday', () => {
    const recur = { type: 'weekly', days: 'MWF' };
    // 2026-07-10 is a Friday.
    expect(computeNextOccurrenceAnchor('done', '2026-07-10', null, recur)).toBe('2026-07-13');
  });

  // monthly {11, 22} -> next day in the list, wrapping to next month — David's exact
  // verbatim example.
  test('monthly {11,22}: 11th done advances to 22nd (same month)', () => {
    const recur = { type: 'monthly', monthDays: [11, 22] };
    expect(computeNextOccurrenceAnchor('done', '2026-07-11', null, recur)).toBe('2026-07-22');
  });

  test('monthly {11,22}: 22nd done wraps to 11th of next month', () => {
    const recur = { type: 'monthly', monthDays: [11, 22] };
    expect(computeNextOccurrenceAnchor('done', '2026-07-22', null, recur)).toBe('2026-08-11');
  });

  // yearly (interval, unit=years, every=1) -> exact same calendar date, one year fwd
  test('yearly (interval every=1 unit=years): done advances exactly one year', () => {
    const recur = { type: 'interval', every: 1, unit: 'years' };
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', null, recur)).toBe('2027-07-08');
  });

  // ernie WARN (999.1091 fix loop): a leap-day anchor only recurs every ~4 calendar
  // years regardless of `every`, since the match requires month+date AND
  // yearDiff % every === 0 -- a bound sized to `every*366` under-bounds every<4.
  test('yearly leap-day (Feb 29, every=1): skips non-leap years, lands on the next Feb 29 (4 years later)', () => {
    const recur = { type: 'interval', every: 1, unit: 'years' };
    expect(computeNextOccurrenceAnchor('done', '2024-02-29', null, recur)).toBe('2028-02-29');
  });

  // ernie WARN (999.1091 fix loop): a day-of-month absent from intervening
  // applicable months (e.g. every=3 on the 31st: Jan/Apr/Jul/Oct, but only Jan and
  // Jul have a 31st) can skip a full extra cycle before matching.
  test('monthly interval (every=3 on the 31st): skips April (no 31st), lands on July 31', () => {
    const recur = { type: 'interval', every: 3, unit: 'months' };
    expect(computeNextOccurrenceAnchor('done', '2026-01-31', null, recur)).toBe('2026-07-31');
  });

  // biweekly: parity must stay exact across repeated advances, chaining off the
  // PREVIOUS anchor each time (self-referential phase reference) — this is the
  // C1-AC5-equivalent regression guard.
  test('biweekly: parity stays exact across 3 consecutive advances', () => {
    const recur = { type: 'biweekly', days: 'M' };
    // 2026-07-06 is a Monday (cycle 0).
    const a1 = computeNextOccurrenceAnchor('done', '2026-07-06', null, recur);
    expect(a1).toBe('2026-07-20'); // +14, not +7
    const a2 = computeNextOccurrenceAnchor('done', a1, a1, recur);
    expect(a2).toBe('2026-08-03'); // +14 again
    const a3 = computeNextOccurrenceAnchor('done', a2, a2, recur);
    expect(a3).toBe('2026-08-17'); // +14 again
  });

  // stale-event guard: never move the anchor backwards (mirrors rolling-anchor.js R33.4)
  test('stale-event guard: a computed candidate before currentAnchor returns null', () => {
    const recur = { type: 'weekly', days: 'W' };
    // currentAnchor already ahead of what a walk from an OLDER instanceDate would find.
    expect(computeNextOccurrenceAnchor('done', '2026-07-01', '2026-07-15', recur)).toBe(null);
  });

  test('guard allows candidate === currentAnchor (>= is allowed, mirrors R33.4)', () => {
    const recur = { type: 'weekly', days: 'W' };
    expect(computeNextOccurrenceAnchor('done', '2026-07-08', '2026-07-15', recur)).toBe('2026-07-15');
  });

  // cookie ARCH-REVIEW refer-out (INFO REFER->telly, I5): AC6 (monthly wrap) was
  // only exercised as two independent single-shot calls (11->22, 22->11). Chain
  // 4 CONSECUTIVE terminal events, each referencing the PREVIOUS call's own
  // returned anchor as both instanceDate and currentAnchor (the real call
  // pattern facade.js/mcp/tools/tasks.js use) — proves the day-list wrap phase
  // (11,22,11,22...) stays correct across a MONTH BOUNDARY twice in a row, not
  // just once, i.e. no phase drift accumulates across repeated wraps.
  test('monthly {11,22}: phase stays correct across 4 consecutive advances (two full month-boundary wraps)', () => {
    const recur = { type: 'monthly', monthDays: [11, 22] };
    const a1 = computeNextOccurrenceAnchor('done', '2026-07-11', null, recur);
    expect(a1).toBe('2026-07-22'); // same month
    const a2 = computeNextOccurrenceAnchor('done', a1, a1, recur);
    expect(a2).toBe('2026-08-11'); // wraps to next month
    const a3 = computeNextOccurrenceAnchor('done', a2, a2, recur);
    expect(a3).toBe('2026-08-22'); // same month again
    const a4 = computeNextOccurrenceAnchor('done', a3, a3, recur);
    expect(a4).toBe('2026-09-11'); // wraps a SECOND time — proves no drift
  });

  // cookie ARCH-REVIEW refer-out (INFO REFER->telly, I5): AC8 (stale-event guard)
  // was only exercised as a single isolated call. Chain a real advance, then an
  // out-of-order/duplicate terminal event for an OLDER instance (must be
  // rejected, anchor unchanged), then a NORMAL subsequent advance from the
  // still-current anchor — proves the guard rejecting a stale event mid-sequence
  // does not corrupt or stall the anchor chain for the NEXT legitimate event.
  test('stale-event guard: a rejected stale event mid-chain does not disrupt the next legitimate advance', () => {
    const recur = { type: 'weekly', days: 'W' };
    const a1 = computeNextOccurrenceAnchor('done', '2026-07-08', null, recur);
    expect(a1).toBe('2026-07-15');

    // A late-arriving duplicate 'done' for an OLDER (already-superseded)
    // instance date — candidate it would compute (2026-07-08) is < currentAnchor
    // (2026-07-15), so the guard must reject it.
    const stale = computeNextOccurrenceAnchor('done', '2026-07-01', a1, recur);
    expect(stale).toBe(null);

    // The NEXT real terminal event (instanceDate === the still-unchanged
    // currentAnchor) must advance normally — proves the rejected stale call
    // left no side effect on the chain's own state.
    const a2 = computeNextOccurrenceAnchor('done', a1, a1, recur);
    expect(a2).toBe('2026-07-22');
  });

  // ernie CODE-REVIEW re-review WARN residual (finding #2 / Refer-outs): the
  // widened bound (years = Math.max(every,4)*366+40) now covers every=1/2 leap-
  // day cases (regression-tested above) but a Feb-29 anchor with every>=3 still
  // has a leap-CYCLE (LCM(every,4)) that exceeds the bound — locks in the
  // CURRENT, ACCEPTED-SAFE behavior (null, not a wrong date and not a throw) so
  // a future bound-widening attempt that gets the math wrong (returns an
  // incorrect date instead of null, or throws) fails loud here rather than
  // silently drifting. Documented, non-blocking known gap — see CODE-REVIEW.md
  // finding #2 for the accepted-safe-degradation rationale (anchor stays
  // unchanged -> scheduler falls back to static recur_start; no corruption).
  test('KNOWN GAP (documented, non-blocking): yearly leap-day every>=3 exceeds the widened bound and safely returns null (not a wrong date)', () => {
    expect(computeNextOccurrenceAnchor('done', '2024-02-29', null, { type: 'interval', every: 3, unit: 'years' })).toBe(null);
    expect(computeNextOccurrenceAnchor('done', '2024-02-29', null, { type: 'interval', every: 5, unit: 'years' })).toBe(null);
    expect(computeNextOccurrenceAnchor('done', '2024-02-29', null, { type: 'interval', every: 6, unit: 'years' })).toBe(null);
  });
});
