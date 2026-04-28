const crypto = require('crypto');

const { jugglerDateToISO, isoToJugglerDate, taskHash, withGCalRateLimit, callWithRateLimit } = require('../src/controllers/cal-sync-helpers');

// GCal event hash (from gcal.adapter.js) — inline for testing
function eventHash(event) {
  var startStr = event.start?.dateTime || event.start?.date || '';
  var endStr = event.end?.dateTime || event.end?.date || '';
  var str = [event.summary || '', startStr, endStr, event.description || ''].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

describe('cal-sync helpers', () => {
  describe('jugglerDateToISO', () => {
    it('converts date + time to ISO string', () => {
      const result = jugglerDateToISO('2026-03-15', '9:00 AM', 2026);
      expect(result).toBe('2026-03-15T09:00:00');
    });

    it('converts PM time correctly', () => {
      const result = jugglerDateToISO('2026-03-15', '2:30 PM', 2026);
      expect(result).toBe('2026-03-15T14:30:00');
    });

    it('defaults to 9:00 AM when no time', () => {
      const result = jugglerDateToISO('2026-03-15', null, 2026);
      expect(result).toBe('2026-03-15T09:00:00');
    });

    it('returns null for empty date', () => {
      expect(jugglerDateToISO(null, null, 2026)).toBeNull();
      expect(jugglerDateToISO('', null, 2026)).toBeNull();
    });
  });

  describe('isoToJugglerDate', () => {
    it('passes date-only ISO through with no time', () => {
      const result = isoToJugglerDate('2026-03-15');
      expect(result.date).toBe('2026-03-15');
      expect(result.time).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(isoToJugglerDate(null)).toEqual({ date: null, time: null });
      expect(isoToJugglerDate('')).toEqual({ date: null, time: null });
    });
  });

  describe('taskHash', () => {
    it('produces consistent hash for same input', () => {
      const task = { text: 'Test', date: '2026-03-15', time: '9:00 AM', dur: 30, status: '', when: 'morning', project: 'p1' };
      expect(taskHash(task)).toBe(taskHash(task));
    });

    it('changes when fields change', () => {
      const task1 = { text: 'Test', date: '2026-03-15', time: '9:00 AM', dur: 30, status: '', when: '', project: '' };
      const task2 = { ...task1, text: 'Changed' };
      expect(taskHash(task1)).not.toBe(taskHash(task2));
    });

    it('returns a 32-char hex string', () => {
      const h = taskHash({ text: 'x' });
      expect(h).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('eventHash (gcal)', () => {
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

  describe('rate limit helpers', () => {
    beforeEach(() => {
      jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('withGCalRateLimit', () => {
      it('returns the result of fn on success', async () => {
        const result = await withGCalRateLimit(() => Promise.resolve(42));
        expect(result).toBe(42);
      });

      it('retries once on a 429 error and returns the result', async () => {
        let calls = 0;
        const fn = jest.fn(() => {
          calls++;
          if (calls === 1) throw new Error('Request failed with status 429');
          return Promise.resolve('ok');
        });
        const result = await withGCalRateLimit(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('retries on "ratelimitexceeded" message', async () => {
        let calls = 0;
        const fn = jest.fn(() => {
          calls++;
          if (calls === 1) throw new Error('RateLimitExceeded quota');
          return Promise.resolve('ok');
        });
        const result = await withGCalRateLimit(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('throws immediately on a non-rate-limit error', async () => {
        const fn = jest.fn(() => { throw new Error('Not found'); });
        await expect(withGCalRateLimit(fn)).rejects.toThrow('Not found');
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('throws after exhausting 3 retries', async () => {
        const fn = jest.fn(() => { throw new Error('429 Too Many Requests'); });
        await expect(withGCalRateLimit(fn)).rejects.toThrow('429 Too Many Requests');
        expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      });
    });

    describe('callWithRateLimit', () => {
      it('retries on 429 when pid is gcal', async () => {
      let calls = 0;
      const fn = jest.fn(() => {
        calls++;
        if (calls === 1) throw new Error('429');
        return Promise.resolve('gcal-result');
      });
      const result = await callWithRateLimit('gcal', fn);
      expect(result).toBe('gcal-result');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 429 when pid is not gcal', async () => {
      const fn = jest.fn(() => Promise.reject(new Error('429')));
      await expect(callWithRateLimit('apple', fn)).rejects.toThrow('429');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls fn directly and returns result for non-gcal provider', async () => {
      const fn = jest.fn(() => Promise.resolve('msft-result'));
      const result = await callWithRateLimit('msft', fn);
      expect(result).toBe('msft-result');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    });
  });
});
