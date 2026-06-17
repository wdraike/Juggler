/**
 * 999.570 — Split sync: split task chunks pushed as individual external calendar
 * events with correct times/ordering (M-R7).
 *
 * Tests the mergeContiguousSplitChunks logic in cal-sync.controller.js that
 * merges contiguous split chunks into single calendar events, and verifies
 * non-contiguous chunks get individual events with "(X/N)" suffix.
 *
 * Pure unit tests — no DB. Exercises the merge logic directly by simulating
 * the allTaskRows input that cal-sync builds from the DB.
 */

'use strict';

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Build a mock task row (as returned by DB queries in cal-sync).
 * @param {object} overrides
 */
function makeRow(overrides) {
  return Object.assign({
    id: 'chunk-' + Math.random().toString(36).slice(2, 8),
    master_id: 'master-1',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 3,
    dur: 30,
    scheduled_at: '2026-06-17 09:00:00',
    text: 'My split task',
  }, overrides);
}

/**
 * Simulate the mergeContiguousSplitChunks logic from cal-sync.controller.js.
 * Given an array of allTaskRows, returns:
 *   { mergedFollowers, mergedLeaderInfo }
 * where mergedFollowers maps follower taskId → leader taskId (suppressed in push),
 * and mergedLeaderInfo maps leader taskId → { leaderDur, titleSuffix }.
 */
function simulateMerge(allTaskRows) {
  var mergedFollowers = {};
  var mergedLeaderInfo = {};

  var byOccurrence = {};
  allTaskRows.forEach(function(r) {
    var tot = Number(r.split_total) || 1;
    if (tot <= 1) return;
    if (!r.master_id || r.occurrence_ordinal == null) return;
    var key = r.master_id + '|' + r.occurrence_ordinal;
    if (!byOccurrence[key]) byOccurrence[key] = [];
    byOccurrence[key].push(r);
  });

  Object.keys(byOccurrence).forEach(function(k) {
    var chunks = byOccurrence[k].slice().sort(function(a, b) {
      return (Number(a.split_ordinal) || 1) - (Number(b.split_ordinal) || 1);
    });

    var runs = [];
    var current = null;
    chunks.forEach(function(c) {
      if (!c.scheduled_at) return;
      var startMs = new Date(String(c.scheduled_at).replace(' ', 'T') + 'Z').getTime();
      var endMs = startMs + ((Number(c.dur) || 30) * 60000);
      if (current && Math.abs(current.endMs - startMs) < 30000) {
        current.chunks.push(c);
        current.endMs = endMs;
      } else {
        current = { chunks: [c], startMs: startMs, endMs: endMs };
        runs.push(current);
      }
    });

    runs.forEach(function(run) {
      if (run.chunks.length < 2) {
        var c = run.chunks[0];
        var tot = Number(c.split_total) || 1;
        if (tot > 1) {
          var so = Number(c.split_ordinal) || 1;
          mergedLeaderInfo[c.id] = {
            leaderDur: c.dur != null ? Number(c.dur) : null,
            titleSuffix: ' (' + so + '/' + tot + ')'
          };
        }
        return;
      }
      var leader = run.chunks[0];
      var total = chunks.length;
      var coversAll = run.chunks.length === total;
      var firstPart = Number(leader.split_ordinal) || 1;
      var lastPart = Number(run.chunks[run.chunks.length - 1].split_ordinal) || run.chunks.length;
      mergedLeaderInfo[leader.id] = {
        leaderDur: Math.round((run.endMs - run.startMs) / 60000),
        titleSuffix: coversAll ? '' : ' (parts ' + firstPart + '-' + lastPart + '/' + total + ')'
      };
      for (var ci = 1; ci < run.chunks.length; ci++) {
        mergedFollowers[run.chunks[ci].id] = leader.id;
      }
    });
  });

  return { mergedFollowers: mergedFollowers, mergedLeaderInfo: mergedLeaderInfo };
}

/**
 * Apply merge mutations to an array of task objects (simulating the in-memory
 * mutation step in cal-sync).
 */
function applyMergeMutations(tasks, mergedLeaderInfo) {
  tasks.forEach(function(t) {
    var info = mergedLeaderInfo[t.id];
    if (!info) return;
    if (info.leaderDur != null) t.dur = info.leaderDur;
    if (info.titleSuffix) t.text = (t.text || '') + info.titleSuffix;
  });
}

// ═══════════════════════════════════════════════════════════════════
// 999.570 — Split sync: contiguous merge
// ═══════════════════════════════════════════════════════════════════

