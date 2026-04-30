const {
  inferYear,
  parseDate,
  formatDateKey,
  isoToDateKey,
  toDateISO,
  fromDateISO,
  parseTimeToMinutes,
  toTime24,
  fromTime24,
  formatHour,
  getDayName,
  formatMinutesToTimeDb
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

    it('parses ISO YYYY-MM-DD', () => {
      const d = parseDate('2026-03-15');
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
    });

    it('parses ISO with time suffix', () => {
      const d = parseDate('2026-03-15T12:00:00Z');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
    });

    it('parses legacy M/D format (back-compat, year inferred)', () => {
      const d = parseDate('3/15');
      expect(d).toBeInstanceOf(Date);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
      expect(d.getFullYear()).toBe(inferYear(3));
    });

    it('accepts Date objects (idempotent)', () => {
      const in_ = new Date(2026, 2, 15);
      const out = parseDate(in_);
      expect(out.getFullYear()).toBe(2026);
      expect(out.getMonth()).toBe(2);
      expect(out.getDate()).toBe(15);
    });

    it('returns null for unparseable strings', () => {
      expect(parseDate('garbage')).toBeNull();
    });
  });

  describe('formatDateKey', () => {
    it('formats Date to ISO YYYY-MM-DD', () => {
      const d = new Date(2026, 2, 15);
      expect(formatDateKey(d)).toBe('2026-03-15');
    });

    it('zero-pads month and day', () => {
      const d = new Date(2026, 0, 5);
      expect(formatDateKey(d)).toBe('2026-01-05');
    });

    it('round-trips through parseDate', () => {
      const d = new Date(2026, 6, 4);
      expect(formatDateKey(parseDate(formatDateKey(d)))).toBe('2026-07-04');
    });
  });

  describe('toDateISO', () => {
    it('normalizes legacy M/D to YYYY-MM-DD', () => {
      const iso = toDateISO('3/5');
      expect(iso).toMatch(/^\d{4}-03-05$/);
    });

    it('passes ISO through unchanged', () => {
      expect(toDateISO('2026-03-05')).toBe('2026-03-05');
    });

    it('returns empty for falsy', () => {
      expect(toDateISO('')).toBe('');
      expect(toDateISO(null)).toBe('');
    });
  });

  describe('fromDateISO', () => {
    it('is a pass-through (ISO is canonical)', () => {
      expect(fromDateISO('2026-03-15')).toBe('2026-03-15');
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

  describe('isoToDateKey', () => {
    it('passes ISO YYYY-MM-DD through', () => {
      expect(isoToDateKey('2026-04-21')).toBe('2026-04-21');
      expect(isoToDateKey('2026-12-01')).toBe('2026-12-01');
    });

    it('strips ISO time suffix', () => {
      expect(isoToDateKey('2026-04-21T00:00:00.000Z')).toBe('2026-04-21');
      expect(isoToDateKey('2026-04-21 12:30:00')).toBe('2026-04-21');
    });

    it('converts legacy M/D to ISO (year inferred)', () => {
      const v = isoToDateKey('4/21');
      expect(v).toMatch(/^\d{4}-04-21$/);
    });

    it('accepts Date objects', () => {
      expect(isoToDateKey(new Date(2026, 3, 21))).toBe('2026-04-21');
    });

    it('returns null for null / empty / invalid', () => {
      expect(isoToDateKey(null)).toBeNull();
      expect(isoToDateKey(undefined)).toBeNull();
      expect(isoToDateKey('')).toBeNull();
      expect(isoToDateKey('garbage')).toBeNull();
      expect(isoToDateKey(new Date('invalid'))).toBeNull();
    });
  });

  describe('formatMinutesToTimeDb', () => {
    it('converts midnight (0) to 00:00:00', () => {
      expect(formatMinutesToTimeDb(0)).toBe('00:00:00');
    });
    it('converts 5:00 PM (1020) to 17:00:00', () => {
      expect(formatMinutesToTimeDb(1020)).toBe('17:00:00');
    });
    it('converts 11:30 AM (690) to 11:30:00', () => {
      expect(formatMinutesToTimeDb(690)).toBe('11:30:00');
    });
    it('converts noon (720) to 12:00:00', () => {
      expect(formatMinutesToTimeDb(720)).toBe('12:00:00');
    });
  });
});
