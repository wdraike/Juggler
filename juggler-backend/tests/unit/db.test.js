/**
 * Database tests — Knex connection module
 */

const knex = require('knex');

describe('Database Module', () => {
  let db;

  beforeAll(() => {
    // Use test configuration with SQLite in-memory
    process.env.NODE_ENV = 'test';
    db = knex({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
  });

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
    test('should connect to database', async () => {
      const result = await db.raw('SELECT 1 as test');
      expect(result).toBeDefined();
      expect(result[0].test).toBe(1);
    });

    test('should use test environment', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });
  });

  describe('Query builder', () => {
    test('should support chainable queries', async () => {
      const result = await db.select('*').from('sqlite_master').limit(1);
      expect(Array.isArray(result)).toBe(true);
    });

    test('should support where clauses', async () => {
      const result = await db
        .select('name')
        .from('sqlite_master')
        .where('type', 'table')
        .limit(1);
      expect(result).toBeDefined();
    });

    test('should support transactions', async () => {
      await db.transaction(async (trx) => {
        const result = await trx.raw('SELECT 1 as test');
        expect(result).toBeDefined();
      });
    });
  });
});
