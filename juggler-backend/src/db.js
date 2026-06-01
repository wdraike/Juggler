/**
 * Database connection module
 * 
 * ⚠️ DEPRECATED: This singleton-pattern module is being phased out.
 * 
 * For new code, use the lib-db factory pattern:
 *   const { createKnex, withTransaction, TransactionContext } = require('./lib/db');
 *   const db = createKnex();
 * 
 * This singleton export is maintained for backward compatibility
 * during the migration to hexagonal architecture.
 * 
 * TODO: Remove this module once all consumers are migrated (WBS 1.2)
 * 
 * @deprecated Use lib-db factory functions instead
 */

const { createKnex, withTransaction, TransactionContext } = require('./lib/db');

// Emit a runtime warning so callers can track migration progress.
// Suppressed in test environments to keep test output clean.
// console.warn used directly — logger not used here because this module loads at
// require-time before the structured logger (lib-logger) is wired up.
if (process.env.NODE_ENV !== 'test') {
  console.warn(
    '[DEPRECATED] juggler-backend/src/db.js: singleton DB import is deprecated. ' +
    'Migrate to createKnex() from ./lib/db (tracked: JUG-HEX-P0, WBS 1.2).'
  );
}

// For backward compatibility, create a singleton instance
// This is the transitional export - consumers should migrate to createKnex()
const db = createKnex();

// Attach utility functions for consumers migrating to new API
db.withTransaction = withTransaction;
db.TransactionContext = TransactionContext;

module.exports = db;
