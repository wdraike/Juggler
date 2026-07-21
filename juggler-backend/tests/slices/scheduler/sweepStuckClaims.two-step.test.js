'use strict';

/**
 * 999.2093 — sweepStuckClaims deadlock shape.
 *
 * The old sweep was ONE range UPDATE over idx_claimed_at
 * (`claimed_by IS NOT NULL AND claimed_at < cutoff`); its next-key locks
 * deadlocked against concurrent point claim/release UPDATEs walking the
 * user_id index (ER_LOCK_DEADLOCK 1213 — caught by pollOnce, self-healing,
 * but 10×/day of log noise under load). The fixed sweep is TWO-step:
 *   1. lock-free consistent-read SELECT of stale candidate ids;
 *   2. UPDATE scoped to those PKs — point locks only, no gap locks — with the
 *      staleness predicate REPEATED so a row re-claimed between the steps
 *      (fresh claimed_at) is left untouched.
 */

const SchedulerQueueRepository = require('../../../src/slices/scheduler/adapters/SchedulerQueueRepository');

function makeDb(candidateRows, updateResult) {
  const ops = [];
  const db = (table) => {
    const op = { table, wheres: [], selected: null, whereIn: null, update: null };
    ops.push(op);
    const qb = {
      select: (...cols) => { op.selected = cols; return qb; },
      whereNotNull: (c) => { op.wheres.push(['whereNotNull', c]); return qb; },
      whereRaw: (s) => { op.wheres.push(['whereRaw', s]); return qb; },
      whereIn: (col, vals) => { op.whereIn = [col, vals]; return qb; },
      update: (changes) => { op.update = changes; return qb; },
      then: (resolve, reject) =>
        Promise.resolve(op.update ? updateResult : candidateRows).then(resolve, reject),
    };
    return qb;
  };
  db.__ops = ops;
  return db;
}

test('two-step: lock-free SELECT of stale ids, then a PK-scoped UPDATE — never a bare range UPDATE', async () => {
  const db = makeDb([{ id: 3 }, { id: 7 }], 2);
  const repo = new SchedulerQueueRepository();

  const swept = await repo.sweepStuckClaims(db);
  expect(swept).toBe(2);

  expect(db.__ops).toHaveLength(2);
  const [read, write] = db.__ops;

  // Step 1: plain SELECT (no update on this builder) with the stale predicate.
  expect(read.selected).toEqual(['id']);
  expect(read.update).toBeNull();
  expect(read.wheres).toEqual(expect.arrayContaining([
    ['whereNotNull', 'claimed_by'],
    ['whereRaw', expect.stringContaining('claimed_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)')],
  ]));

  // Step 2: UPDATE scoped to the selected PKs (point locks), stale predicate
  // repeated so a re-claimed row is untouched.
  expect(write.whereIn).toEqual(['id', [3, 7]]);
  expect(write.wheres).toEqual(expect.arrayContaining([
    ['whereNotNull', 'claimed_by'],
    ['whereRaw', expect.stringContaining('claimed_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)')],
  ]));
  expect(write.update).toMatchObject({ claimed_by: null, claimed_at: null, updated_by: 'jest' });
});

test('no stale candidates → zero, and NO second statement is issued', async () => {
  const db = makeDb([], 0);
  const repo = new SchedulerQueueRepository();
  const swept = await repo.sweepStuckClaims(db);
  expect(swept).toBe(0);
  expect(db.__ops).toHaveLength(1);
  expect(db.__ops[0].update).toBeNull();
});
