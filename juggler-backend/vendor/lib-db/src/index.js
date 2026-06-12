/**
 * @raike/lib-db
 *
 * Database utilities for Raike & Sons services.
 */

const { createKnex } = require('./createKnex');
const { withTransaction } = require('./withTransaction');
const TransactionContext = require('./TransactionContext');
const { KnexConnectionAdapter, createKnexConnectionAdapter } = require('./KnexConnectionAdapter');
const { validateDatabasePort } = require('./ports/DatabasePort');

// Database instance cache
let dbInstance = null;

/**
 * Get the database instance
 * @returns {Object} Knex database instance
 */
function getDb() {
  if (!dbInstance) {
    throw new Error('Database instance not initialized. Call createKnex() first or ensure the database is properly initialized.');
  }
  return dbInstance;
}

/**
 * Initialize the database instance using createKnex
 * @param {Object} knexConfig - Knex configuration
 * @param {Object} options - Options for database initialization
 */
function initDb(knexConfig, options = {}) {
  dbInstance = createKnex({
    knexConfig,
    ...options
  });
  return dbInstance;
}

module.exports = {
  createKnex,
  getDb,
  initDb,
  withTransaction,
  TransactionContext,
  KnexConnectionAdapter,
  createKnexConnectionAdapter,
  validateDatabasePort
};