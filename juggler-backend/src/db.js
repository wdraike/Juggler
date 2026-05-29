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

// For backward compatibility, create a singleton instance
// This is the transitional export - consumers should migrate to createKnex()
const db = createKnex();

// Attach utility functions for consumers migrating to new API
db.withTransaction = withTransaction;
db.TransactionContext = TransactionContext;

module.exports = db;
