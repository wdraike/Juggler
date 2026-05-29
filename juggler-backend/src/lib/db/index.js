/**
 * lib-db - Database utilities for Juggler
 * 
 * Factory-based database utilities replacing the singleton pattern.
 * Provides:
 * - createKnex(config): Factory function for Knex instances
 * - withTransaction(knex, fn): Transaction helper with auto-commit/rollback
 * - TransactionContext: Class for managing transaction state
 * 
 * @module lib/db
 */

const knex = require('knex');
const defaultKnexfile = require('../../../knexfile.js');

/**
 * Default pool configuration with connection health validation
 * @type {Object}
 */
const defaultPoolConfig = {
  min: 2,
  max: 10,
  acquireTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 200,
  // Validate connection on checkout — catches silently dropped connections
  afterCreate: function(conn, done) {
    conn.query('SET SESSION wait_timeout=28800', function(err) {
      if (err) return done(err, conn);
      conn.query('SELECT 1', function(err2) {
        done(err2, conn);
      });
    });
  }
};

/**
 * Environment configurations from knexfile
 * @type {Object}
 */
const ENVIRONMENTS = ['development', 'production', 'test'];

/**
 * Create a new Knex instance from configuration
 * 
 * @param {Object} [config] - Knex configuration (optional, uses knexfile if not provided)
 * @param {string} [environment] - Environment to use (defaults to NODE_ENV or 'development')
 * @returns {import('knex').Knex} Configured Knex instance
 * @throws {Error} If no configuration found for environment
 * 
 * @example
 * // Use default configuration from knexfile
 * const db = createKnex();
 * 
 * @example
 * // Use specific environment
 * const testDb = createKnex(null, 'test');
 * 
 * @example
 * // Use custom config
 * const customDb = createKnex({ client: 'sqlite3', connection: ':memory:' });
 */
function createKnex(config, environment) {
  const env = environment || process.env.NODE_ENV || 'development';
  
  // If custom config provided, use it directly
  if (config && typeof config === 'object') {
    // Apply default pool config if not explicitly set
    if (!config.pool) {
      config.pool = defaultPoolConfig;
    }
    return knex(config);
  }
  
  // Otherwise use knexfile configuration
  const knexConfig = defaultKnexfile[env];
  
  if (!knexConfig) {
    throw new Error(`No database configuration found for environment: ${env}`);
  }
  
  return knex(knexConfig);
}

/**
 * Execute a function within a database transaction
 * 
 * Automatically commits if the function returns successfully,
 * or rolls back if an error is thrown.
 * 
 * @param {import('knex').Knex} knexInstance - Knex instance
 * @param {Function} fn - Async function to execute within transaction
 * @returns {Promise<*>} Result of the transaction function
 * @throws {Error} Rethrows any error from the transaction function
 * 
 * @example
 * const result = await withTransaction(db, async (trx) => {
 *   const rows = await trx('tasks').insert({ name: 'New Task' });
 *   return rows[0];
 * });
 */
async function withTransaction(knexInstance, fn) {
  if (!knexInstance || typeof knexInstance.transaction !== 'function') {
    throw new Error('Invalid Knex instance provided to withTransaction');
  }
  
  if (typeof fn !== 'function') {
    throw new Error('Transaction function must be a valid function');
  }
  
  return await knexInstance.transaction(async (trx) => {
    return await fn(trx);
  });
}

/**
 * TransactionContext - Manages transaction state for complex operations
 * 
 * Provides a context object that can be passed around during
 * multi-step operations, allowing transactions to be managed
 * at the outer scope while operations can nest safely.
 * 
 * @class
 * 
 * @example
 * // Basic usage
 * const ctx = new TransactionContext(db);
 * await ctx.run(async (trx) => {
 *   await trx('tasks').insert({ name: 'Task 1' });
 *   await trx('tasks').insert({ name: 'Task 2' });
 * });
 * 
 * @example
 * // Nested operations - if already in transaction, reuses it
 * async function updateTask(ctx, id, data) {
 *   const trx = await ctx.getTrx();
 *   return await trx('tasks').where({ id }).update(data);
 * }
 * 
 * await ctx.run(async (trx) => {
 *   await updateTask(ctx, 1, { status: 'done' });
 *   await updateTask(ctx, 2, { status: 'done' });
 * });
 */
class TransactionContext {
  /**
   * Create a TransactionContext
   * @param {import('knex').Knex} knexInstance - Knex instance
   */
  constructor(knexInstance) {
    if (!knexInstance || typeof knexInstance.transaction !== 'function') {
      throw new Error('TransactionContext requires a valid Knex instance');
    }
    
    this.knex = knexInstance;
    this._trx = null;
    this._depth = 0;
  }
  
  /**
   * Get the current transaction, or knex if not in transaction
   * @returns {import('knex').Knex.Transaction|import('knex').Knex} Transaction if active, otherwise Knex instance
   */
  get trx() {
    return this._trx || this.knex;
  }
  
  /**
   * Check if currently within a transaction
   * @returns {boolean} True if in transaction
   */
  get isInTransaction() {
    return this._trx !== null && this._depth > 0;
  }
  
  /**
   * Execute a function within a transaction
   * 
   * Can be nested - will reuse existing transaction if already active.
   * 
   * @param {Function} fn - Async function(transaction) to execute
   * @returns {Promise<*>} Result of the function
   * @throws {Error} Rethrows any error from the function
   */
  async run(fn) {
    // If already in a transaction, run with existing transaction
    if (this._trx) {
      this._depth++;
      try {
        return await fn(this._trx);
      } finally {
        this._depth--;
      }
    }
    
    // Otherwise start a new transaction
    return await withTransaction(this.knex, async (trx) => {
      this._trx = trx;
      this._depth = 1;
      
      try {
        const result = await fn(trx);
        return result;
      } finally {
        this._depth--;
        if (this._depth === 0) {
          this._trx = null;
        }
      }
    });
  }
  
  /**
   * Get a transaction instance (for passing to nested functions)
   * 
   * Returns the current transaction if active, or creates an
   * implicit non-transactional query builder.
   * 
   * @returns {import('knex').Knex.Transaction|import('knex').Knex}
   */
  getTrx() {
    return this._trx || this.knex;
  }
  
  /**
   * Destroy the context and cleanup resources
   * Should be called when done using the context
   */
  destroy() {
    this._trx = null;
    this._depth = 0;
  }
}

/**
 * Legacy compatibility export
 * Creates a default Knex instance using current NODE_ENV
 * 
 * @deprecated Use createKnex() factory instead for testability
 */
let defaultDb = null;
let defaultDbCached = false;

function getDefaultDb() {
  if (!defaultDbCached) {
    defaultDb = createKnex();
    defaultDbCached = true;
  }
  return defaultDb;
}

module.exports = {
  createKnex,
  withTransaction,
  TransactionContext,
  defaultPoolConfig,
  ENVIRONMENTS,
  getDefaultDb
};
