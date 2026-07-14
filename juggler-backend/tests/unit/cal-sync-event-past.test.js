/**
 * 999.1605 — GCal pull sync missed an existing all-day event.
 *
 * Root cause: all-day provider events carry DATE-ONLY startDateTime strings
 * ("2026-07-14"). `new Date('YYYY-MM-DD')` parses as UTC midnight, which lands
 * BEFORE the user's local todayStart in negative-offset timezones (e.g.
 * America/New_York, todayStart = 04:00Z) — so an all-day event happening
 * TODAY was classified as past, given a task_id-NULL "past skip" ledger row,
 * and then permanently re-skipped on every subsequent sync.
 *
 * isEventPast       — corrected classification (calendar-date compare for
 *                     all-day, timestamp compare for timed).
 * isStalePastSkipRow — healing predicate: an all-day past-skip ledger row
 *                     whose date is today-or-later can only exist via the
 *                     misclassification (real past rows only age further into
 *                     the past), so it is safe to delete and re-ingest.
 */

var { isEventPast, isStalePastSkipRow } = require('../../src/controllers/cal-sync-helpers');

// Fixed clock: user tz America/New_York (UTC-4 in July).
var TODAY_KEY = '2026-07-14';
var TODAY_START = new Date('2026-07-14T04:00:00.000Z'); // local midnight Jul 14 NY

describe('isEventPast (999.1605)', () => {
  test('all-day event TODAY (date-only string) is NOT past — the bug case', () => {
    expect(isEventPast('2026-07-14', true, TODAY_KEY, TODAY_START)).toBe(false);
  });

  test('all-day event yesterday is past', () => {
    expect(isEventPast('2026-07-13', true, TODAY_KEY, TODAY_START)).toBe(true);
  });

  test('all-day event tomorrow is not past', () => {
    expect(isEventPast('2026-07-15', true, TODAY_KEY, TODAY_START)).toBe(false);
  });

  test('all-day event today with full ISO midnight-UTC start is NOT past', () => {
    // Some providers hand all-day starts as midnight-UTC ISO strings.
    expect(isEventPast('2026-07-14T00:00:00.000Z', true, TODAY_KEY, TODAY_START)).toBe(false);
  });

  test('timed event earlier today (after local midnight) is not past', () => {
    // 09:00 NY = 13:00Z
    expect(isEventPast('2026-07-14T13:00:00.000Z', false, TODAY_KEY, TODAY_START)).toBe(false);
  });

  test('timed event yesterday evening local is past', () => {
    // 18:00 NY Jul 13 = 22:00Z Jul 13 < todayStart 04:00Z Jul 14
    expect(isEventPast('2026-07-13T22:00:00.000Z', false, TODAY_KEY, TODAY_START)).toBe(true);
  });

  test('missing start is never past', () => {
    expect(isEventPast('', false, TODAY_KEY, TODAY_START)).toBe(false);
    expect(isEventPast(null, true, TODAY_KEY, TODAY_START)).toBe(false);
  });
});

describe('isStalePastSkipRow (999.1605 healing)', () => {
  // The exact shape Phase 3b writes for a past-skipped event: task_id NULL,
  // no push hashes, status active.
  function skipRow(overrides) {
    return Object.assign({
      id: 42,
      task_id: null,
      last_pushed_hash: null,
      last_user_hash: null,
      status: 'active',
      event_all_day: 1,
      event_start: '2026-07-14'
    }, overrides);
  }

  test('all-day skip row dated today is stale (misclassified) — heal it', () => {
    expect(isStalePastSkipRow(skipRow({}), TODAY_KEY)).toBe(true);
  });

  test('all-day skip row dated in the future is stale — heal it', () => {
    expect(isStalePastSkipRow(skipRow({ event_start: '2026-07-20' }), TODAY_KEY)).toBe(true);
  });

  test('all-day skip row genuinely past is kept', () => {
    expect(isStalePastSkipRow(skipRow({ event_start: '2026-07-10' }), TODAY_KEY)).toBe(false);
  });

  test('row linked to a task is never healed', () => {
    expect(isStalePastSkipRow(skipRow({ task_id: 't123' }), TODAY_KEY)).toBe(false);
  });

  test('row with push history is never healed', () => {
    expect(isStalePastSkipRow(skipRow({ last_pushed_hash: 'abc' }), TODAY_KEY)).toBe(false);
    expect(isStalePastSkipRow(skipRow({ last_user_hash: 'abc' }), TODAY_KEY)).toBe(false);
  });

  test('non-active (e.g. deleted_local) rows are never healed', () => {
    expect(isStalePastSkipRow(skipRow({ status: 'deleted_local' }), TODAY_KEY)).toBe(false);
  });

  test('timed rows are never healed (they were never misclassified)', () => {
    expect(isStalePastSkipRow(skipRow({ event_all_day: 0, event_start: '2026-07-14T13:00:00.000Z' }), TODAY_KEY)).toBe(false);
  });

  test('row without event_start is never healed', () => {
    expect(isStalePastSkipRow(skipRow({ event_start: null }), TODAY_KEY)).toBe(false);
  });
});
