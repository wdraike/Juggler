const {
  inferYear,
  parseDate,
  formatDateKey,
  toDateISO,
  fromDateISO,
  parseTimeToMinutes,
  toTime24,
  fromTime24,
  formatHour,
  getDayName
} = require('../src/scheduler/dateHelpers');

describe('dateHelpers', () => {
  describe('inferYear', () => {
    it('returns current year for current month', () => {
      const now = new Date();
      expect(inferYear(now.getMonth() + 1)).toBe(now.getFullYear());
    });

    it('returns next year for month >6 months behind current', () => {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      // If current month is August (8), month 1 (Jan) is 7 months behind → next year
      if (currentMonth > 7) {
        expect(inferYear(1)).toBe(now.getFullYear() + 1);
      }
    });

    it('returns current year for month within 6 months', () => {
      const now = new Date();
      expect(inferYear(now.getMonth() + 1)).toBe(now.getFullYear());
    });
  });

  describe('parseDate', () => {
    it('returns null for TBD', () => {
      expect(parseDate('TBD')).toBeNull();
    });

    it('returns null for empty/falsy', () => {
      expect(parseDate('')).toBeNull();
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
    });

    it('parses M/D format correctly', () => {
      const d = parseDate('3/15');
      expect(d).toBeInstanceOf(Date);
      expect(d.getMonth()).toBe(2); // March = 2
      expect(d.getDate()).toBe(15);
    });

    it('uses dynamic year, not hardcoded 2026', () => {
      const d = parseDate('3/15');
      const expectedYear = inferYear(3);
      expect(d.getFullYear()).toBe(expectedYear);
    });
  });

  describe('formatDateKey', () => {
    it('formats Date to M/D string', () => {
      const d = new Date(2026, 2, 15); // March 15
      expect(formatDateKey(d)).toBe('3/15');
    });

    it('does not zero-pad', () => {
      const d = new Date(2026, 0, 5); // Jan 5
      expect(formatDateKey(d)).toBe('1/5');
    });
  });

  describe('toDateISO', () => {
    it('converts M/D to YYYY-MM-DD', () => {
      const iso = toDateISO('3/5');
      expect(iso).toMatch(/^\d{4}-03-05$/);
    });

    it('returns empty for falsy', () => {
      expect(toDateISO('')).toBe('');
      expect(toDateISO(null)).toBe('');
    });

    it('uses dynamic year', () => {
      const iso = toDateISO('3/15');
      expect(iso).not.toContain('undefined');
      expect(iso).toMatch(/^\d{4}-03-15$/);
    });
  });

  describe('fromDateISO', () => {
    it('converts YYYY-MM-DD to M/D', () => {
      expect(fromDateISO('2026-03-15')).toBe('3/15');
      expect(fromDateISO('2026-01-05')).toBe('1/5');
    });

    it('returns empty for falsy', () => {
      expect(fromDateISO('')).toBe('');
    });
  });

  describe('parseTimeToMinutes', () => {
    it('parses 12-hour time with AM/PM', () => {
      expect(parseTimeToMinutes('9:00 AM')).toBe(540);
      expect(parseTimeToMinutes('12:00 PM')).toBe(720);
      expect(parseTimeToMinutes('12:00 AM')).toBe(0);
      expect(parseTimeToMinutes('1:30 PM')).toBe(810);
    });

    it('handles lowercase am/pm', () => {
      expect(parseTimeToMinutes('9:00 am')).toBe(540);
      expect(parseTimeToMinutes('5:00 pm')).toBe(1020);
    });

    it('handles shorthand a/p', () => {
      expect(parseTimeToMinutes('9:00a')).toBe(540);
      expect(parseTimeToMinutes('5:00p')).toBe(1020);
    });

    it('returns null for empty/null', () => {
      expect(parseTimeToMinutes('')).toBeNull();
      expect(parseTimeToMinutes(null)).toBeNull();
    });

    it('parses range format (H:MM -)', () => {
      expect(parseTimeToMinutes('9:00 - 10:00')).toBe(540);
      expect(parseTimeToMinutes('2:00 - 3:00')).toBe(840); // 2 PM (1-5 → +12)
    });
  });

  describe('toTime24 / fromTime24', () => {
    it('converts 12h to 24h', () => {
      expect(toTime24('9:00 AM')).toBe('09:00');
      expect(toTime24('12:00 PM')).toBe('12:00');
      expect(toTime24('12:00 AM')).toBe('00:00');
      expect(toTime24('5:30 PM')).toBe('17:30');
    });

    it('converts 24h to 12h', () => {
      expect(fromTime24('09:00')).toBe('9:00 AM');
      expect(fromTime24('17:30')).toBe('5:30 PM');
      expect(fromTime24('00:00')).toBe('12:00 AM');
      expect(fromTime24('12:00')).toBe('12:00 PM');
    });
  });

  describe('formatHour', () => {
    it('formats hours correctly', () => {
      expect(formatHour(0)).toBe('12 AM');
      expect(formatHour(6)).toBe('6 AM');
      expect(formatHour(12)).toBe('12 PM');
      expect(formatHour(18)).toBe('6 PM');
    });
  });
});
