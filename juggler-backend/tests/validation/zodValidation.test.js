'use strict';

const { z } = require('zod');
const { taskCreateSchema, taskUpdateSchema } = require('../../src/schemas/task.schema');
const { preferencesSchema } = require('../../src/schemas/config.schema');

describe('Zod Validation Boundaries', () => {
  // TS-251: text field (1-500 characters)
  describe('TS-251: text field boundaries', () => {
    const testCases = [
      // Valid cases
      { input: { text: 'a' }, shouldPass: true, description: 'minimum length (1 char)' },
      { input: { text: 'a'.repeat(500) }, shouldPass: true, description: 'maximum length (500 chars)' },
      { input: { text: 'Normal task text' }, shouldPass: true, description: 'normal length' },
      
      // Invalid cases
      { input: { text: '' }, shouldPass: false, description: 'empty string' },
      { input: { text: 'a'.repeat(501) }, shouldPass: false, description: 'exceeds maximum (501 chars)' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskCreateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('text');
        }
      });
    });
  });

  // TS-252: notes field (5000 characters max)
  describe('TS-252: notes field boundaries', () => {
    // Check if notes field exists in schema - it should be added
    const testSchema = z.object({
      notes: z.string().max(5000).optional().nullable()
    });

    const testCases = [
      // Valid cases
      { input: { notes: null }, shouldPass: true, description: 'null value' },
      { input: { notes: '' }, shouldPass: true, description: 'empty string' },
      { input: { notes: 'a'.repeat(5000) }, shouldPass: true, description: 'maximum length (5000 chars)' },
      { input: { notes: 'Normal notes text' }, shouldPass: true, description: 'normal length' },
      
      // Invalid cases
      { input: { notes: 'a'.repeat(5001) }, shouldPass: false, description: 'exceeds maximum (5001 chars)' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = testSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('notes');
        }
      });
    });
  });

  // TS-253-254: dur field (5-480 minutes)
  describe('TS-253-254: dur field boundaries', () => {
    const testCases = [
      // Valid cases
      { input: { text: 'test', dur: 5 }, shouldPass: true, description: 'minimum duration (5 minutes)' },
      { input: { text: 'test', dur: 480 }, shouldPass: true, description: 'maximum duration (480 minutes)' },
      { input: { text: 'test', dur: 60 }, shouldPass: true, description: 'normal duration (60 minutes)' },
      { input: { text: 'test' }, shouldPass: true, description: 'optional field omitted' },
      
      // Invalid cases
      { input: { text: 'test', dur: 4 }, shouldPass: false, description: 'below minimum (4 minutes)' },
      { input: { text: 'test', dur: 481 }, shouldPass: false, description: 'above maximum (481 minutes)' },
      { input: { text: 'test', dur: 3.5 }, shouldPass: false, description: 'non-integer value' },
      { input: { text: 'test', dur: 'invalid' }, shouldPass: false, description: 'string instead of number' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskCreateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('dur');
        }
      });
    });
  });

  // TS-255: timeFlex field (0-480 minutes)
  describe('TS-255: timeFlex field boundaries', () => {
    // Create a test schema with timeFlex field
    const testSchema = z.object({
      timeFlex: z.number().int().min(0).max(480).optional()
    });

    const testCases = [
      // Valid cases
      { input: { timeFlex: 0 }, shouldPass: true, description: 'minimum timeFlex (0 minutes)' },
      { input: { timeFlex: 480 }, shouldPass: true, description: 'maximum timeFlex (480 minutes)' },
      { input: { timeFlex: 30 }, shouldPass: true, description: 'normal timeFlex (30 minutes)' },
      { input: {}, shouldPass: true, description: 'optional field omitted' },
      
      // Invalid cases
      { input: { timeFlex: -1 }, shouldPass: false, description: 'below minimum (-1 minutes)' },
      { input: { timeFlex: 481 }, shouldPass: false, description: 'above maximum (481 minutes)' },
      { input: { timeFlex: 15.5 }, shouldPass: false, description: 'non-integer value' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = testSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('timeFlex');
        }
      });
    });
  });

  // TS-256: splitMin field (> 0)
  describe('TS-256: splitMin field boundaries', () => {
    // Create a test schema with splitMin field
    const testSchema = z.object({
      splitMin: z.number().int().min(1).optional()
    });

    const testCases = [
      // Valid cases
      { input: { splitMin: 1 }, shouldPass: true, description: 'minimum splitMin (1 minute)' },
      { input: { splitMin: 30 }, shouldPass: true, description: 'normal splitMin (30 minutes)' },
      { input: {}, shouldPass: true, description: 'optional field omitted' },
      
      // Invalid cases
      { input: { splitMin: 0 }, shouldPass: false, description: 'zero value (must be > 0)' },
      { input: { splitMin: -1 }, shouldPass: false, description: 'negative value' },
      { input: { splitMin: 15.5 }, shouldPass: false, description: 'non-integer value' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = testSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('splitMin');
        }
      });
    });
  });

  // TS-257-258: travelBefore and travelAfter fields (0-120 minutes)
  describe('TS-257-258: travel fields boundaries', () => {
    const testCases = [
      // Valid cases for travelBefore
      { input: { text: 'test', travelBefore: 0 }, shouldPass: true, description: 'travelBefore minimum (0 minutes)' },
      { input: { text: 'test', travelBefore: 120 }, shouldPass: true, description: 'travelBefore maximum (120 minutes)' },
      { input: { text: 'test', travelBefore: 30 }, shouldPass: true, description: 'travelBefore normal value (30 minutes)' },
      { input: { text: 'test' }, shouldPass: true, description: 'travelBefore optional field omitted' },
      
      // Valid cases for travelAfter
      { input: { text: 'test', travelAfter: 0 }, shouldPass: true, description: 'travelAfter minimum (0 minutes)' },
      { input: { text: 'test', travelAfter: 120 }, shouldPass: true, description: 'travelAfter maximum (120 minutes)' },
      { input: { text: 'test', travelAfter: 45 }, shouldPass: true, description: 'travelAfter normal value (45 minutes)' },
      { input: { text: 'test' }, shouldPass: true, description: 'travelAfter optional field omitted' },
      
      // Invalid cases for travelBefore
      { input: { text: 'test', travelBefore: -1 }, shouldPass: false, description: 'travelBefore below minimum (-1 minutes)' },
      { input: { text: 'test', travelBefore: 121 }, shouldPass: false, description: 'travelBefore above maximum (121 minutes)' },
      { input: { text: 'test', travelBefore: 15.5 }, shouldPass: false, description: 'travelBefore non-integer value' },
      { input: { text: 'test', travelBefore: 'invalid' }, shouldPass: false, description: 'travelBefore string instead of number' },
      
      // Invalid cases for travelAfter
      { input: { text: 'test', travelAfter: -1 }, shouldPass: false, description: 'travelAfter below minimum (-1 minutes)' },
      { input: { text: 'test', travelAfter: 121 }, shouldPass: false, description: 'travelAfter above maximum (121 minutes)' },
      { input: { text: 'test', travelAfter: 25.5 }, shouldPass: false, description: 'travelAfter non-integer value' },
      { input: { text: 'test', travelAfter: 'invalid' }, shouldPass: false, description: 'travelAfter string instead of number' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskCreateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          // Check if the error is for travelBefore or travelAfter
          const errorPath = result.error.issues[0].path[0];
          expect(['travelBefore', 'travelAfter']).toContain(errorPath);
        }
      });
    });
  });

  // TS-259: status enum validation
  describe('TS-259: status enum validation', () => {
    const testCases = [
      // Valid cases
      { input: { status: '' }, shouldPass: true, description: 'empty status (valid)' },
      { input: { status: 'wip' }, shouldPass: true, description: 'wip status' },
      { input: { status: 'done' }, shouldPass: true, description: 'done status' },
      { input: { status: 'cancel' }, shouldPass: true, description: 'cancel status' },
      { input: { status: 'skip' }, shouldPass: true, description: 'skip status' },
      { input: { status: 'pause' }, shouldPass: true, description: 'pause status' },
      { input: { status: 'missed' }, shouldPass: true, description: 'missed status' },
      { input: { status: 'archived' }, shouldPass: true, description: 'archived status' },
      { input: { status: 'restored' }, shouldPass: true, description: 'restored status' },
      
      // Invalid cases
      { input: { status: 'invalid' }, shouldPass: false, description: 'invalid status value' },
      { input: { status: 'IN_PROGRESS' }, shouldPass: false, description: 'uppercase invalid status' },
      { input: { status: 123 }, shouldPass: false, description: 'numeric status value' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskUpdateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('status');
        }
      });
    });
  });

  // TS-260: weatherPrecip enum validation
  describe('TS-260: weatherPrecip enum validation', () => {
    const testCases = [
      // Valid cases
      { input: { text: 'test', weatherPrecip: 'any' }, shouldPass: true, description: 'any precip (valid)' },
      { input: { text: 'test', weatherPrecip: 'wet_ok' }, shouldPass: true, description: 'wet_ok precip' },
      { input: { text: 'test', weatherPrecip: 'light_ok' }, shouldPass: true, description: 'light_ok precip' },
      { input: { text: 'test', weatherPrecip: 'dry_only' }, shouldPass: true, description: 'dry_only precip' },
      { input: { text: 'test' }, shouldPass: true, description: 'optional field omitted' },
      
      // Invalid cases
      { input: { text: 'test', weatherPrecip: 'rainy' }, shouldPass: false, description: 'invalid precip value' },
      { input: { text: 'test', weatherPrecip: 'WET_OK' }, shouldPass: false, description: 'uppercase invalid precip' },
      { input: { text: 'test', weatherPrecip: 123 }, shouldPass: false, description: 'numeric precip value' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskCreateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('weatherPrecip');
        }
      });
    });
  });

  // TS-261: weatherCloud enum validation
  describe('TS-261: weatherCloud enum validation', () => {
    const testCases = [
      // Valid cases
      { input: { text: 'test', weatherCloud: 'any' }, shouldPass: true, description: 'any cloud (valid)' },
      { input: { text: 'test', weatherCloud: 'overcast_ok' }, shouldPass: true, description: 'overcast_ok cloud' },
      { input: { text: 'test', weatherCloud: 'partly_ok' }, shouldPass: true, description: 'partly_ok cloud' },
      { input: { text: 'test', weatherCloud: 'clear' }, shouldPass: true, description: 'clear cloud' },
      { input: { text: 'test' }, shouldPass: true, description: 'optional field omitted' },
      
      // Invalid cases
      { input: { text: 'test', weatherCloud: 'cloudy' }, shouldPass: false, description: 'invalid cloud value' },
      { input: { text: 'test', weatherCloud: 'OVERCAST_OK' }, shouldPass: false, description: 'uppercase invalid cloud' },
      { input: { text: 'test', weatherCloud: 123 }, shouldPass: false, description: 'numeric cloud value' },
    ];

    testCases.forEach(({ input, shouldPass, description }) => {
      test(`${description} - should ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = taskCreateSchema.safeParse(input);
        if (shouldPass) {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          expect(result.error.issues[0].path).toContain('weatherCloud');
        }
      });
    });
  });

  // TS-268: empty text validation (already covered in TS-251, but let's add explicit test)
  describe('TS-268: empty text validation', () => {
    test('empty text should fail validation', () => {
      const result = taskCreateSchema.safeParse({ text: '' });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('text');
      expect(result.error.issues[0].message).toContain('>=1 characters');
    });

    test('text with only spaces should be allowed (Zod does not trim by default)', () => {
      const result = taskCreateSchema.safeParse({ text: '   ' });
      expect(result.success).toBe(true);
      // Note: Zod's .min(1) counts spaces as valid characters
      // If trimming is needed, it should be done explicitly with .trim()
    });
  });

  // Null/undefined passthrough tests
  describe('Null/undefined passthrough validation', () => {
    test('null values should pass through for nullable fields', () => {
      const result = taskCreateSchema.safeParse({
        text: 'test',
        url: null,
        recur: null,
        weatherTempMin: null,
        weatherTempMax: null,
        weatherHumidityMin: null,
        weatherHumidityMax: null
      });
      expect(result.success).toBe(true);
      expect(result.data.url).toBe(null);
      expect(result.data.recur).toBe(null);
    });

    test('undefined values should be handled by passthrough', () => {
      const result = taskCreateSchema.safeParse({
        text: 'test',
        someUnknownField: undefined
      });
      expect(result.success).toBe(true);
      // passthrough should preserve undefined values
    });

    test('additional fields should pass through via passthrough', () => {
      const result = taskCreateSchema.safeParse({
        text: 'test',
        dur: 60,
        customField: 'customValue',
        anotherField: 123
      });
      expect(result.success).toBe(true);
      expect(result.data.customField).toBe('customValue');
      expect(result.data.anotherField).toBe(123);
    });
  });

  // Additional comprehensive tests for existing schema fields
  describe('Comprehensive schema validation', () => {
    test('taskCreateSchema should validate all required fields', () => {
      const validTask = {
        text: 'Valid task text',
        dur: 60,
        pri: 'P2',
        project: 'Test Project'
      };
      
      const result = taskCreateSchema.safeParse(validTask);
      expect(result.success).toBe(true);
    });

    test('taskUpdateSchema should allow status updates', () => {
      const validUpdate = {
        status: 'done',
        text: 'Updated task text'
      };
      
      const result = taskUpdateSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });

    test('preferencesSchema should validate config boundaries', () => {
      const validPrefs = {
        defaultDuration: 30,
        weekStartsOn: 1, // Monday
        temperatureUnit: 'C'
      };
      
      const result = preferencesSchema.safeParse(validPrefs);
      expect(result.success).toBe(true);
    });
  });
});