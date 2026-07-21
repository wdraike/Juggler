/**
 * 999.2164 — resolveLocationId consumes the CANONICAL template trio
 * (David ruling 2026-07-21, RULINGS-2026-07-21.md): template
 * locOverrides[minSlot] -> containing canonical block's .loc -> legacy
 * hourLocationOverrides/hour-map -> legacy loc_schedule_defaults -> 'home'.
 * Pre-fix, only the legacy loc_schedules hour-map was consulted, so
 * canonical-only writers (reset endpoint, MCP/API) left locations stale.
 */

const { resolveLocationId } = require('../../../../shared/scheduler/locationHelpers');

const TPL = {
  weekday: {
    name: 'Weekday',
    blocks: [{ id: 'b1', tag: 'biz', start: 480, end: 720, loc: 'work' }],
    locOverrides: { 600: 'gym' }
  }
};

// 2026-07-20 is a Monday.
test('per-date hour paint (hourLocationOverrides) stays on TOP (refinement ruling)', () => {
  const cfg = {
    scheduleTemplates: TPL,
    templateDefaults: { Mon: 'weekday' },
    hourLocationOverrides: { '2026-07-20': { 10: 'errand' } },
    locSchedules: { weekday: { hours: { 600: 'home' } } }
  };
  expect(resolveLocationId('2026-07-20', 600, cfg, [])).toBe('errand');
});

test('canonical template locOverrides[minSlot] beats the legacy hour-map', () => {
  const cfg = {
    scheduleTemplates: TPL,
    templateDefaults: { Mon: 'weekday' },
    locSchedules: { weekday: { hours: { 600: 'home' } } },
    locScheduleDefaults: { Mon: 'weekday' }
  };
  expect(resolveLocationId('2026-07-20', 600, cfg, [])).toBe('gym');
});

test('legacy locScheduleOverrides[date] slots between canonical override and day-default (harrison WARN 1)', () => {
  const cfg = {
    scheduleTemplates: Object.assign({}, TPL, {
      special: { name: 'Special', blocks: [{ id: 's1', tag: 'biz', start: 480, end: 720, loc: 'errand' }], locOverrides: {} }
    }),
    templateDefaults: { Mon: 'weekday' },
    locScheduleOverrides: { '2026-07-20': 'special' }
  };
  expect(resolveLocationId('2026-07-20', 495, cfg, [])).toBe('errand');
});

test('containing canonical block .loc applies when no locOverride at the slot', () => {
  const cfg = { scheduleTemplates: TPL, templateDefaults: { Mon: 'weekday' } };
  expect(resolveLocationId('2026-07-20', 495, cfg, [])).toBe('work');
});

test('templateOverrides[date] picks the canonical template for that date', () => {
  const cfg = {
    scheduleTemplates: Object.assign({}, TPL, {
      away: { name: 'Away', blocks: [{ id: 'a1', tag: 'biz', start: 480, end: 720, loc: 'errand' }], locOverrides: {} }
    }),
    templateDefaults: { Mon: 'weekday' },
    templateOverrides: { '2026-07-20': 'away' }
  };
  expect(resolveLocationId('2026-07-20', 495, cfg, [])).toBe('errand');
});

test('no canonical config -> legacy chain behaves exactly as before', () => {
  const cfg = {
    hourLocationOverrides: { '2026-07-20': { 10: 'errand' } },
    locScheduleDefaults: { Mon: 'weekday' },
    locSchedules: { weekday: { hours: { 660: 'gym' } } }
  };
  expect(resolveLocationId('2026-07-20', 10, cfg, [])).toBe('errand'); // hour override
  expect(resolveLocationId('2026-07-20', 660, cfg, [])).toBe('gym');   // hour-map
});

test('dangling canonical refs fall through to the legacy chain', () => {
  const cfg = {
    scheduleTemplates: TPL,
    templateOverrides: { '2026-07-20': 'ghost' },
    templateDefaults: { Mon: 'also-ghost' },
    locSchedules: { weekday: { hours: { 600: 'home' } } },
    locScheduleDefaults: { Mon: 'weekday' }
  };
  expect(resolveLocationId('2026-07-20', 600, cfg, [])).toBe('home');
});
