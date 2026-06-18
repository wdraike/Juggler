/**
 * Recurrence-read fold (999.354 promotion 3/3) — InMemoryTaskRepository.
 *
 * The updateTaskStatus rolling-anchor + split-sibling reads were direct getDb()
 * calls in the facade; they are now port methods (getMasterById /
 * getSplitSiblingIds). These lock the InMemory adapter's behavior so the seam is
 * testable without a DB.
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');

function makeRepo(rows) {
  var repo = new InMemoryTaskRepository();
  // InMemoryTaskRepository seeds via its constructor/insert; use insertTask.
  return Promise.all(rows.map(function (r) { return repo.insertTask(r); })).then(function () { return repo; });
}

describe('InMemoryTaskRepository recurrence reads (999.354 3/3)', function () {
  var BASE = { dur: 30, pri: 'P3', occurrence_ordinal: 0, split_ordinal: 0, split_total: 1,
    created_at: new Date(), updated_at: new Date() };

  test('getMasterById returns the raw master row (tenancy-scoped), null otherwise', function () {
    return makeRepo([
      Object.assign({ id: 'm1', master_id: 'm1', user_id: 'u1', text: 'M', rolling_anchor: '2026-06-18' }, BASE)
    ]).then(function (repo) {
      return repo.getMasterById('m1', 'u1').then(function (row) {
        expect(row).not.toBeNull();
        expect(row.id).toBe('m1');
        expect(row.rolling_anchor).toBe('2026-06-18'); // the column the rolling-anchor path needs
        return repo.getMasterById('m1', 'other-user');
      }).then(function (row) {
        expect(row).toBeNull(); // tenancy-scoped
        return repo.getMasterById('nope', 'u1');
      }).then(function (row) {
        expect(row).toBeNull();
      });
    });
  });

  test('getSplitSiblingIds returns same-occurrence siblings excluding the given id', function () {
    return makeRepo([
      Object.assign({ id: 's0', master_id: 'mm', user_id: 'u1', text: 'c0' }, BASE, { split_ordinal: 0 }),
      Object.assign({ id: 's1', master_id: 'mm', user_id: 'u1', text: 'c1' }, BASE, { split_ordinal: 1 }),
      Object.assign({ id: 's2', master_id: 'mm', user_id: 'u1', text: 'c2' }, BASE, { split_ordinal: 2 }),
      // different occurrence — must NOT be returned
      Object.assign({ id: 'x0', master_id: 'mm', user_id: 'u1', text: 'o2', occurrence_ordinal: 1 }, BASE, { occurrence_ordinal: 1 })
    ]).then(function (repo) {
      return repo.getSplitSiblingIds('u1', 'mm', 0, 's1').then(function (rows) {
        var ids = rows.map(function (r) { return r.id; }).sort();
        expect(ids).toEqual(['s0', 's2']);   // siblings minus the excluded s1; x0 excluded (occurrence 1)
      });
    });
  });
});
