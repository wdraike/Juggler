/**
 * 999.2144 RED/GREEN — schedule-template config shape validators (domain,
 * pure, no DB). Covers the dev-DB corruption evidence directly: a block
 * missing `loc` (the exact shape observed) must be rejected.
 */

'use strict';

const {
  validateScheduleTemplates,
  validateTemplateDefaults,
  validateTemplateOverrides
} = require('../../../../src/slices/user-config/domain/logic/scheduleTemplateValidation');

describe('validateScheduleTemplates', () => {
  test('valid weekday/weekend trio passes', () => {
    const value = {
      weekday: {
        name: 'Weekday', icon: '🏢', system: true, locOverrides: {},
        blocks: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' }]
      }
    };
    expect(validateScheduleTemplates(value)).toEqual({ valid: true, errors: [] });
  });

  test('empty blocks array is TOLERATED (useConfig auto-populates on load)', () => {
    const value = { weekday: { name: 'Weekday', blocks: [] } };
    expect(validateScheduleTemplates(value).valid).toBe(true);
  });

  test('non-object value is rejected', () => {
    expect(validateScheduleTemplates('garbage').valid).toBe(false);
    expect(validateScheduleTemplates(null).valid).toBe(false);
    expect(validateScheduleTemplates([]).valid).toBe(false);
  });

  test('empty object (no templates at all) is rejected', () => {
    expect(validateScheduleTemplates({}).valid).toBe(false);
  });

  test('DEV-DB CORRUPTION EVIDENCE: a block missing `loc` is rejected', () => {
    // Exact observed shape: user_config schedule_templates.weekday.blocks
    // collapsed to [{start:0,end:540,tag:'custom',name:'Custom'}] — no `loc`.
    const value = {
      weekday: { name: 'Weekday', blocks: [{ start: 0, end: 540, tag: 'custom', name: 'Custom' }] }
    };
    const res = validateScheduleTemplates(value);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('.loc'))).toBe(true);
  });

  test('block start/end out of range rejected', () => {
    const tooLate = { weekday: { name: 'W', blocks: [{ start: 1400, end: 1500, loc: 'home', tag: 'x', name: 'X' }] } };
    expect(validateScheduleTemplates(tooLate).valid).toBe(false);

    const inverted = { weekday: { name: 'W', blocks: [{ start: 500, end: 400, loc: 'home', tag: 'x', name: 'X' }] } };
    expect(validateScheduleTemplates(inverted).valid).toBe(false);

    const nonInt = { weekday: { name: 'W', blocks: [{ start: 1.5, end: 400, loc: 'home', tag: 'x', name: 'X' }] } };
    expect(validateScheduleTemplates(nonInt).valid).toBe(false);
  });

  test('template missing name is rejected', () => {
    const value = { weekday: { blocks: [] } };
    expect(validateScheduleTemplates(value).valid).toBe(false);
  });

  test('locOverrides must be an object when present', () => {
    const value = { weekday: { name: 'W', blocks: [], locOverrides: 'nope' } };
    expect(validateScheduleTemplates(value).valid).toBe(false);
  });
});

describe('validateTemplateDefaults', () => {
  test('valid Mon..Sun map passes', () => {
    const value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    expect(validateTemplateDefaults(value).valid).toBe(true);
  });

  test('missing a day key is rejected', () => {
    const value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend' };
    const res = validateTemplateDefaults(value);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Sun'))).toBe(true);
  });

  test('extra unexpected key is rejected', () => {
    const value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend', Blursday: 'weekday' };
    expect(validateTemplateDefaults(value).valid).toBe(false);
  });

  test('non-object value is rejected', () => {
    expect(validateTemplateDefaults('nope').valid).toBe(false);
  });

  test('unknown templateId ref rejected when knownTemplateIds supplied', () => {
    const value = { Mon: 'ghost', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    const res = validateTemplateDefaults(value, ['weekday', 'weekend']);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  test('known templateId ref passes when knownTemplateIds supplied', () => {
    const value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    expect(validateTemplateDefaults(value, ['weekday', 'weekend']).valid).toBe(true);
  });
});

describe('validateTemplateOverrides', () => {
  test('empty object is valid', () => {
    expect(validateTemplateOverrides({}).valid).toBe(true);
  });

  test('valid YYYY-MM-DD -> templateId map passes', () => {
    expect(validateTemplateOverrides({ '2026-07-21': 'weekend' }).valid).toBe(true);
  });

  test('bad date key format rejected', () => {
    const res = validateTemplateOverrides({ '07-21-2026': 'weekend' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('YYYY-MM-DD'))).toBe(true);
  });

  test('non-string templateId value rejected', () => {
    expect(validateTemplateOverrides({ '2026-07-21': 5 }).valid).toBe(false);
  });

  test('unknown templateId ref rejected when knownTemplateIds supplied', () => {
    const res = validateTemplateOverrides({ '2026-07-21': 'ghost' }, ['weekday', 'weekend']);
    expect(res.valid).toBe(false);
  });

  test('non-object value is rejected', () => {
    expect(validateTemplateOverrides(null).valid).toBe(false);
  });
});
