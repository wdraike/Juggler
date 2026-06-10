/**
 * Database connection module
 * Returns a Knex instance configured for the current environment.
 *
 * W5 (juggler-hex-h2): collapsed to a SINGLE pool. This module no longer builds
 * its own knex instance from knexfile.js; it re-exports lib/db's lazy-cached
 * singleton (getDefaultDb()) so that src/db.js and lib/db.getDefaultDb() return
 * the exact same knex instance — one connection pool to the DB, not two.
 *
 * getDefaultDb() preserves the prior throw behavior verbatim:
 *   throw new Error(`No database configuration found for environment: ${env}`)
 * built from knexfile.js + (process.env.NODE_ENV || 'development').
 *
 * db.js is intentionally NOT deleted (later phase). All existing importers keep
 * working, now sharing lib/db's single instance.
 */

module.exports = require('./lib/db').getDefaultDb();
