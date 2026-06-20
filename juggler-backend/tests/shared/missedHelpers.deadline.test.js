/**
 * Tests for computeRecurringDeadline — the period-boundary deadline for a
 * recurring occurrence (juggler recurring-overdue-lifecycle, 2026-06-19).
 *
 * The deadline is the END of the recurrence PERIOD, not scheduled_at+timeFlex:
 *   - day-locked instance  → end of its occurrence day
 *   - flexible/TPC instance → end of the last day of the cycle it falls in
 *     (cycle anchored to recurStart + k*cycleDays).
 *
 * Assertions round-trip the UTC result back through utcToLocal so they are
 * timezone-robust (verify the local calendar day + that it lands at end-of-day),
 * rather than hand-computing UTC offsets.
 */
process.env.NODE_ENV = 'test';

var { computeRecurringDeadline } = require('../../../shared/scheduler/missedHelpers');
var dateHelpers = require('../../../shared/scheduler/dateHelpers');

var TZ = 'America/New_York';

// Local calendar day (YYYY-MM-DD) of a UTC deadline instant, in TZ.
function localDayOf(utcDate) {
  return dateHelpers.utcToLocal(utcDate, TZ).date;
}
// Local clock minutes-into-day of a UTC instant, in TZ.
function localMinsOf(utcDate) {
  return dateHelpers.parseTimeToMinutes(dateHelpers.utcToLocal(utcDate, TZ).time);
}

describe('computeRecurringDeadline — period boundary', function() {
  describe('day-locked', function() {
    test('deadline is the END of the occurrence day', function() {
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-04-26', isDayLocked: true, cycleDays: 7 },
        TZ
      );
      expect(d).toBeInstanceOf(Date);
      expect(localDayOf(d)).toBe('2026-06-24');
      // 11:59 PM local = 1439 minutes into the day
      expect(localMinsOf(d)).toBe(23 * 60 + 59);
    });

    test('isDayLocked overrides cycleDays (does not extend to cycle end)', function() {
      var locked = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-04-26', isDayLocked: true, cycleDays: 7 },
        TZ
      );
      var flexible = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      expect(localDayOf(locked)).toBe('2026-06-24');
      // flexible must extend PAST the occurrence day for this case
      expect(localDayOf(flexible) > localDayOf(locked)).toBe(true);
    });

    test('cycleDays<=1 (daily) behaves day-locked even when isDayLocked=false', function() {
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-06-01', isDayLocked: false, cycleDays: 1 },
        TZ
      );
      expect(localDayOf(d)).toBe('2026-06-24');
    });
  });

  describe('flexible / TPC — extends to cycle end', function() {
    // Anchor Sun 2026-04-26, weekly (cycleDays=7) → cycles are
    // [Apr26..May02], [May03..May09], … each Sun..Sat.
    // Occurrence Wed 2026-06-24 falls in cycle [Jun21..Jun27]; deadline = Jun27.
    test('weekly: deadline is the last day of the occurrence cycle', function() {
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      expect(localDayOf(d)).toBe('2026-06-27');
      expect(localMinsOf(d)).toBe(23 * 60 + 59);
    });

    test('two occurrences in the SAME cycle share one deadline', function() {
      // Mon Jun22 and Wed Jun24 are both in cycle [Jun21..Jun27].
      var a = computeRecurringDeadline(
        { occurrenceDate: '2026-06-22', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      var b = computeRecurringDeadline(
        { occurrenceDate: '2026-06-24', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      expect(localDayOf(a)).toBe('2026-06-27');
      expect(localDayOf(b)).toBe('2026-06-27');
      expect(a.getTime()).toBe(b.getTime());
    });

    test('occurrences in ADJACENT cycles get different deadlines', function() {
      // Jun27 (Sat) is end of cycle [Jun21..Jun27]; Jun28 (Sun) starts the next.
      var inCycle = computeRecurringDeadline(
        { occurrenceDate: '2026-06-27', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      var nextCycle = computeRecurringDeadline(
        { occurrenceDate: '2026-06-28', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      expect(localDayOf(inCycle)).toBe('2026-06-27');
      expect(localDayOf(nextCycle)).toBe('2026-07-04');
    });

    test('biweekly cycleDays=14', function() {
      // Anchor Apr26, occ May05 → cycle [Apr26..May09], deadline May09.
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-05-05', recurStart: '2026-04-26', isDayLocked: false, cycleDays: 14 },
        TZ
      );
      expect(localDayOf(d)).toBe('2026-05-09');
    });

    test('monthly cycleDays=30', function() {
      // Anchor Jun01, occ Jun10 → cycle [Jun01..Jun30], deadline Jun30.
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-06-10', recurStart: '2026-06-01', isDayLocked: false, cycleDays: 30 },
        TZ
      );
      expect(localDayOf(d)).toBe('2026-06-30');
    });

    test('recurStart absent → occurrence day is the cycle anchor', function() {
      // No anchor → cycle starts at the occurrence; deadline = occ + (cycleDays-1).
      var d = computeRecurringDeadline(
        { occurrenceDate: '2026-06-10', isDayLocked: false, cycleDays: 7 },
        TZ
      );
      expect(localDayOf(d)).toBe('2026-06-16');
    });
  });

  describe('guards', function() {
    test('missing occurrenceDate → null', function() {
      expect(computeRecurringDeadline({ isDayLocked: true, cycleDays: 7 }, TZ)).toBeNull();
      expect(computeRecurringDeadline({}, TZ)).toBeNull();
      expect(computeRecurringDeadline(null, TZ)).toBeNull();
    });
  });
});
