/**
 * Regression tests for shared/scheduler/dateMatchesRecurrence.js (999.1184).
 *
 * The function is a thin wrapper over expandRecurring's matchesRecurrenceDay —
 * the SSOT match predicate (999.1091 C1). A previous standalone copy had
 * drifted: object-form `days` specs (e.g. {M:'required',W:'optional'}) matched
 * NOTHING, and biweekly parity came from a private reimplementation. These
 * tests pin the delegation (incl. the drift cases) and the preserved
 * string-days/monthly/interval behavior.
 */
process.env.NODE_ENV = 'test';

var { dateMatchesRecurrence } = require('../../../shared/scheduler/dateMatchesRecurrence');
var expandRecurring = require('../../../shared/scheduler/expandRecurring');
var dateHelpers = require('../../../shared/scheduler/dateHelpers');
var parseDate = dateHelpers.parseDate;

// 2026-06-01 is a Monday.
var ANCHOR = '2026-06-01';

describe('dateMatchesRecurrence — thin wrapper over matchesRecurrenceDay (999.1184)', function() {

  describe('object-form days spec (the drift: previously matched NOTHING)', function() {
    var recur = { type: 'weekly', days: { M: 'required', W: 'optional' } };

    test('matches a required day', function() {
      expect(dateMatchesRecurrence('2026-06-01', recur, ANCHOR, parseDate)).toBe(true); // Mon
      expect(dateMatchesRecurrence('2026-06-08', recur, ANCHOR, parseDate)).toBe(true); // next Mon
    });

    test('matches an optional day', function() {
      expect(dateMatchesRecurrence('2026-06-03', recur, ANCHOR, parseDate)).toBe(true); // Wed
    });

    test('does not match an unselected day', function() {
      expect(dateMatchesRecurrence('2026-06-02', recur, ANCHOR, parseDate)).toBe(false); // Tue
    });
  });

  describe('biweekly parity (anchor-derived, same as the expansion)', function() {
    var recur = { type: 'biweekly', days: 'M' };

    test('on-parity weeks match, off-parity weeks do not', function() {
      expect(dateMatchesRecurrence('2026-06-01', recur, ANCHOR, parseDate)).toBe(true);  // week 0
      expect(dateMatchesRecurrence('2026-06-08', recur, ANCHOR, parseDate)).toBe(false); // week 1
      expect(dateMatchesRecurrence('2026-06-15', recur, ANCHOR, parseDate)).toBe(true);  // week 2
    });

    test('biweekly with OBJECT days spec honors both day-match and parity', function() {
      var objRecur = { type: 'biweekly', days: { M: 'required' } };
      expect(dateMatchesRecurrence('2026-06-15', objRecur, ANCHOR, parseDate)).toBe(true);
      expect(dateMatchesRecurrence('2026-06-08', objRecur, ANCHOR, parseDate)).toBe(false); // wrong parity
      expect(dateMatchesRecurrence('2026-06-16', objRecur, ANCHOR, parseDate)).toBe(false); // wrong day
    });

    test('agrees with matchesRecurrenceDay for every day of a 4-week span', function() {
      var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
      var anchor = parseDate(ANCHOR);
      for (var i = 0; i < 28; i++) {
        var d = new Date(anchor.getTime());
        d.setDate(d.getDate() + i);
        var key = dateHelpers.formatDateKey(d);
        expect(dateMatchesRecurrence(key, recur, ANCHOR, parseDate))
          .toBe(expandRecurring.matchesRecurrenceDay(d, recur, anchor, dayMap));
      }
    });
  });

  describe('preserved behavior (string days / monthly / interval / guards)', function() {
    test('weekly string days', function() {
      var recur = { type: 'weekly', days: 'MWF' };
      expect(dateMatchesRecurrence('2026-06-03', recur, ANCHOR, parseDate)).toBe(true);  // Wed
      expect(dateMatchesRecurrence('2026-06-04', recur, ANCHOR, parseDate)).toBe(false); // Thu
    });

    test('daily matches any date on/after the source', function() {
      expect(dateMatchesRecurrence('2026-06-19', { type: 'daily' }, ANCHOR, parseDate)).toBe(true);
    });

    test('monthly monthDays incl. first/last', function() {
      var recur = { type: 'monthly', monthDays: ['first', 15, 'last'] };
      expect(dateMatchesRecurrence('2026-07-01', recur, ANCHOR, parseDate)).toBe(true);
      expect(dateMatchesRecurrence('2026-06-15', recur, ANCHOR, parseDate)).toBe(true);
      expect(dateMatchesRecurrence('2026-06-30', recur, ANCHOR, parseDate)).toBe(true);  // last of June
      expect(dateMatchesRecurrence('2026-06-29', recur, ANCHOR, parseDate)).toBe(false);
    });

    test('interval every-3-days counts from the source date', function() {
      var recur = { type: 'interval', every: 3, unit: 'days' };
      expect(dateMatchesRecurrence('2026-06-04', recur, ANCHOR, parseDate)).toBe(true);
      expect(dateMatchesRecurrence('2026-06-05', recur, ANCHOR, parseDate)).toBe(false);
      expect(dateMatchesRecurrence('2026-06-07', recur, ANCHOR, parseDate)).toBe(true);
    });

    test('date before the source never matches', function() {
      expect(dateMatchesRecurrence('2026-05-25', { type: 'daily' }, ANCHOR, parseDate)).toBe(false);
    });

    test('guards: no recur / type none / missing dates / rolling → false', function() {
      expect(dateMatchesRecurrence('2026-06-01', null, ANCHOR, parseDate)).toBe(false);
      expect(dateMatchesRecurrence('2026-06-01', { type: 'none' }, ANCHOR, parseDate)).toBe(false);
      expect(dateMatchesRecurrence(null, { type: 'daily' }, ANCHOR, parseDate)).toBe(false);
      expect(dateMatchesRecurrence('2026-06-01', { type: 'daily' }, null, parseDate)).toBe(false);
      expect(dateMatchesRecurrence('2026-06-01', { type: 'rolling' }, ANCHOR, parseDate)).toBe(false);
    });
  });
});
