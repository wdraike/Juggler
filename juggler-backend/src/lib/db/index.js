/**
 * lib-db - Database utilities for Juggler
 * 
 * Factory-based database utilities replacing the singleton pattern.
 * Now uses the unified @raike/lib-db package.
 * 
 * @module lib/db
 */

// Re-export from the unified lib-db package
const { createKnex, withTransaction, TransactionContext } = require('@raike/lib-db');

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
 * Legacy compatibility export
 * Creates a default Knex instance using current NODE_ENV
 * 
 * @deprecated Use createKnex() factory instead for testability
 */
let defaultDb = null;
let defaultDbCached = false;

function getDefaultDb() {
  if (!defaultDbCached) {
    const knex = require('knex');
    const defaultKnexfile = require('../../../knexfile.js');
    const env = process.env.NODE_ENV || 'development';
    const knexConfig = defaultKnexfile[env];
    
    if (!knexConfig) {
      throw new Error(`No database configuration found for environment: ${env}`);
    }
    
    defaultDb = knex(knexConfig);
    defaultDbCached = true;
  }
  return defaultDb;
}

// ponytail: test-only reset so isolated-DB suites can bust the singleton cache
// after setting process.env.DB_NAME. Without this, the first require('../../src/db')
// in a maxWorkers:1 jest run permanently binds to whatever DB_NAME was set at that
// moment — later files that override DB_NAME get the stale connection (999.1176).
// Ceiling: none — production never calls this; it's behind the test-only export.
function _resetForTests() {
  if (defaultDb) {
    try { defaultDb.destroy(); } catch (e) { /* no-op */ }
  }
  defaultDb = null;
  defaultDbCached = false;
}

module.exports = {
  createKnex,
  withTransaction,
  TransactionContext,
  defaultPoolConfig,
  ENVIRONMENTS,
  getDefaultDb,
  _resetForTests
};
