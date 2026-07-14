/**
 * 999.1568 (David ruling 2026-07-12 part 2) — defense-in-depth collision guard.
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 *
 * Contract: resolvePlacementCollisions(dayPlacements)
 *   → mutates dayPlacements IN PLACE, removing the losing entry of each
 *     detected collision (per checkPlacementDisjointness).
 *   → returns losers: [{ id, task, date, start, dur }], one per demoted entry.
 *
 * D-C ruling (2026-07-02, sched-audit-dc-rigid.test.js) carve-outs:
 *   - FIXED-vs-FIXED collision: intentional user double-booking, both stay.
 *   - FIXED-vs-movable collision: movable always loses, FIXED never moves.
 *   - Reminder (placement_mode='reminder') on either side: left alone.
 * Between two movable (non-FIXED, non-reminder) tasks: the later-starting
 * entry (checkPlacementDisjointness's "b") loses.
 */
'use strict';

process.env.NODE_ENV = 'test';

const { resolvePlacementCollisions } = require('../../../src/scheduler/runSchedule');
const { PLACEMENT_MODES } = require('../../../src/lib/placementModes');
const { REASON_CODES } = require('juggler-shared/scheduler/reasonCodes');

function entry(id, start, dur, placementMode) {
  return { task: { id: id, placementMode: placementMode }, start: start, dur: dur };
}