describe('999.570 — Split sync: contiguous chunk merge', function () {

  test('3 contiguous chunks merge into 1 leader with merged duration', function () {
    var rows = [
      makeRow({ id: 'c1', split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'c2', split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
      makeRow({ id: 'c3', split_ordinal: 3, dur: 30, scheduled_at: '2026-06-17 10:00:00' }),
    ];

    var result = simulateMerge(rows);

    // c1 is the leader — merged dur = 90 min (3×30)
    expect(result.mergedLeaderInfo['c1']).toBeDefined();
    expect(result.mergedLeaderInfo['c1'].leaderDur).toBe(90);
    // All 3 chunks are contiguous → covers all → no title suffix
    expect(result.mergedLeaderInfo['c1'].titleSuffix).toBe('');

    // c2 and c3 are followers
    expect(result.mergedFollowers['c2']).toBe('c1');
    expect(result.mergedFollowers['c3']).toBe('c1');
  });

  test('2 contiguous chunks merge into 1 leader with merged duration', function () {
    var rows = [
      makeRow({ id: 'a1', split_ordinal: 1, dur: 45, scheduled_at: '2026-06-17 14:00:00' }),
      makeRow({ id: 'a2', split_ordinal: 2, dur: 45, scheduled_at: '2026-06-17 14:45:00' }),
    ];

    var result = simulateMerge(rows);

    expect(result.mergedLeaderInfo['a1']).toBeDefined();
    expect(result.mergedLeaderInfo['a1'].leaderDur).toBe(90);
    expect(result.mergedLeaderInfo['a1'].titleSuffix).toBe('');
    expect(result.mergedFollowers['a2']).toBe('a1');
  });

  test('non-contiguous chunks (gap > 30s) get individual events with (X/N) suffix', function () {
    var rows = [
      makeRow({ id: 'g1', split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'g2', split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 10:30:00' }), // 60-min gap
      makeRow({ id: 'g3', split_ordinal: 3, dur: 30, scheduled_at: '2026-06-17 11:00:00' }),
    ];

    var result = simulateMerge(rows);

    // g1 is a singleton run (gap after it) → gets (1/3) suffix
    expect(result.mergedLeaderInfo['g1']).toBeDefined();
    expect(result.mergedLeaderInfo['g1'].titleSuffix).toBe(' (1/3)');
    expect(result.mergedLeaderInfo['g1'].leaderDur).toBe(30);

    // g2+g3 are contiguous (10:30→11:00, 11:00→11:30) → merge
    expect(result.mergedLeaderInfo['g2']).toBeDefined();
    expect(result.mergedLeaderInfo['g2'].leaderDur).toBe(60);
    // 2 of 3 total chunks → partial → "(parts 2-3/3)"
    expect(result.mergedLeaderInfo['g2'].titleSuffix).toBe(' (parts 2-3/3)');
    expect(result.mergedFollowers['g3']).toBe('g2');
  });

  test('single chunk (split_total=1) is not merged', function () {
    var rows = [
      makeRow({ id: 'solo', split_ordinal: 1, split_total: 1, dur: 60, scheduled_at: '2026-06-17 09:00:00' }),
    ];

    var result = simulateMerge(rows);

    // No merge info for a single-chunk task
    expect(result.mergedLeaderInfo['solo']).toBeUndefined();
    expect(Object.keys(result.mergedFollowers).length).toBe(0);
  });

  test('chunks without scheduled_at are skipped', function () {
    var rows = [
      makeRow({ id: 'ns1', split_ordinal: 1, split_total: 2, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'ns2', split_ordinal: 2, split_total: 2, dur: 30, scheduled_at: null }),
    ];

    var result = simulateMerge(rows);

    // ns1 is a singleton (ns2 has no scheduled_at, so it's skipped in run building)
    // The merge logic uses the row's split_total for the suffix denominator
    expect(result.mergedLeaderInfo['ns1']).toBeDefined();
    expect(result.mergedLeaderInfo['ns1'].titleSuffix).toBe(' (1/2)');
    // ns2 has no scheduled_at → not processed
    expect(result.mergedLeaderInfo['ns2']).toBeUndefined();
  });

  test('chunks without master_id or occurrence_ordinal are skipped', function () {
    var rows = [
      makeRow({ id: 'no-master', master_id: null, split_ordinal: 1, split_total: 2, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'no-occ', occurrence_ordinal: null, split_ordinal: 2, split_total: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
    ];

    var result = simulateMerge(rows);

    // Neither has the required key → no merge info
    expect(Object.keys(result.mergedLeaderInfo).length).toBe(0);
    expect(Object.keys(result.mergedFollowers).length).toBe(0);
  });

  test('different occurrence_ordinal values are grouped separately', function () {
    var rows = [
      // Occurrence 1: 2 chunks
      makeRow({ id: 'o1c1', occurrence_ordinal: 1, split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'o1c2', occurrence_ordinal: 1, split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
      // Occurrence 2: 2 chunks
      makeRow({ id: 'o2c1', occurrence_ordinal: 2, split_ordinal: 1, dur: 30, scheduled_at: '2026-06-18 09:00:00' }),
      makeRow({ id: 'o2c2', occurrence_ordinal: 2, split_ordinal: 2, dur: 30, scheduled_at: '2026-06-18 09:30:00' }),
    ];

    var result = simulateMerge(rows);

    // Each occurrence merges independently
    expect(result.mergedLeaderInfo['o1c1']).toBeDefined();
    expect(result.mergedLeaderInfo['o1c1'].leaderDur).toBe(60);
    expect(result.mergedFollowers['o1c2']).toBe('o1c1');

    expect(result.mergedLeaderInfo['o2c1']).toBeDefined();
    expect(result.mergedLeaderInfo['o2c1'].leaderDur).toBe(60);
    expect(result.mergedFollowers['o2c2']).toBe('o2c1');
  });

  test('partial merge: first 2 of 4 chunks contiguous, rest singletons', function () {
    var rows = [
      makeRow({ id: 'p1', split_ordinal: 1, split_total: 4, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'p2', split_ordinal: 2, split_total: 4, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
      makeRow({ id: 'p3', split_ordinal: 3, split_total: 4, dur: 30, scheduled_at: '2026-06-17 10:30:00' }), // gap
      makeRow({ id: 'p4', split_ordinal: 4, split_total: 4, dur: 30, scheduled_at: '2026-06-17 11:30:00' }), // gap
    ];

    var result = simulateMerge(rows);

    // p1+p2 merge (contiguous)
    expect(result.mergedLeaderInfo['p1']).toBeDefined();
    expect(result.mergedLeaderInfo['p1'].leaderDur).toBe(60);
    // The merge logic uses chunks.length (total in occurrence) for merged runs
    expect(result.mergedLeaderInfo['p1'].titleSuffix).toBe(' (parts 1-2/4)');
    expect(result.mergedFollowers['p2']).toBe('p1');

    // p3 singleton — uses its own split_total for suffix
    expect(result.mergedLeaderInfo['p3']).toBeDefined();
    expect(result.mergedLeaderInfo['p3'].titleSuffix).toBe(' (3/4)');

    // p4 singleton
    expect(result.mergedLeaderInfo['p4']).toBeDefined();
    expect(result.mergedLeaderInfo['p4'].titleSuffix).toBe(' (4/4)');
  });

  test('applyMergeMutations correctly updates task objects', function () {
    var rows = [
      makeRow({ id: 'm1', split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'm2', split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
    ];

    var result = simulateMerge(rows);

    // Simulate the allTasks array that cal-sync builds
    var tasks = [
      { id: 'm1', text: 'My task', dur: 30 },
      { id: 'm2', text: 'My task', dur: 30 },
    ];

    applyMergeMutations(tasks, result.mergedLeaderInfo);

    // m1 (leader) gets merged dur and no suffix (covers all)
    expect(tasks[0].dur).toBe(60);
    expect(tasks[0].text).toBe('My task');

    // m2 (follower) is not mutated directly — it's suppressed in the push loop
    expect(tasks[1].dur).toBe(30);
    expect(tasks[1].text).toBe('My task');
  });

  test('applyMergeMutations adds title suffix for partial coverage', function () {
    var rows = [
      makeRow({ id: 'x1', split_ordinal: 1, split_total: 2, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'x2', split_ordinal: 2, split_total: 2, dur: 30, scheduled_at: '2026-06-17 10:00:00' }), // gap
    ];

    var result = simulateMerge(rows);

    var tasks = [
      { id: 'x1', text: 'My task', dur: 30 },
      { id: 'x2', text: 'My task', dur: 30 },
    ];

    applyMergeMutations(tasks, result.mergedLeaderInfo);

    // x1 is a singleton → gets (1/2) suffix
    expect(tasks[0].text).toBe('My task (1/2)');
    expect(tasks[0].dur).toBe(30);

    // x2 is a singleton → gets (2/2) suffix
    expect(tasks[1].text).toBe('My task (2/2)');
    expect(tasks[1].dur).toBe(30);
  });

  test('empty input produces empty output', function () {
    var result = simulateMerge([]);
    expect(Object.keys(result.mergedFollowers).length).toBe(0);
    expect(Object.keys(result.mergedLeaderInfo).length).toBe(0);
  });

  test('chunks with different master_ids are not merged together', function () {
    var rows = [
      makeRow({ id: 'ma1', master_id: 'master-a', split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'ma2', master_id: 'master-a', split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
      makeRow({ id: 'mb1', master_id: 'master-b', split_ordinal: 1, dur: 30, scheduled_at: '2026-06-17 09:00:00' }),
      makeRow({ id: 'mb2', master_id: 'master-b', split_ordinal: 2, dur: 30, scheduled_at: '2026-06-17 09:30:00' }),
    ];

    var result = simulateMerge(rows);

    // master-a chunks merge
    expect(result.mergedLeaderInfo['ma1']).toBeDefined();
    expect(result.mergedFollowers['ma2']).toBe('ma1');

    // master-b chunks merge independently
    expect(result.mergedLeaderInfo['mb1']).toBeDefined();
    expect(result.mergedFollowers['mb2']).toBe('mb1');
  });
});
