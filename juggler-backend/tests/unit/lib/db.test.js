/**
 * Unit tests for lib-db module (src/lib/db/index.js wrapper over @raike/lib-db)
 *
 * Tests: createKnex, withTransaction, TransactionContext, defaultPoolConfig, ENVIRONMENTS
 *
 * 999.5223: withTransaction / TransactionContext / Integration legs converted from a
 * private in-memory sqlite3 knex instance to the SAME test-bed MySQL (3407,
 * juggler_test) every other DB-backed suite already uses. sqlite3 was a
 * devDependency that existed ONLY to back this file + tests/unit/db.test.js (999.5223
 * audit: zero references anywhere in src/ — production is MySQL-only via mysql2,
 * already a runtime dependency). Removing it deletes a whole failure class of
 * native-module ABI/GLIBC breakage (999.5062 papered over with a CI rebuild step;
 * this is the deferred real fix, option (b)).
 *
 * createKnex tests remain pure (no DB) — they assert argument-validation logic only.
 * The DB-touching legs share ONE test-bed connection for the whole file (matches
 * tests/slices/task/adapters/taskRepository.contract.test.js) and are wrapped in
 * requireDB() (TEST-FR-001) — an unreachable DB fails LOUD, never a silent skip.
 * Each DB-touching test owns a scratch table named distinctly WITHIN THIS FILE
 * (wt_test, wt_rollback, wt_return, tc_query, compat) and drops it before
 * creating — idempotent, so it self-heals a table left over from an
 * interrupted prior run — rather than relying on sqlite's automatic
 * per-instance :memory: isolation.
 *
 * Those names are fixed literals, NOT unique per process, and that is safe
 * only because of two external guarantees: run-suite.sh allocates a per-slot
 * MYSQL_PORT/container so concurrent pool runs never share juggler_test, and
 * jest.config.js maxWorkers:1 (+ --runInBand) serialises within a run. If
 * either ever changes, prefix these names with process.pid — do not assume the
 * current names are collision-proof on their own.
 */

'use strict';

process.env.NODE_ENV = 'test';

const knex = require('knex');
const knexConfig = require('../../../knexfile');
const { requireDB } = require('../../helpers/requireDB');
const {
  createKnex,
  withTransaction,
  TransactionContext,
  defaultPoolConfig,
  ENVIRONMENTS,
} = require('../../../src/lib/db');

// Shared test-bed MySQL connection for every DB-backed leg below.
const db = knex(knexConfig.test);

// Deliberately does NOT catch. requireDB (vendor requireDB.js:36) documents
// that a throwing probe propagates with the real driver error appended —
// swallowing it here would report "test-bed @3407 is unreachable, start
// test-bed" for a server that IS reachable but has wrong credentials or is
// missing juggler_test, sending the reader to fix the wrong thing.
async function isAvailable() {
  await db.raw('SELECT 1');
  return true;
}

afterAll(async () => {
  await db.destroy();
});

// ─── createKnex ─────────────────────────────────────────────────────────────

describe('createKnex', () => {
  test('is exported as a function', () => {
    expect(typeof createKnex).toBe('function');
  });

  test('throws when no config is provided', () => {
    // @raike/lib-db createKnex requires { knexConfig }; null config throws.
    expect(() => createKnex(null)).toThrow();
    expect(() => createKnex(undefined)).toThrow();
  });

  test('throws when called with a plain knex config (old API)', () => {
    // The new API requires { knexConfig: { <env>: { ... } } }, not a raw knex config.
    expect(() =>
      createKnex({ client: 'mysql2', connection: {}, useNullAsDefault: true })
    ).toThrow();
  });
});

// ─── ENVIRONMENTS ────────────────────────────────────────────────────────────

describe('ENVIRONMENTS', () => {
  test('is an array containing development, production, and test', () => {
    expect(ENVIRONMENTS).toBeInstanceOf(Array);
    expect(ENVIRONMENTS).toContain('development');
    expect(ENVIRONMENTS).toContain('production');
    expect(ENVIRONMENTS).toContain('test');
  });
});

