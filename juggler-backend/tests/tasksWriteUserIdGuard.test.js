/**
 * Unit tests for the tenancy-invariant guard in src/lib/tasks-write.js
 * (jug-task-write-mandatory-userid / 999.550).
 *
 * Pure unit test — NO live DB. The stub `dbOrTrx` throws if the guard ever lets
 * execution reach a DB call, proving the guard rejects an owner-less row BEFORE
 * any write. A valid (owner-scoped) row is allowed past the guard.
 */
var { insertTask, insertTasksBatch } = require('../src/lib/tasks-write');

// A db handle that explodes the moment it is invoked — if the guard fails to
// short-circuit, the test sees this distinctive error instead of the guard error.
function explodingDb() {
  throw new Error('DB-REACHED: guard did not short-circuit');
}

describe('tasks-write tenancy invariant (999.550)', () => {
  describe('insertTask requires row.user_id', () => {
    test('rejects a row with no user_id (before any DB call)', async () => {
      await expect(insertTask(explodingDb, { id: 't1', text: 'x' }))
        .rejects.toThrow(/userId is required/);
    });

    test('rejects a row with null user_id', async () => {
      await expect(insertTask(explodingDb, { id: 't1', text: 'x', user_id: null }))
        .rejects.toThrow(/userId is required/);
    });

    test('rejects a row with empty-string user_id', async () => {
      await expect(insertTask(explodingDb, { id: 't1', text: 'x', user_id: '' }))
        .rejects.toThrow(/userId is required/);
    });

    test('a valid owner-scoped row passes the guard (reaches the DB stub)', async () => {
      // user_id present → guard passes → hits explodingDb → DB-REACHED, NOT the guard error.
      await expect(insertTask(explodingDb, { id: 't1', text: 'x', user_id: 'u1' }))
        .rejects.toThrow(/DB-REACHED/);
    });
  });

  describe('insertTasksBatch requires user_id on every row', () => {
    test('rejects when any row lacks user_id (names the offending index)', async () => {
      var rows = [
        { id: 'a', text: 'x', user_id: 'u1' },
        { id: 'b', text: 'y' } // missing user_id
      ];
      await expect(insertTasksBatch(explodingDb, rows))
        .rejects.toThrow(/insertTasksBatch \(row 1\): userId is required/);
    });

    test('all-owned rows pass the guard (reach the DB stub)', async () => {
      var rows = [
        { id: 'a', text: 'x', user_id: 'u1' },
        { id: 'b', text: 'y', user_id: 'u1' }
      ];
      await expect(insertTasksBatch(explodingDb, rows))
        .rejects.toThrow(/DB-REACHED/);
    });

    test('empty batch is a no-op (no throw)', async () => {
      await expect(insertTasksBatch(explodingDb, [])).resolves.toBeUndefined();
    });
  });
});
