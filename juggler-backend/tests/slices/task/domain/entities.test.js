/**
 * W2 unit tests — Task domain entities (identity + invariants).
 *
 * Covers WBS W2 acceptance (a) + (e): entities exist and enforce their
 * invariants. Pure unit — no DB.
 */

'use strict';

const Task = require('../../../../src/slices/task/domain/entities/Task');
const TaskInstance = require('../../../../src/slices/task/domain/entities/TaskInstance');
const RecurrenceRule = require('../../../../src/slices/task/domain/entities/RecurrenceRule');
const TimeBlock = require('../../../../src/slices/task/domain/entities/TimeBlock');

describe('Task entity', () => {
  test('requires a non-empty id (identity invariant)', () => {
    expect(() => new Task({})).toThrow(/non-empty string/);
    expect(() => new Task({ id: '' })).toThrow(/non-empty string/);
    expect(() => new Task(null)).toThrow(/Task requires a props object/);
  });

  test('carries the API shape verbatim (no reshaping)', () => {
    const api = { id: 't1', taskType: 'task', text: 'hi', pri: 'P3', dependsOn: [] };
    const t = new Task(api);
    expect(t.toApi()).toEqual(api);
    expect(t.idValue()).toBe('t1');
    expect(t.taskType()).toBe('task');
  });

  test('does not mutate the caller object and is frozen', () => {
    const api = { id: 't1', taskType: 'task' };
    const t = new Task(api);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.props)).toBe(true);
    // mutating the original does not affect the entity snapshot
    api.taskType = 'mutated';
    expect(t.taskType()).toBe('task');
  });

  test('s7Term derives the conceptual scheduler term', () => {
    expect(new Task({ id: 't1', taskType: 'task', dependsOn: [] }).s7Term().value).toBe('one-off');
    expect(new Task({ id: 't2', taskType: 'task', dependsOn: ['x'] }).s7Term().value).toBe('chain member');
    expect(new Task({ id: 't3', taskType: 'recurring_instance', splitTotal: 1 }).s7Term().value).toBe('recurring instance');
    expect(new Task({ id: 't4', taskType: 'recurring_instance', splitTotal: 3 }).s7Term().value).toBe('split chunk');
    expect(new Task({ id: 't5', taskType: 'recurring_template' }).s7Term()).toBeNull();
  });

  test('isTemplate / isRecurringInstance classifiers', () => {
    expect(new Task({ id: 't', taskType: 'recurring_template' }).isTemplate()).toBe(true);
    expect(new Task({ id: 't', taskType: 'recurring_instance' }).isRecurringInstance()).toBe(true);
    expect(new Task({ id: 't', taskType: 'task' }).isTemplate()).toBe(false);
  });

  test('equals by id', () => {
    expect(new Task({ id: 'a' }).equals(new Task({ id: 'a' }))).toBe(true);
    expect(new Task({ id: 'a' }).equals(new Task({ id: 'b' }))).toBe(false);
  });
});

describe('TaskInstance entity', () => {
  test('requires a non-empty id', () => {
    expect(() => new TaskInstance({})).toThrow(/non-empty string/);
  });

  test('rejects a present-but-invalid sourceId', () => {
    expect(() => new TaskInstance({ id: 'i1', sourceId: '' })).toThrow(/sourceId must be a non-empty string/);
    expect(() => new TaskInstance({ id: 'i1', sourceId: 123 })).toThrow(/sourceId must be a non-empty string/);
  });

  test('allows a null/absent sourceId (standalone / self-linked one-off case)', () => {
    expect(new TaskInstance({ id: 'i1', sourceId: null }).sourceId()).toBeNull();
    expect(new TaskInstance({ id: 'i1' }).sourceId()).toBeNull();
  });

  test('isSplitChunk uses the Number(splitTotal) > 1 discriminator (matches controller)', () => {
    expect(new TaskInstance({ id: 'i', splitTotal: 2 }).isSplitChunk()).toBe(true);
    expect(new TaskInstance({ id: 'i', splitTotal: 1 }).isSplitChunk()).toBe(false);
    expect(new TaskInstance({ id: 'i', splitTotal: null }).isSplitChunk()).toBe(false);
    expect(new TaskInstance({ id: 'i' }).isSplitChunk()).toBe(false);
  });

  test('ordinal accessors passthrough null when absent', () => {
    const inst = new TaskInstance({ id: 'i', sourceId: 'tmpl', occurrenceOrdinal: 1, splitOrdinal: 2, splitTotal: 2, splitGroup: 'g' });
    expect(inst.occurrenceOrdinal()).toBe(1);
    expect(inst.splitOrdinal()).toBe(2);
    expect(inst.splitTotal()).toBe(2);
    expect(inst.splitGroup()).toBe('g');
    const bare = new TaskInstance({ id: 'i2' });
    expect(bare.occurrenceOrdinal()).toBeNull();
    expect(bare.splitGroup()).toBeNull();
  });
});

