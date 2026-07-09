/**
 * FR-3 (SPEC.md — juggler-recur-lifecycle-redesign) — Future-day completion carve-out
 *
 * Requirements covered: FR-3 / Acceptance Criterion 4
 *   ".planning/kermit/juggler-recur-lifecycle-redesign/SPEC.md" AC4:
 *   "Marking a future-dated instance `done` succeeds for `recur.type==='rolling'` masters
 *   and is still blocked (existing behavior, unchanged) for all other recur types."
 *
 * Shipped behavior (docs/architecture/TASK-STATE-MATRIX.md:295-303, enforced in
 * juggler-frontend/src/components/layout/AppLayout.jsx handleStatusChange, lines 803-817,
 * via the extracted src/utils/futureCompletionGuard.js#evaluateFutureCompletionGuard):
 *   - Guard fires when task.recurring && task.taskType === 'recurring_instance'.
 *   - taskDateKey = formatDateKey(parseDate(task.date)); nowDayKey = formatDateKey(today).
 *   - if (taskDateKey && taskDateKey > nowDayKey) AND recur.type !== 'rolling' -> BLOCKED,
 *     warning toast shown, return. rolling masters are exempt from the future-day block.
 *
 * Layer: unit — imports the REAL guard predicate (evaluateFutureCompletionGuard), not a
 * mirror, so this test can never drift from production (W3 extraction, per telly's
 * TELLY-W3-REVIEW.md INFO finding + the buildServerClock precedent in this same
 * __tests__ dir's serverClock.ac3.test.js). AppLayout.jsx itself is not rendered —
 * it pulls in useTaskState/useConfig/useAuth/useTimezone/apiClient/useWeather/etc and is
 * impractical to mount for a single conditional branch.
 */

import { evaluateFutureCompletionGuard as mirrorFutureCompletionGuard } from '../../../utils/futureCompletionGuard';
import { formatDateKey } from '../../../scheduler/dateHelpers';

function makeRecurringInstance(recurType, dateKey) {
  return {
    id: 'ti-fr3-1',
    text: 'Water plants',
    recurring: true,
    taskType: 'recurring_instance',
    date: dateKey,
    recur: { type: recurType }
  };
}

var TODAY = new Date(2026, 6, 9); // 2026-07-09 local midnight (today, per project context)
var TODAY_KEY = formatDateKey(TODAY); // '2026-07-09'
var FUTURE_KEY = '2026-07-15';
var PAST_KEY = '2026-07-01';

var PATTERN_TYPES = ['daily', 'weekly', 'monthly', 'interval', 'biweekly'];
var ALL_TYPES = PATTERN_TYPES.concat(['rolling']);

describe('FR-3 (SPEC AC4): future-day completion guard — pattern types UNCHANGED', () => {
  test.each(PATTERN_TYPES)(
    'AC4-pattern-blocked-%s: future-dated done is still BLOCKED for recur.type=%s',
    (recurType) => {
      var task = makeRecurringInstance(recurType, FUTURE_KEY);
      var result = mirrorFutureCompletionGuard(task, TODAY);
      expect(result.blocked).toBe(true);
      expect(result.warning).toBe(
        'Can\'t mark a future recurring task as done — skip or cancel it instead'
      );
    }
  );
});

describe('FR-3 (SPEC AC4): future-day completion carve-out — rolling NEW behavior', () => {
  test('AC4-rolling-allowed: future-dated done is ALLOWED for recur.type=rolling (expected RED pre-W3)', () => {
    var task = makeRecurringInstance('rolling', FUTURE_KEY);
    var result = mirrorFutureCompletionGuard(task, TODAY);
    // SPEC FR-3: rolling masters may complete a future-dated instance early
    // (real use case: wash the car ahead of schedule). No block, no warning.
    expect(result.blocked).toBe(false);
    expect(result.warning).toBeNull();
  });
});

describe('FR-3 (SPEC AC4): same-day / past-day completion regression — unchanged for ALL types', () => {
  test.each(ALL_TYPES)(
    'AC4-today-allowed-%s: same-day completion remains allowed for recur.type=%s',
    (recurType) => {
      var task = makeRecurringInstance(recurType, TODAY_KEY);
      var result = mirrorFutureCompletionGuard(task, TODAY);
      expect(result.blocked).toBe(false);
    }
  );

  test.each(ALL_TYPES)(
    'AC4-past-allowed-%s: past-day (overdue) completion remains allowed for recur.type=%s',
    (recurType) => {
      var task = makeRecurringInstance(recurType, PAST_KEY);
      var result = mirrorFutureCompletionGuard(task, TODAY);
      expect(result.blocked).toBe(false);
    }
  );
});