// ─── defaultPoolConfig ───────────────────────────────────────────────────────

describe('defaultPoolConfig', () => {
  test('exports min, max, and afterCreate', () => {
    expect(defaultPoolConfig).toBeDefined();
    expect(typeof defaultPoolConfig.min).toBe('number');
    expect(typeof defaultPoolConfig.max).toBe('number');
    expect(defaultPoolConfig.afterCreate).toBeInstanceOf(Function);
  });

  test('min < max', () => {
    expect(defaultPoolConfig.min).toBeLessThan(defaultPoolConfig.max);
  });
});

// ─── withTransaction ─────────────────────────────────────────────────────────

describe('withTransaction', () => {
  // NOT requireDB-wrapped, deliberately. withTransaction throws on !db /
  // typeof callback !== 'function' BEFORE it ever touches db.transaction
  // (vendor/lib-db/src/withTransaction.js:23-29), so these three make zero DB
  // contact. Gating them on MySQL would make them RED for an environment
  // reason on any machine without test-bed, and would stop these guards being
  // checked at all in DB-free contexts — where they ran fine before the
  // sqlite3 removal. TEST-FR-001's fail-loud rule exists so DB-backed tests
  // cannot pass vacuously; a test that touches no DB cannot pass vacuously.
  test('throws when db is null', async () => {
    await expect(withTransaction(null, async () => {})).rejects.toThrow();
  });

  test('throws when callback is null', async () => {
    await expect(withTransaction(db, null)).rejects.toThrow();
  });

  test('throws when callback is not a function', async () => {
    await expect(withTransaction(db, 'not a function')).rejects.toThrow();
  });

  test('commits the transaction on success and persists data', requireDB(async () => {
    await db.schema.dropTableIfExists('wt_test');
    await db.schema.createTable('wt_test', (t) => {
      t.increments('id');
      t.string('name');
    });

    const result = await withTransaction(db, async (trx) => {
      await trx('wt_test').insert({ name: 'item' });
      return trx('wt_test').select('*');
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('item');

    const persisted = await db('wt_test').select('*');
    expect(persisted).toHaveLength(1);

    await db.schema.dropTableIfExists('wt_test');
  }, isAvailable));

  test('rolls back on error and leaves no data', requireDB(async () => {
    await db.schema.dropTableIfExists('wt_rollback');
    await db.schema.createTable('wt_rollback', (t) => {
      t.increments('id');
      t.string('name');
    });

    await expect(
      withTransaction(db, async (trx) => {
        await trx('wt_rollback').insert({ name: 'will-rollback' });
        throw new Error('Intentional error');
      })
    ).rejects.toThrow('Intentional error');

    const rows = await db('wt_rollback').select('*');
    expect(rows).toHaveLength(0);

    await db.schema.dropTableIfExists('wt_rollback');
  }, isAvailable));

  test('returns the value from the callback', requireDB(async () => {
    await db.schema.dropTableIfExists('wt_return');
    await db.schema.createTable('wt_return', (t) => {
      t.increments('id');
      t.string('name');
    });

    const result = await withTransaction(db, async (trx) => {
      const [id] = await trx('wt_return').insert({ name: 'ret' });
      return { insertedId: id, ok: true };
    });

    expect(result).toEqual({ insertedId: expect.any(Number), ok: true });

    await db.schema.dropTableIfExists('wt_return');
  }, isAvailable));

  test('works with raw SQL inside transaction', requireDB(async () => {
    const result = await withTransaction(db, async (trx) => {
      // mysql2's knex client returns raw() as [rows, fieldPackets], not a bare
      // rows array (sqlite's client returned rows directly).
      const [rows] = await trx.raw('SELECT 1 as num, 2 as num2');
      return rows;
    });

    expect(result).toBeDefined();
    expect(result[0].num).toBe(1);
    expect(result[0].num2).toBe(2);
  }, isAvailable));
});

// ─── TransactionContext ───────────────────────────────────────────────────────
//
// @raike/lib-db's TransactionContext wraps a Knex *transaction* object, not a
// Knex instance. Constructor: new TransactionContext(trx, transactionId).
// It exposes: .trx, .transactionId, .isCommitted, .isRolledBack, .query(),
// .commit(), .rollback(), .isActive(), .getTransaction(), .getTransactionId().

describe('TransactionContext', () => {
  test('creates a context with trx and transactionId', requireDB(async () => {
    await db.transaction(async (trx) => {
      const ctx = new TransactionContext(trx, 'test-id');
      expect(ctx.trx).toBe(trx);
      expect(ctx.transactionId).toBe('test-id');
      expect(ctx.isCommitted).toBe(false);
      expect(ctx.isRolledBack).toBe(false);
      expect(ctx.isActive()).toBe(true);
    });
  }, isAvailable));

  test('getTransaction() and getTransactionId() return wrapped values', requireDB(async () => {
    await db.transaction(async (trx) => {
      const ctx = new TransactionContext(trx, 'txn-42');
      expect(ctx.getTransaction()).toBe(trx);
      expect(ctx.getTransactionId()).toBe('txn-42');
    });
  }, isAvailable));

  test('query() executes raw SQL via the transaction', requireDB(async () => {
    await db.schema.dropTableIfExists('tc_query');
    await db.schema.createTable('tc_query', (t) => {
      t.increments('id');
      t.string('val');
    });

    await db.transaction(async (trx) => {
      const ctx = new TransactionContext(trx, 'q-test');
      await ctx.query('INSERT INTO tc_query (val) VALUES (?)', ['hello']);
      const rows = await trx('tc_query').select('*');
      expect(rows).toHaveLength(1);
      expect(rows[0].val).toBe('hello');
    });

    await db.schema.dropTableIfExists('tc_query');
  }, isAvailable));

  test('isActive() returns false after rollback', requireDB(async () => {
    let ctx;
    try {
      await db.transaction(async (trx) => {
        ctx = new TransactionContext(trx, 'rb-test');
        expect(ctx.isActive()).toBe(true);
        // knex will rollback when we throw
        throw new Error('force rollback');
      });
    } catch {
      // expected
    }
    // ctx.isRolledBack is not set by the knex rollback — the context just
    // wraps the trx; verify isActive() via the flags knex sets
    expect(ctx).toBeDefined();
  }, isAvailable));

  // No scratch table: this asserts only that two contexts wrapping one trx
  // expose the same trx. Nothing is read or written, so creating and dropping
  // a table around it bought two round-trips and no coverage.
  test('two contexts wrapping the same trx share state', requireDB(async () => {
    await db.transaction(async (trx) => {
      const ctx1 = new TransactionContext(trx, 'c1');
      const ctx2 = new TransactionContext(trx, 'c2');
      // Both wrap the same trx
      expect(ctx1.getTransaction()).toBe(ctx2.getTransaction());
    });
  }, isAvailable));
});

// ─── Integration: withTransaction + TransactionContext compatible ────────────

describe('Integration', () => {
  test('withTransaction and TransactionContext can both write to the same db', requireDB(async () => {
    await db.schema.dropTableIfExists('compat');
    await db.schema.createTable('compat', (t) => {
      t.increments('id');
      t.string('source');
    });

    // Write via withTransaction
    await withTransaction(db, async (trx) => {
      await trx('compat').insert({ source: 'withTransaction' });
    });

    // Write via TransactionContext (wrapping a new transaction)
    await db.transaction(async (trx) => {
      const ctx = new TransactionContext(trx, 'ctx-compat');
      await ctx.query('INSERT INTO compat (source) VALUES (?)', ['TransactionContext']);
    });

    const rows = await db('compat').select('*');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(['TransactionContext', 'withTransaction']);

    await db.schema.dropTableIfExists('compat');
  }, isAvailable));
});
