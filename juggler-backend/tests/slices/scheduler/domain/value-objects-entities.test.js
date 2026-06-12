/**
 * H6 W1 unit tests — Scheduler domain value objects + entities.
 *
 * Covers the pure VOs (Priority, TimeWindow, Deadline) and entities (Constraint,
 * ScheduledTask, Schedule, ScoredSchedule) extracted into the scheduler domain
 * core. Asserts they characterize the legacy scheduler behavior exactly (PRI_RANK
 * weights, normalizePri rules, deadline-miss arithmetic, half-open overlap) and
 * that PlacementMode is REUSED from the task slice (not duplicated).
 *
 * Pure unit — no DB, no network.
 */

'use strict';

const Priority = require('../../../../src/slices/scheduler/domain/value-objects/Priority');
const TimeWindow = require('../../../../src/slices/scheduler/domain/value-objects/TimeWindow');
const Deadline = require('../../../../src/slices/scheduler/domain/value-objects/Deadline');
const Constraint = require('../../../../src/slices/scheduler/domain/entities/Constraint');
const ScheduledTask = require('../../../../src/slices/scheduler/domain/entities/ScheduledTask');
const Schedule = require('../../../../src/slices/scheduler/domain/entities/Schedule');
const ScoredSchedule = require('../../../../src/slices/scheduler/domain/entities/ScoredSchedule');

const domain = require('../../../../src/slices/scheduler/domain');
const { PRI_RANK } = require('../../../../src/scheduler/constants');
const TaskPlacementMode = require('../../../../src/slices/task/domain/value-objects/PlacementMode');

// ── Priority ────────────────────────────────────────────────────────────────
describe('Priority VO — closed enum + normalize/rank parity with PRI_RANK', () => {
  test('canonical set equals PRI_RANK keys', () => {
    expect(Priority.VALUES.slice().sort()).toEqual(Object.keys(PRI_RANK).slice().sort());
  });

  test('rank() returns the exact PRI_RANK weight (P1=100,P2=80,P3=50,P4=20)', () => {
    expect(Priority.rank('P1')).toBe(100);
    expect(Priority.rank('P2')).toBe(80);
    expect(Priority.rank('P3')).toBe(50);
    expect(Priority.rank('P4')).toBe(20);
  });

  test('rank() of unknown falls back to P3 weight (matches priWeight)', () => {
    expect(Priority.rank('PX')).toBe(PRI_RANK['P3']);
    expect(Priority.rank(undefined)).toBe(PRI_RANK['P3']);
  });

  test.each([
    ['', 'P3'], [null, 'P3'], [undefined, 'P3'],
    ['p1', 'P1'], [' P2 ', 'P2'], ['3', 'P3'], ['4', 'P4'],
    ['garbage', 'P3'], ['P9', 'P3'], ['9', 'P3']
  ])('normalize(%p) → %s (byte-identical to legacy normalizePri)', (input, expected) => {
    expect(Priority.normalize(input)).toBe(expected);
  });

  test('constructor rejects unknown tier; from() normalizes first', () => {
    expect(() => new Priority('P9')).toThrow(/Priority must be one of/);
    expect(Priority.from('p1').value).toBe('P1');
    expect(Priority.from('garbage').value).toBe('P3'); // normalized, not thrown
  });

  test('instances are immutable and compare by value', () => {
    const p = new Priority('P2');
    expect(() => { p.value = 'P1'; }).toThrow();
    expect(p.equals(new Priority('P2'))).toBe(true);
    expect(p.equals(new Priority('P1'))).toBe(false);
    expect(p.rank()).toBe(80);
  });
});

