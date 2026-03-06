const crypto = require('crypto');

// Mock db and gcal-api so the module loads without DB
jest.mock('../src/db', () => {
  const mock = () => mock;
  mock.fn = { now: () => 'MOCK_NOW' };
  mock.raw = (s) => s;
  return mock;
});
jest.mock('../src/lib/gcal-api', () => ({}));
jest.mock('../src/scheduler/runSchedule', () => ({}));

const { jugglerDateToISO, isoToJugglerDate, taskHash, eventHash } = require('../src/controllers/gcal.controller');

describe('gcal helpers', () => {
  describe('jugglerDateToISO', () => {
    it('converts date + time to ISO string', () => {
      const result = jugglerDateToISO('3/15', '9:00 AM', 2026);
      expect(result).toBe('2026-03-15T09:00:00');
    });

    it('converts PM time correctly', () => {
      const result = jugglerDateToISO('3/15', '2:30 PM', 2026);
      expect(result).toBe('2026-03-15T14:30:00');
    });

    it('defaults to 9:00 AM when no time', () => {
      const result = jugglerDateToISO('3/15', null, 2026);
      expect(result).toBe('2026-03-15T09:00:00');
    });

    it('returns null for empty date', () => {
      expect(jugglerDateToISO(null, null, 2026)).toBeNull();
      expect(jugglerDateToISO('', null, 2026)).toBeNull();
    });
  });

  describe('isoToJugglerDate', () => {
    it('converts date-only ISO to M/D with no time', () => {
      const result = isoToJugglerDate('2026-03-15');
      expect(result.date).toBe('3/15');
      expect(result.time).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(isoToJugglerDate(null)).toEqual({ date: null, time: null });
      expect(isoToJugglerDate('')).toEqual({ date: null, time: null });
    });
  });

  describe('taskHash', () => {
    it('produces consistent hash for same input', () => {
      const task = { text: 'Test', date: '3/15', time: '9:00 AM', dur: 30, status: '', when: 'morning', project: 'p1' };
      expect(taskHash(task)).toBe(taskHash(task));
    });

    it('changes when fields change', () => {
      const task1 = { text: 'Test', date: '3/15', time: '9:00 AM', dur: 30, status: '', when: '', project: '' };
      const task2 = { ...task1, text: 'Changed' };
      expect(taskHash(task1)).not.toBe(taskHash(task2));
    });

    it('returns a 32-char hex string', () => {
      const h = taskHash({ text: 'x' });
      expect(h).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('eventHash', () => {
    it('produces consistent hash', () => {
      const event = { summary: 'Test', start: { dateTime: '2026-03-15T09:00:00' }, end: { dateTime: '2026-03-15T10:00:00' }, description: '' };
      expect(eventHash(event)).toBe(eventHash(event));
    });

    it('changes when fields change', () => {
      const e1 = { summary: 'A', start: {}, end: {} };
      const e2 = { summary: 'B', start: {}, end: {} };
      expect(eventHash(e1)).not.toBe(eventHash(e2));
    });
  });
});
