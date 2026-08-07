/**
 * Database tests — Knex connection module (src/db.js → lib/db.getDefaultDb())
 *
 * 999.5223: converted from a private in-memory sqlite3 knex instance
 * (`knex({ client: 'sqlite3', connection: ':memory:' })`) to the SAME test-bed
 * MySQL (3407, juggler_test) every other DB-backed suite already uses. sqlite3
 * was a devDependency that existed ONLY to back this file + tests/unit/lib/db.test.js
 * (999.5223 audit: zero references anywhere in src/ — production is MySQL-only via
 * mysql2, already a runtime dependency). Removing it deletes a whole failure class
 * of native-module ABI/GLIBC breakage (999.5062 papered over with a CI rebuild
 * step; this is the deferred real fix, option (b)).
 *
 * This now exercises the REAL production connection module (src/db.js, which
 * re-exports lib/db's getDefaultDb() singleton) rather than a throwaway private
 * instance, so it also guards that module actually builds a working connection.
 * DB-touching tests are wrapped in requireDB() (TEST-FR-001) — an unreachable
 * test-bed DB fails LOUD, never a silent skip.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { requireDB } = require('../helpers/requireDB');

describe('Database Module', () => {
  let db;

  beforeAll(() => {
    db = require('../../src/db');
  });

  // Deliberately does NOT catch — see the twin note in tests/unit/lib/db.test.js:
  // swallowing the driver error misreports a reachable-but-misconfigured server
  // as "test-bed is down".
  async function isAvailable() {
    await db.raw('SELECT 1');
    return true;
  }

  // src/db is the shared production connection module, so its pool (knexfile
  // pool:{min:1,max:5}) outlives this suite unless we close it. jest.config
  // forceExit:true papers over it, but the previous sqlite version had an
  // explicit teardown and dropping it was an unintended regression.
  afterAll(async () => {
    await db.destroy();
  });

  describe('Module exports', () => {
    test('should export a knex instance', () => {
      expect(db).toBeDefined();
      expect(typeof db.select).toBe('function');
    });

    test('should have destroy method', () => {
      expect(typeof db.destroy).toBe('function');
    });

    test('should have raw method', () => {
      expect(typeof db.raw).toBe('function');
    });
  });

  describe('Connection', () => {
    test('should connect to database', requireDB(async () => {
      // mysql2's knex client returns raw() as [rows, fieldPackets], not a bare
      // rows array (sqlite's client returned rows directly — the shape this
      // test previously assumed).
      const [rows] = await db.raw('SELECT 1 as test');
      expect(rows).toBeDefined();
      expect(rows[0].test).toBe(1);
    }, isAvailable));

    test('should use test environment', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });
  });

  describe('Query builder', () => {
    test('should support chainable queries', requireDB(async () => {
      const result = await db.select('table_name').from('information_schema.tables').limit(1);
      expect(Array.isArray(result)).toBe(true);
    }, isAvailable));

    test('should support where clauses', requireDB(async () => {
      const result = await db
        .select('table_name')
        .from('information_schema.tables')
        .where('table_schema', db.raw('DATABASE()'))
        .limit(1);
      expect(result).toBeDefined();
    }, isAvailable));

    test('should support transactions', requireDB(async () => {
      await db.transaction(async (trx) => {
        const [rows] = await trx.raw('SELECT 1 as test');
        expect(rows).toBeDefined();
      });
    }, isAvailable));
  });
});