// ── TimeWindow ──────────────────────────────────────────────────────────────
describe('TimeWindow VO — interval math parity with scheduler loops', () => {
  test('length() == (end - start) (matches capacityInRange)', () => {
    expect(new TimeWindow(480, 720).length()).toBe(240);
  });

  test('canFit() uses half-open semantics (start + dur <= end)', () => {
    const w = new TimeWindow(480, 540); // 60-min window
    expect(w.canFit(60)).toBe(true);     // exact fit
    expect(w.canFit(61)).toBe(false);    // overflows
    expect(w.canFit(30, 510)).toBe(true);
    expect(w.canFit(30, 520)).toBe(false); // 520+30=550 > 540
  });

  test('overlap() matches overlapWithEligibleWindows arithmetic', () => {
    const w = new TimeWindow(480, 600);
    expect(w.overlap({ start: 540, end: 660 })).toBe(60); // [540,600)
    expect(w.overlap({ start: 600, end: 660 })).toBe(0);  // touching, disjoint
    expect(w.overlap({ start: 700, end: 800 })).toBe(0);
  });

  test('fromPair/toPair round-trip the bare [s,e] shape', () => {
    const w = TimeWindow.fromPair([480, 720]);
    expect(w.toPair()).toEqual([480, 720]);
  });

  test('rejects non-numeric or inverted bounds; is immutable', () => {
    expect(() => new TimeWindow('a', 5)).toThrow(/finite numbers/);
    expect(() => new TimeWindow(600, 500)).toThrow(/must be >= start/);
    const w = new TimeWindow(0, 10);
    expect(() => { w.start = 5; }).toThrow();
  });
});

// ── Deadline ────────────────────────────────────────────────────────────────
describe('Deadline VO — ISO date-key + miss arithmetic parity with scorer', () => {
  test('toNumber() matches scoreSchedule.parseDateKey ISO branch', () => {
    expect(Deadline.toNumber('2026-06-16')).toBe(20260616);
    expect(new Deadline('2026-03-22').toNumber()).toBe(20260322);
  });

  test('isMissedBy() reproduces placedNum > deadlineNum (strictly after)', () => {
    const dl = new Deadline('2026-06-15');
    expect(dl.isMissedBy('2026-06-16')).toBe(true);  // day after → missed
    expect(dl.isMissedBy('2026-06-15')).toBe(false); // same day → on time
    expect(dl.isMissedBy('2026-06-14')).toBe(false); // before → on time
  });

  test('isValid rejects non-ISO; constructor throws on bad input', () => {
    expect(Deadline.isValid('2026-06-16')).toBe(true);
    expect(Deadline.isValid('6/16/2026')).toBe(false);
    expect(Deadline.isValid(null)).toBe(false);
    expect(() => new Deadline('6/16')).toThrow(/ISO YYYY-MM-DD/);
  });
});

// ── Constraint ──────────────────────────────────────────────────────────────
describe('Constraint entity — S2 severity precedence (fixed>overdue>deadline>free)', () => {
  test('fixed wins over everything', () => {
    const c = new Constraint({ taskId: 't1', fixed: true, overdue: true, deadlineKey: '2026-06-16' });
    expect(c.severity()).toBe(Constraint.SEVERITY.FIXED);
  });
  test('overdue beats deadline', () => {
    const c = new Constraint({ taskId: 't2', overdue: true, deadlineKey: '2026-06-16' });
    expect(c.severity()).toBe(Constraint.SEVERITY.OVERDUE);
  });
  test('deadline beats free', () => {
    const c = new Constraint({ taskId: 't3', deadlineKey: '2026-06-16' });
    expect(c.severity()).toBe(Constraint.SEVERITY.DEADLINE);
    expect(c.hasDeadline()).toBe(true);
  });
  test('no flags → free', () => {
    const c = new Constraint({ taskId: 't4' });
    expect(c.severity()).toBe(Constraint.SEVERITY.FREE);
    expect(c.hasDeadline()).toBe(false);
  });
  test('dependsOn is copied + frozen (no external mutation)', () => {
    const deps = ['a', 'b'];
    const c = new Constraint({ taskId: 't5', dependsOn: deps });
    deps.push('c');
    expect(c.dependsOn).toEqual(['a', 'b']); // unaffected by external push
    expect(() => c.dependsOn.push('x')).toThrow();
  });
});