describe('RecurrenceRule entity', () => {
  test('from(null/undefined) → null (matches non-recurring tasks)', () => {
    expect(RecurrenceRule.from(null)).toBeNull();
    expect(RecurrenceRule.from(undefined)).toBeNull();
  });

  test('accepts each canonical recurrence type', () => {
    RecurrenceRule.VALID_TYPES.forEach((t) => {
      expect(new RecurrenceRule({ type: t }).type).toBe(t);
    });
  });

  test('matches type case-insensitively (controller does .toLowerCase())', () => {
    expect(new RecurrenceRule({ type: 'DAILY' }).type).toBe('daily');
  });

  test('REJECTS an unknown recurrence type', () => {
    expect(() => new RecurrenceRule({ type: 'fortnightly' })).toThrow(/RecurrenceRule.type must be one of/);
  });

  test('REJECTS an unknown interval unit', () => {
    expect(() => new RecurrenceRule({ type: 'interval', every: 2, unit: 'fortnights' })).toThrow(/RecurrenceRule.unit must be one of/);
  });

  test('accepts interval with valid unit + carries raw config verbatim', () => {
    const r = new RecurrenceRule({ type: 'interval', every: 2, unit: 'weeks', extra: 'x' });
    expect(r.every).toBe(2);
    expect(r.unit).toBe('weeks');
    expect(r.toConfig()).toEqual({ type: 'interval', every: 2, unit: 'weeks', extra: 'x' });
  });

  test('isValidType helper', () => {
    expect(RecurrenceRule.isValidType('Weekly')).toBe(true);
    expect(RecurrenceRule.isValidType('hourly')).toBe(false);
    expect(RecurrenceRule.isValidType(null)).toBe(false);
  });
});

describe('TimeBlock entity', () => {
  test('rejects empty / non-string tags', () => {
    expect(() => new TimeBlock('')).toThrow(/non-empty string/);
    expect(() => new TimeBlock(null)).toThrow(/non-empty string/);
  });

  test('rejects an over-length tag (> 30 chars — controller constraint)', () => {
    expect(() => new TimeBlock('x'.repeat(31))).toThrow(/30 characters or less/);
    expect(new TimeBlock('x'.repeat(30)).tag).toHaveLength(30);
  });

  test('isKeyword distinguishes known when-keywords from custom tags', () => {
    expect(new TimeBlock('fixed').isKeyword()).toBe(true);
    expect(new TimeBlock('anytime').isKeyword()).toBe(true);
    expect(new TimeBlock('morning').isKeyword()).toBe(false);
  });

  test('parseWhen reproduces controller split/trim/filter exactly', () => {
    expect(TimeBlock.parseWhen('morning, fixed ,, evening')).toEqual(['morning', 'fixed', 'evening']);
    expect(TimeBlock.parseWhen('')).toEqual([]);
    expect(TimeBlock.parseWhen(null)).toEqual([]);
    expect(TimeBlock.parseWhen(undefined)).toEqual([]);
  });

  test('parseWhen does NOT throw on over-length parts (only validation flags them)', () => {
    expect(() => TimeBlock.parseWhen('x'.repeat(40))).not.toThrow();
  });
});
