const {
  buildWindowsFromBlocks,
  getWhenWindows,
  parseWhen,
  hasWhen,
  getBlockAtMinute,
  getBlocksForDate,
  getBlocksForDay,
  cloneBlocks
} = require('../src/scheduler/timeBlockHelpers');

const SAMPLE_BLOCKS = [
  { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480 },
  { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720 },
  { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780 },
  { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020 },
  { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260 }
];

describe('timeBlockHelpers', () => {
  describe('buildWindowsFromBlocks', () => {
    it('creates tag-based windows', () => {
      const w = buildWindowsFromBlocks(SAMPLE_BLOCKS);
      expect(w.morning).toEqual([[360, 480]]);
      expect(w.biz).toEqual([[480, 720], [780, 1020]]);
      expect(w.lunch).toEqual([[720, 780]]);
      expect(w.evening).toEqual([[1020, 1260]]);
    });

    it('creates anytime spanning all blocks', () => {
      const w = buildWindowsFromBlocks(SAMPLE_BLOCKS);
      expect(w.anytime.length).toBe(5);
    });

    it('returns default when empty', () => {
      const w = buildWindowsFromBlocks([]);
      expect(w.anytime).toEqual([[360, 1380]]);
    });
  });

  describe('parseWhen', () => {
    it('parses comma-separated tags', () => {
      expect(parseWhen('morning,evening')).toEqual(['morning', 'evening']);
    });

    it('returns anytime for empty/null', () => {
      expect(parseWhen('')).toEqual(['anytime']);
      expect(parseWhen(null)).toEqual(['anytime']);
      expect(parseWhen('anytime')).toEqual(['anytime']);
    });
  });

  describe('hasWhen', () => {
    it('checks if tag is in when string', () => {
      expect(hasWhen('morning,evening', 'morning')).toBe(true);
      expect(hasWhen('morning,evening', 'biz')).toBe(false);
      expect(hasWhen('fixed', 'fixed')).toBe(true);
    });
  });

  describe('getWhenWindows', () => {
    it('returns windows for specific tags', () => {
      const w = buildWindowsFromBlocks(SAMPLE_BLOCKS);
      const wins = getWhenWindows('morning', w);
      expect(wins).toEqual([[360, 480]]);
    });

    it('falls back to anytime for null/empty', () => {
      const w = buildWindowsFromBlocks(SAMPLE_BLOCKS);
      const wins = getWhenWindows(null, w);
      expect(wins.length).toBe(5);
    });

    it('returns empty for non-matching explicit tag', () => {
      const w = buildWindowsFromBlocks(SAMPLE_BLOCKS);
      const wins = getWhenWindows('nonexistent', w);
      expect(wins).toEqual([]);
    });
  });

  describe('getBlockAtMinute', () => {
    it('finds block at given minute', () => {
      expect(getBlockAtMinute(SAMPLE_BLOCKS, 400).tag).toBe('morning');
      expect(getBlockAtMinute(SAMPLE_BLOCKS, 500).tag).toBe('biz');
      expect(getBlockAtMinute(SAMPLE_BLOCKS, 750).tag).toBe('lunch');
    });

    it('returns null outside blocks', () => {
      expect(getBlockAtMinute(SAMPLE_BLOCKS, 100)).toBeNull();
      expect(getBlockAtMinute(SAMPLE_BLOCKS, 1400)).toBeNull();
    });
  });

  describe('getBlocksForDay', () => {
    it('returns blocks for given day name', () => {
      const map = { Mon: SAMPLE_BLOCKS, Sat: [] };
      expect(getBlocksForDay('Mon', map)).toBe(SAMPLE_BLOCKS);
      expect(getBlocksForDay('Sat', map)).toEqual([]);
    });

    it('returns empty array for unknown day', () => {
      expect(getBlocksForDay('Xyz', {})).toEqual([]);
    });
  });

  describe('cloneBlocks', () => {
    it('creates new objects with unique ids', () => {
      const cloned = cloneBlocks(SAMPLE_BLOCKS);
      expect(cloned.length).toBe(SAMPLE_BLOCKS.length);
      cloned.forEach((b, i) => {
        expect(b.id).not.toBe(SAMPLE_BLOCKS[i].id);
        expect(b.tag).toBe(SAMPLE_BLOCKS[i].tag);
        expect(b.start).toBe(SAMPLE_BLOCKS[i].start);
      });
    });
  });
});