// ── ScheduledTask ───────────────────────────────────────────────────────────
describe('ScheduledTask entity — placement read-model + half-open overlap', () => {
  test('fromEntry round-trips the legacy dayPlacements entry shape', () => {
    const entry = { task: { id: 'x1' }, start: 480, dur: 60, locked: true, travelBefore: 5, travelAfter: 10 };
    const st = ScheduledTask.fromEntry(entry, '2026-06-16');
    expect(st.taskId()).toBe('x1');
    expect(st.dateKey).toBe('2026-06-16');
    expect(st.start).toBe(480);
    expect(st.end()).toBe(540);
    expect(st.locked).toBe(true);
    expect(st.travelBefore).toBe(5);
    expect(st.travelAfter).toBe(10);
  });
  test('overlapsSlot uses half-open test (matches tryPlaceAtTime conflict check)', () => {
    const st = ScheduledTask.fromEntry({ task: { id: 'x' }, start: 600, dur: 60 }, '2026-06-16');
    expect(st.overlapsSlot(630, 30)).toBe(true);  // inside
    expect(st.overlapsSlot(660, 30)).toBe(false); // touching at end (660) → disjoint
    expect(st.overlapsSlot(540, 60)).toBe(false); // ends at 600 → disjoint
    expect(st.overlapsSlot(540, 70)).toBe(true);  // 540..610 overlaps 600
  });
});

// ── Schedule / ScoredSchedule ────────────────────────────────────────────────
describe('Schedule aggregate — read-model over scheduler result', () => {
  const result = {
    dayPlacements: {
      '2026-06-16': [
        { task: { id: 'a' }, start: 480, dur: 30 },
        { task: { id: 'b' }, start: 510, dur: 30 }
      ],
      '2026-06-17': [{ task: { id: 'a' }, start: 600, dur: 30 }] // a is split across days
    },
    unplaced: [{ id: 'c' }],
    score: { total: 0, breakdown: {}, details: [] },
    slackByTaskId: { a: 100, b: null }
  };
  const sched = Schedule.fromResult(result);

  test('placementsOn returns insertion-ordered placements for a day', () => {
    const ids = sched.placementsOn('2026-06-16').map((p) => p.taskId());
    expect(ids).toEqual(['a', 'b']); // insertion == pass order preserved
  });
  test('placementsOf finds every placement of a task across days', () => {
    expect(sched.placementsOf('a').map((p) => p.dateKey)).toEqual(['2026-06-16', '2026-06-17']);
  });
  test('isPlaced / isUnplaced reflect the result', () => {
    expect(sched.isPlaced('a')).toBe(true);
    expect(sched.isPlaced('c')).toBe(false);
    expect(sched.isUnplaced('c')).toBe(true);
    expect(sched.isUnplaced('a')).toBe(false);
  });
  test('toResult returns the underlying object unchanged', () => {
    expect(sched.toResult()).toBe(result);
  });
});

describe('ScoredSchedule entity — score read-model', () => {
  test('isPerfect true at total 0; detailsOfType filters', () => {
    const ss = ScoredSchedule.from({
      total: 80, breakdown: { unplaced: 80 },
      details: [{ taskId: 'c', type: 'unplaced', penalty: 80 }]
    });
    expect(ss.isPerfect()).toBe(false);
    expect(ss.detailsOfType('unplaced')).toHaveLength(1);
    expect(ss.detailsOfType('deadlineMiss')).toHaveLength(0);
    expect(ScoredSchedule.from({ total: 0, breakdown: {}, details: [] }).isPerfect()).toBe(true);
  });
});

// ── PlacementMode reuse (S7) ──────────────────────────────────────────────────
describe('PlacementMode is REUSED from the task slice, not duplicated', () => {
  test('domain barrel exposes the same PlacementMode VO as the task slice', () => {
    expect(domain.PlacementMode).toBe(TaskPlacementMode);
  });
});
