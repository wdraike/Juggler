/**
 * Transaction utilities for database operations
 *
 * @module lib-db/transaction
 */

/**
 * Execute a function within a database transaction
 *
 * This helper function wraps a callback in a database transaction,
 * automatically handling commit on success and rollback on failure.
 *
 * @param {Object} db - The Knex database instance
 * @param {Function} callback - The function to execute within the transaction
 * @param {Object} [options] - Transaction options
 * @param {boolean} [options.useSavepoint=true] - Whether to use savepoints
 * @returns {Promise<any>} The result of the callback
 * @throws {Error} If the transaction fails
 */
async function withTransaction(db, callback, options = {}) {
  const { useSavepoint = true } = options;

  if (!db) {
    throw new Error('Database instance (db) is required');
  }

  if (typeof callback !== 'function') {
    throw new Error('Callback function is required');
  }

  return db.transaction(async (trx) => {
    try {
      const result = await callback(trx);
      return result;
    } catch (error) {
      throw error;
    }
  });
}

module.exports = {
  withTransaction
};