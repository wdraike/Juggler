/**
 * 999.1110 (David 2026-07-04) / R5 ruling (2026-07-19) — "Next Cycle Starts"
 * anchor edit validation.
 *
 * `resolveNextStartAnchor(body, existing)` is the server-side authority for
 * the editable recurrence anchor: rolling recur types accept any date
 * verbatim; pattern-recur types (daily/weekly/biweekly/monthly/interval) are
 * snapped forward to the next date the master's own recur pattern allows,
 * via the SAME `nextMatchingDate` forward-search next-occurrence-anchor.js's
 * terminal-event path uses (shared/scheduler/expandRecurring.js) — mirroring
 * TaskEditForm's client-side snap (juggler-frontend/src/components/tasks/
 * TaskEditForm.jsx handleNextStartChange) byte-for-byte.
 *
 * `resolveNextStartAnchor` is PURE (only shared/scheduler/* deps — see
 * taskValidation.js module header) — direct unit test, no DB.
 */

'use strict';

const { resolveNextStartAnchor } = require('../../../../src/slices/task/domain/validation/taskValidation');
const { nextMatchingDate } = require('../../../../../shared/scheduler/expandRecurring');

describe('resolveNextStartAnchor — 999.1110 anchor edit validation', () => {
  test('RED->GREEN: weekly Monday-only pattern, chosen date already a Monday → returned unchanged, no error', () => {
    var body = { nextStart: '2026-07-20' }; // a Monday
    var existing = { recur: JSON.stringify({ type: 'weekly', days: 'M' }), recur_start: '2026-01-05', next_start: '2026-07-13' };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe('2026-07-20');
  });

  test('weekly Monday-only pattern, chosen date is a Wednesday → SNAPPED forward to the next Monday, not rejected', () => {
    var body = { nextStart: '2026-07-22' }; // Wednesday
    var existing = { recur: JSON.stringify({ type: 'weekly', days: 'M' }), recur_start: '2026-01-05', next_start: '2026-07-13' };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe('2026-07-27'); // next Monday after 07-22
  });

  test('monthly {11,22} pattern, chosen date=15 (not in the list) → snapped to the 22nd', () => {
    var body = { nextStart: '2026-07-15' };
    var existing = { recur: JSON.stringify({ type: 'monthly', monthDays: [11, 22] }), recur_start: '2026-01-11', next_start: null };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe('2026-07-22');
  });

  test('rolling recur type: ANY chosen date is accepted verbatim, no snapping (R5)', () => {
    var body = { nextStart: '2026-07-22' }; // arbitrary Wednesday
    var existing = { recur: JSON.stringify({ type: 'rolling', every: 7, unit: 'days' }), recur_start: null, next_start: '2026-07-01' };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe('2026-07-22');
  });

  test('no active recurrence (recur.type=none / missing) → error, do NOT accept an arbitrary date', () => {
    var body = { nextStart: '2026-07-22' };
    var existing = { recur: null, recur_start: null, next_start: null };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.value).toBeNull();
    expect(out.error).toMatch(/active recurrence/);
  });

  test('body.recur (same-request recur-type change) takes precedence over existing.recur', () => {
    // existing is weekly-Monday; the SAME request also switches recur to
    // weekly-Wednesday — the anchor must validate against the NEW pattern.
    var body = { nextStart: '2026-07-22', recur: { type: 'weekly', days: 'W' } }; // Wednesday
    var existing = { recur: JSON.stringify({ type: 'weekly', days: 'M' }), recur_start: '2026-01-05', next_start: '2026-07-13' };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe('2026-07-22'); // matches the NEW Wednesday pattern already
  });

  test('unparseable chosen date → error', () => {
    var body = { nextStart: 'not-a-date' };
    var existing = { recur: JSON.stringify({ type: 'weekly', days: 'M' }), recur_start: '2026-01-05', next_start: null };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.value).toBeNull();
    expect(out.error).toMatch(/valid date/);
  });

  // harrison review (2026-07-19): combined-edit client/server snap divergence.
  // When existing.next_start is NOT yet set and the SAME request also edits
  // recurStart, the phase anchor for biweekly parity must be the INCOMING
  // body.recurStart (matching TaskEditForm's handleNextStartChange, which
  // reads its own freshly-typed `recurStart` React state), not the stale
  // existing.recur_start — otherwise client and server can snap to DIFFERENT
  // dates for the identical save.
  test('combined edit: next_start unset + SAME-request recurStart change phase-references the INCOMING recurStart, not the stale existing one', () => {
    var recur = { type: 'biweekly', days: 'M' };
    var oldRecurStart = '2026-01-05'; // Monday — old parity chain
    var newRecurStart = '2026-01-12'; // Monday, ONE WEEK later — shifts parity by 7 days
    var chosen = '2026-07-20'; // a Monday

    // Sanity: the two phase references must actually disagree for this fixture
    // (otherwise the test doesn't distinguish the two code paths at all).
    var viaOld = nextMatchingDate(recur, '2026-07-19', oldRecurStart);
    var viaNew = nextMatchingDate(recur, '2026-07-19', newRecurStart);
    expect(viaOld).not.toBe(viaNew);

    var body = { nextStart: chosen, recurStart: newRecurStart };
    var existing = { recur: JSON.stringify(recur), recur_start: oldRecurStart, next_start: null };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    expect(out.value).toBe(viaNew);
    expect(out.value).not.toBe(viaOld);
  });

  test('combined edit: existing next_start (already set) still wins over an incoming recurStart change (no divergence risk in this branch)', () => {
    var recur = { type: 'biweekly', days: 'M' };
    var body = { nextStart: '2026-07-20', recurStart: '2026-01-12' };
    var existing = { recur: JSON.stringify(recur), recur_start: '2026-01-05', next_start: '2026-07-06' };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.error).toBeNull();
    var viaExistingNextStart = nextMatchingDate(recur, '2026-07-19', '2026-07-06');
    expect(out.value).toBe(viaExistingNextStart);
  });

  // David's 999.1567 ruling (contract over leniency): a genuinely unmatchable
  // recur config (nextMatchingDate's bounded forward walk finds NOTHING) is a
  // hard 400, not a silent accept. This is DISTINCT from an ordinary pattern
  // MISMATCH (a valid pattern the chosen date just doesn't land on), which
  // still snaps — see the weekly/monthly snap tests above.
  test('genuinely unmatchable recur config (impossible monthDays) → 400, not a silent accept', () => {
    var body = { nextStart: '2026-07-22' };
    // day 31 does not exist in every month within nextMatchingDate's bounded
    // walk from a Feb start — but to force a TRUE no-match within the bound,
    // use an invalid/empty monthDays list the predicate can never satisfy.
    var existing = { recur: JSON.stringify({ type: 'monthly', monthDays: [] }), recur_start: '2026-01-01', next_start: null };
    var out = resolveNextStartAnchor(body, existing);
    expect(out.value).toBeNull();
    expect(out.error).toMatch(/does not match/);
  });
});