describe('resolvePlacementCollisions — 999.1568', () => {
  test('two movable (non-FIXED, non-reminder) tasks colliding: the later-starting one loses, is removed from dayPlacements, and is returned in losers', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('anytime-early', 780, 60, PLACEMENT_MODES.ANYTIME),  // 13:00-14:00
        entry('anytime-late', 800, 30, PLACEMENT_MODES.ANYTIME),   // 13:20-13:50 -- overlaps
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    expect(losers).toHaveLength(1);
    expect(losers[0].id).toBe('anytime-late');
    expect(losers[0].date).toBe('2026-07-20');
    expect(losers[0].start).toBe(800);

    // dayPlacements mutated in place: loser removed, winner stays.
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id);
    expect(remainingIds).toEqual(['anytime-early']);
  });

  test('FIXED vs movable collision: the movable task loses, FIXED stays untouched (D-C: FIXED slot is RESERVED)', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('fixed-anchor', 780, 60, PLACEMENT_MODES.FIXED),     // 13:00-14:00, user-anchored
        entry('anytime-intruder', 800, 30, PLACEMENT_MODES.ANYTIME), // scheduler-placed intrusion
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    expect(losers).toHaveLength(1);
    expect(losers[0].id).toBe('anytime-intruder');
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id);
    expect(remainingIds).toEqual(['fixed-anchor']);
  });

  test('FIXED vs movable collision, movable starts FIRST: movable still loses even though it is "a" (start-order tie-break never overrides the FIXED carve-out)', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('anytime-intruder', 780, 60, PLACEMENT_MODES.ANYTIME), // starts first (a)
        entry('fixed-anchor', 800, 30, PLACEMENT_MODES.FIXED),        // starts second (b), but FIXED
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    expect(losers).toHaveLength(1);
    expect(losers[0].id).toBe('anytime-intruder');
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id);
    expect(remainingIds).toEqual(['fixed-anchor']);
  });

  test('FIXED vs FIXED collision: D-C intentional user double-booking — BOTH stay, no losers (sched-audit-dc-rigid.test.js Test 4 parity)', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('fixed-E1', 840, 30, PLACEMENT_MODES.FIXED),
        entry('fixed-E2', 840, 45, PLACEMENT_MODES.FIXED),
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    expect(losers).toHaveLength(0);
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id).sort();
    expect(remainingIds).toEqual(['fixed-E1', 'fixed-E2']);
  });

  test('reminder colliding (by construction, dur>0 override) with a movable task: reminder side exempts the pair — neither is demoted', () => {
    // Reminders normally never collide (dur=0 keeps checkPlacementDisjointness's
    // strict `>` from ever firing) — this fixture forces a same-slot overlap by
    // giving the reminder a non-zero dur, purely to prove the explicit
    // placementMode==='reminder' exemption fires independent of dur.
    const dayPlacements = {
      '2026-07-20': [
        entry('reminder-x', 780, 60, PLACEMENT_MODES.REMINDER),
        entry('anytime-y', 800, 30, PLACEMENT_MODES.ANYTIME),
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    expect(losers).toHaveLength(0);
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id).sort();
    expect(remainingIds).toEqual(['anytime-y', 'reminder-x']);
  });

  test('no collision: dayPlacements untouched, losers empty', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('a', 780, 60, PLACEMENT_MODES.ANYTIME),
        entry('b', 840, 30, PLACEMENT_MODES.ANYTIME), // touching boundary, not overlapping
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);
    expect(losers).toHaveLength(0);
    expect(dayPlacements['2026-07-20']).toHaveLength(2);
  });

  test('three-way chain collision (A-B-C, all movable): removing B for the A-B pair also resolves the B-C pair (chain de-dup) — only ONE loser', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('chain-a', 780, 40, PLACEMENT_MODES.ANYTIME), // 13:00-13:40
        entry('chain-b', 800, 40, PLACEMENT_MODES.ANYTIME), // 13:20-14:00 -- overlaps a
        entry('chain-c', 830, 30, PLACEMENT_MODES.ANYTIME), // 13:50-14:20 -- overlaps b
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);

    // A-B violation removes B; the B-C violation is then moot (B already gone).
    expect(losers).toHaveLength(1);
    expect(losers[0].id).toBe('chain-b');
    const remainingIds = dayPlacements['2026-07-20'].map((e) => e.task.id).sort();
    expect(remainingIds).toEqual(['chain-a', 'chain-c']);
  });

  // Full pairwise scan over survivors — the invariant the guard must deliver:
  // after resolution, NO two non-exempt entries may still overlap. Mirrors the
  // production overlap predicate (touching edges are not a collision).
  function residualNonExemptOverlaps(dayPlacements) {
    const out = [];
    Object.keys(dayPlacements).forEach((dateKey) => {
      const es = dayPlacements[dateKey];
      for (let i = 0; i < es.length - 1; i++) {
        for (let j = i + 1; j < es.length; j++) {
          const a = es[i];
          const b = es[j];
          if (!(a.start < b.start + b.dur && b.start < a.start + a.dur)) continue;
          const rem = (e) => e.task.placementMode === PLACEMENT_MODES.REMINDER;
          const fx = (e) => e.task.placementMode === PLACEMENT_MODES.FIXED;
          if (rem(a) || rem(b)) continue;
          if (fx(a) && fx(b)) continue;
          out.push([a.task.id, b.task.id]);
        }
      }
    });
    return out;
  }

  test('same-start triple (harrison 999.1568 BLOCK-1 repro): three movables on the identical slot fixpoint down to ONE survivor — zero residual overlap', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('triple-a', 600, 30, PLACEMENT_MODES.ANYTIME),
        entry('triple-b', 600, 30, PLACEMENT_MODES.ANYTIME),
        entry('triple-c', 600, 30, PLACEMENT_MODES.ANYTIME),
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);
    expect(losers.map((l) => l.id).sort()).toEqual(['triple-b', 'triple-c']);
    expect(dayPlacements['2026-07-20'].map((e) => e.task.id)).toEqual(['triple-a']);
    expect(residualNonExemptOverlaps(dayPlacements)).toEqual([]);
  });

  test('long-early-task straddle (harrison 999.1568 BLOCK-1 repro): A overlaps BOTH B and the non-adjacent C — fixpoint demotes both, zero residual', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('straddle-a', 780, 100, PLACEMENT_MODES.ANYTIME), // 13:00-14:40
        entry('straddle-b', 800, 10, PLACEMENT_MODES.ANYTIME),  // inside A
        entry('straddle-c', 840, 10, PLACEMENT_MODES.ANYTIME),  // inside A, NOT sort-adjacent to it
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);
    expect(losers.map((l) => l.id).sort()).toEqual(['straddle-b', 'straddle-c']);
    expect(dayPlacements['2026-07-20'].map((e) => e.task.id)).toEqual(['straddle-a']);
    expect(residualNonExemptOverlaps(dayPlacements)).toEqual([]);
  });

  test('FIXED + two movables on one slot (harrison 999.1568 BLOCK-1 repro): BOTH movables demoted — the FIXED slot stays genuinely reserved', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('fx-anchor', 600, 30, PLACEMENT_MODES.FIXED),
        entry('mv-one', 600, 30, PLACEMENT_MODES.ANYTIME),
        entry('mv-two', 600, 30, PLACEMENT_MODES.ANYTIME),
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);
    expect(losers.map((l) => l.id).sort()).toEqual(['mv-one', 'mv-two']);
    expect(dayPlacements['2026-07-20'].map((e) => e.task.id)).toEqual(['fx-anchor']);
    expect(residualNonExemptOverlaps(dayPlacements)).toEqual([]);
  });

  test('multi-day isolation: a collision on one date never touches another date\'s entries (checkPlacementDisjointness parity)', () => {
    const dayPlacements = {
      '2026-07-20': [
        entry('day1-a', 780, 60, PLACEMENT_MODES.ANYTIME),
        entry('day1-b', 800, 30, PLACEMENT_MODES.ANYTIME),
      ],
      '2026-07-21': [
        entry('day2-a', 780, 60, PLACEMENT_MODES.ANYTIME),
      ],
    };
    const losers = resolvePlacementCollisions(dayPlacements);
    expect(losers).toHaveLength(1);
    expect(losers[0].date).toBe('2026-07-20');
    expect(dayPlacements['2026-07-21']).toHaveLength(1);
  });

  test('empty/null input: returns empty losers, does not throw', () => {
    expect(resolvePlacementCollisions({})).toEqual([]);
    expect(resolvePlacementCollisions(null)).toEqual([]);
  });

  test('SCHED_COLLISION reason code exists and is a non-empty snake_case string (sanity on the new taxonomy entry this guard relies on)', () => {
    expect(REASON_CODES.SCHED_COLLISION).toBe('sched_collision');
  });
});
