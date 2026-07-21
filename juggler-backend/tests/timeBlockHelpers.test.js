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

  // 999.2146 — getBlocksForDate's cfg-based template-override resolution
  // (SUB-207a semantics): a dated override that resolves to a KNOWN
  // templateId returns that template's blocks; one that references an
  // UNKNOWN templateId (a dangling ref — e.g. a pre-existing bad row from
  // before the 999.2144 write-side guard, or a since-deleted non-system
  // custom template) must fall through to the day-of-week blocksMap
  // instead of producing a zero-capacity day, AND emit a log warning (the
  // warning is the part that was missing — the fallback itself already
  // worked).
  describe('getBlocksForDate — cfg.scheduleTemplates override resolution (999.2146)', () => {
    var SCHED_TEMPLATES = {
      weekday: { name: 'Weekday', blocks: [{ id: 'w1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' }] }
    };
    var LEGACY_MON_BLOCKS = [{ id: 'mon1', tag: 'morning', name: 'Morning', start: 360, end: 480 }];

    it('valid override templateId -> returns that template\'s blocks', () => {
      var cfg = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: { '2026-07-20': 'weekday' } };
      var blocks = getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfg);
      expect(blocks).toBe(SCHED_TEMPLATES.weekday.blocks);
    });

    it('UNKNOWN override templateId -> falls through to day-of-week blocksMap (not empty)', () => {
      // 999.2146 harrison finding 2: dedup Set is keyed by templateId and
      // module-level (persists for this file's whole run) — this test uses
      // its OWN dangling id so it can't consume the sibling "emits a log
      // warning" test's expected first-warn (each dangling id is unique
      // across this describe block for exactly that reason).
      var cfg = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: { '2026-07-20': 'ghost-fallthrough' } };
      // 2026-07-20 is a Monday
      var blocks = getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfg);
      expect(blocks).toBe(LEGACY_MON_BLOCKS);
    });

    it('UNKNOWN override templateId -> emits a log warning naming the dangling id and date', () => {
      var warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        var cfg = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: { '2026-07-20': 'ghost-warn' } };
        getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfg);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        var msg = warnSpy.mock.calls[0].join(' ');
        expect(msg).toContain('ghost-warn');
        expect(msg).toContain('2026-07-20');
      } finally {
        warnSpy.mockRestore();
      }
    });

    // harrison finding 2 (999.2146 review, INFO): getBlocksForDate is called
    // per-render by CalendarGrid.jsx/HorizontalTimeline.jsx through this
    // shared module — an un-deduped warn would fire on every re-render for
    // the same dangling ref. Dedup by templateId (module-level, once per
    // process) — a DIFFERENT dangling id is used here so this test's
    // assertions can't be polluted by (or pollute) the 'ghost-template' id
    // used in the sibling test above, since the dedup Set persists for the
    // life of this test file's module instance, not per-test.
    it('the SAME dangling templateId repeated across calls (re-renders / different dates) warns only ONCE per process', () => {
      var warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        var cfgA = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: { '2026-07-20': 'ghost-dedup' } };
        var cfgB = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: { '2026-07-21': 'ghost-dedup' } };
        getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfgA);
        getBlocksForDate('2026-07-21', { Tue: LEGACY_MON_BLOCKS }, cfgB); // same dangling id, different date
        getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfgA); // repeat call (simulates a re-render)
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('no override for the date -> no warning, falls through to blocksMap silently', () => {
      var warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        var cfg = { scheduleTemplates: SCHED_TEMPLATES, locScheduleOverrides: {} };
        var blocks = getBlocksForDate('2026-07-20', { Mon: LEGACY_MON_BLOCKS }, cfg);
        expect(blocks).toBe(LEGACY_MON_BLOCKS);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
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
