'use strict';

/**
 * 999.1576 inc.4 (harrison BLOCK-1) — first-login provisioning must stamp.
 *
 * users.created_by/updated_by are NOT NULL with no default; insertUser without
 * stampInsert made every first login 500 (masked in suites by the armed 'jest'
 * default + an InMemory repo in the provisioning test). Pin the real repo's
 * insert row shape.
 */

const KnexUserRepository = require('../../src/slices/user-config/adapters/KnexUserRepository');
const { runWithActor, _runWithoutActor } = require('../../src/lib/audit-context');

function makeDb() {
  const inserts = [];
  const dbFn = (table) => ({
    insert: (row) => {
      inserts.push({ table, row });
      return Promise.resolve([1]);
    },
  });
  dbFn.__inserts = inserts;
  return dbFn;
}

test('insertUser stamps created_by/updated_by from the ambient actor (JWT sub)', async () => {
  const db = makeDb();
  const repo = new KnexUserRepository({ db });
  await runWithActor('user-new-1', () =>
    repo.insertUser({ id: 'user-new-1', email: 'new@test.com', timezone: 'UTC' })
  );
  expect(db.__inserts).toHaveLength(1);
  expect(db.__inserts[0].table).toBe('users');
  expect(db.__inserts[0].row.created_by).toBe('user-new-1');
  expect(db.__inserts[0].row.updated_by).toBe('user-new-1');
});

test('insertUser with no context and no armed default throws — never an unattributed users row', async () => {
  const db = makeDb();
  const repo = new KnexUserRepository({ db });
  await _runWithoutActor(async () => {
    await expect(
      Promise.resolve().then(() => repo.insertUser({ id: 'u', email: 'x@test.com' }))
    ).rejects.toThrow(/no actor established/);
  });
  expect(db.__inserts).toHaveLength(0);
});
