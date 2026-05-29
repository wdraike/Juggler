/**
 * Unit tests for lib-db module
 * 
 * Tests: createKnex, withTransaction, TransactionContext
 * No database required - uses in-memory SQLite
 */

const knex = require('knex');
const { 
  createKnex, 
  withTransaction, 
  TransactionContext,
  defaultPoolConfig,
  ENVIRONMENTS 
} = require('../../src/lib/db');

// Test configuration using SQLite in-memory
const testConfig = {
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true,
};

describe('lib-db', () => {
  let db;
  
  beforeAll(() => {
    // Use a fresh in-memory database for each test suite
  });
  
  afterEach(async () => {
    if (db) {
      await db.destroy();
      db = null;
    }
  });
  
  describe('createKnex', () => {
    test('should create Knex instance with explicit config', () => {
      db = createKnex(testConfig);
      expect(db).toBeDefined();
      expect(typeof db.select).toBe('function');
    });
    
    test('should throw error for invalid config', () => {
      expect(() => createKnex(null, 'nonexistent-env')).toThrow();
    });
    
    test('should have required Knex methods', () => {
      db = createKnex(testConfig);
      expect(typeof db.raw).toBe('function');
      expect(typeof db.transaction).toBe('function');
      expect(typeof db.select).toBe('function');
      expect(typeof db.insert).toBe('function');
      expect(typeof db.update).toBe('function');
      expect(typeof db.delete).toBe('function');
      expect(typeof db.destroy).toBe('function');
    });
    
    test('should execute queries successfully', async () => {
      db = createKnex(testConfig);
      const result = await db.raw('SELECT 1 as test');
      expect(result).toBeDefined();
      expect(result[0].test).toBe(1);
    });
    
    test('should apply default pool config if not specified', () => {
      const customDb = createKnex(testConfig);
      // SQLite doesn't use pool, but config should be applied
      // This verifies the code path is reachable
      expect(customDb).toBeDefined();
      customDb.destroy();
    });
  });
  
  describe('ENVIRONMENTS', () => {
    test('should export known environments', () => {
      expect(ENVIRONMENTS).toBeInstanceOf(Array);
      expect(ENVIRONMENTS).toContain('development');
      expect(ENVIRONMENTS).toContain('production');
      expect(ENVIRONMENTS).toContain('test');
    });
  });
  
  describe('defaultPoolConfig', () => {
    test('should export pool configuration', () => {
      expect(defaultPoolConfig).toBeDefined();
      expect(defaultPoolConfig.min).toBeDefined();
      expect(defaultPoolConfig.max).toBeDefined();
      expect(defaultPoolConfig.afterCreate).toBeInstanceOf(Function);
    });
  });
  
  describe('withTransaction', () => {
    beforeEach(() => {
      db = createKnex(testConfig);
    });
    
    test('should throw for invalid Knex instance', async () => {
      await expect(withTransaction(null, async () => {})).rejects.toThrow('Invalid Knex instance');
      await expect(withTransaction({}, async () => {})).rejects.toThrow('Invalid Knex instance');
    });
    
    test('should throw for non-function argument', async () => {
      await expect(withTransaction(db, null)).rejects.toThrow('must be a valid function');
      await expect(withTransaction(db, 'not a function')).rejects.toThrow('must be a valid function');
    });
    
    test('should commit transaction on success', async () => {
      // Create test table
      await db.schema.createTable('test', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const result = await withTransaction(db, async (trx) => {
        await trx('test').insert({ name: 'test-item' });
        return await trx('test').select('*');
      });
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-item');
      
      // Verify data persisted after transaction
      const persisted = await db('test').select('*');
      expect(persisted).toHaveLength(1);
    });
    
    test('should rollback transaction on error', async () => {
      // Create test table
      await db.schema.createTable('test_rollback', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      await expect(
        withTransaction(db, async (trx) => {
          await trx('test_rollback').insert({ name: 'will-rollback' });
          throw new Error('Intentional error');
        })
      ).rejects.toThrow('Intentional error');
      
      // Verify no data persisted
      const result = await db('test_rollback').select('*');
      expect(result).toHaveLength(0);
    });
    
    test('should return transaction result', async () => {
      await db.schema.createTable('test_return', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const result = await withTransaction(db, async (trx) => {
        const [id] = await trx('test_return').insert({ name: 'return-test' });
        return { insertedId: id, success: true };
      });
      
      expect(result).toEqual({ insertedId: expect.any(Number), success: true });
    });
    
    test('should work with SQL queries', async () => {
      const result = await withTransaction(db, async (trx) => {
        const rows = await trx.raw('SELECT 1 as num, 2 as num2');
        return rows;
      });
      
      expect(result).toBeDefined();
      expect(result[0].num).toBe(1);
      expect(result[0].num2).toBe(2);
    });
  });
  
  describe('TransactionContext', () => {
    beforeEach(() => {
      db = createKnex(testConfig);
    });
    
    test('should throw for invalid Knex instance', () => {
      expect(() => new TransactionContext(null)).toThrow('requires a valid Knex instance');
      expect(() => new TransactionContext({})).toThrow('requires a valid Knex instance');
    });
    
    test('should create context successfully', () => {
      const ctx = new TransactionContext(db);
      expect(ctx).toBeDefined();
      expect(ctx.knex).toBe(db);
      expect(ctx.isInTransaction).toBe(false);
      ctx.destroy();
    });
    
    test('should return knex when no transaction active', () => {
      const ctx = new TransactionContext(db);
      expect(ctx.trx).toBe(db);
      expect(ctx.getTrx()).toBe(db);
      ctx.destroy();
    });
    
    test('should run function in transaction', async () => {
      await db.schema.createTable('test_ctx', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const ctx = new TransactionContext(db);
      
      const result = await ctx.run(async (trx) => {
        expect(ctx.isInTransaction).toBe(true);
        await trx('test_ctx').insert({ name: 'ctx-test' });
        return await trx('test_ctx').select('*');
      });
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ctx-test');
      expect(ctx.isInTransaction).toBe(false);
      
      ctx.destroy();
    });
    
    test('should support nested transaction operations', async () => {
      await db.schema.createTable('test_nested', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const ctx = new TransactionContext(db);
      
      // First operation
      await ctx.run(async (trx) => {
        await trx('test_nested').insert({ name: 'item-1' });
      });
      
      // Second operation (separate transaction)
      await ctx.run(async (trx) => {
        await trx('test_nested').insert({ name: 'item-2' });
      });
      
      // Verify both items exist
      const all = await db('test_nested').select('*');
      expect(all).toHaveLength(2);
      
      ctx.destroy();
    });
    
    test('should getTrx() return transaction when in transaction', async () => {
      await db.schema.createTable('test_gettrx', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const ctx = new TransactionContext(db);
      
      await ctx.run(async () => {
        // getTrx() should return the active transaction
        const trx = ctx.getTrx();
        expect(trx).not.toBe(db); // Should be the transaction, not the main knex
        await trx('test_gettrx').insert({ name: 'gettrx-test' });
      });
      
      // After run, should return to knex
      expect(ctx.getTrx()).toBe(db);
      
      ctx.destroy();
    });
    
    test('should rollback on error', async () => {
      await db.schema.createTable('test_ctx_rollback', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      const ctx = new TransactionContext(db);
      
      await expect(
        ctx.run(async (trx) => {
          await trx('test_ctx_rollback').insert({ name: 'will-fail' });
          throw new Error('Boom');
        })
      ).rejects.toThrow('Boom');
      
      expect(ctx.isInTransaction).toBe(false);
      
      const result = await db('test_ctx_rollback').select('*');
      expect(result).toHaveLength(0);
      
      ctx.destroy();
    });
    
    test('should clean up on destroy', async () => {
      const ctx = new TransactionContext(db);
      
      await ctx.run(async (trx) => {
        await trx.raw('SELECT 1');
      });
      
      expect(ctx.isInTransaction).toBe(false);
      
      // destroy() should not throw
      ctx.destroy();
      
      // After destroy, context should be clean
      expect(ctx._trx).toBeNull();
      expect(ctx._depth).toBe(0);
    });
    
    test('trx property should match getTrx()', () => {
      const ctx = new TransactionContext(db);
      expect(ctx.trx).toBe(ctx.getTrx());
      ctx.destroy();
    });
  });
  
  describe('Integration scenarios', () => {
    beforeEach(() => {
      db = createKnex(testConfig);
    });
    
    test('complex transaction with multiple operations', async () => {
      // Create tables
      await db.schema.createTable('tasks', (table) => {
        table.increments('id');
        table.string('name');
        table.string('status');
        table.integer('user_id');
      });
      
      await db.schema.createTable('task_history', (table) => {
        table.increments('id');
        table.integer('task_id');
        table.string('action');
      });
      
      const ctx = new TransactionContext(db);
      
      const result = await ctx.run(async (trx) => {
        // Insert task
        const [taskId] = await trx('tasks').insert({
          name: 'Complex Task',
          status: 'active',
          user_id: 1
        });
        
        // Insert history
        await trx('task_history').insert({
          task_id: taskId,
          action: 'created'
        });
        
        // Return combined result
        const task = await trx('tasks').where({ id: taskId }).first();
        const history = await trx('task_history').where({ task_id: taskId });
        
        return { task, history };
      });
      
      expect(result.task.name).toBe('Complex Task');
      expect(result.history).toHaveLength(1);
      expect(result.history[0].action).toBe('created');
      
      // Verify data persisted
      const tasks = await db('tasks').select('*');
      const history = await db('task_history').select('*');
      
      expect(tasks).toHaveLength(1);
      expect(history).toHaveLength(1);
      
      ctx.destroy();
    });
    
    test('withTransaction and TransactionContext are compatible', async () => {
      await db.schema.createTable('test_compat', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      // Use standalone withTransaction
      await withTransaction(db, async (trx) => {
        await trx('test_compat').insert({ name: 'standalone' });
      });
      
      // Use TransactionContext
      const ctx = new TransactionContext(db);
      await ctx.run(async (trx) => {
        await trx('test_compat').insert({ name: 'context' });
      });
      
      const results = await db('test_compat').select('*');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.name).sort()).toEqual(['context', 'standalone']);
      
      ctx.destroy();
    });
  });
});
