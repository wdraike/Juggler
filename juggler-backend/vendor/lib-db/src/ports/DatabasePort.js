/**
 * DatabasePort interface (JSDoc typedef)
 *
 * Defines the contract that all database adapters must implement.
 * This is the "port" in hexagonal architecture terms.
 *
 * The DatabasePort provides a unified interface for database operations,
 * abstracting away the specific database technology (MySQL, PostgreSQL, etc.)
 * and ORM/query builder (Knex, Sequelize, etc.).
 */

/**
 * @typedef {Object} DatabasePort
 *
 * @property {function(string, Array=): Promise<Array>} query
 *   Execute a SQL query with optional parameters.
 *   @param {string} sql - SQL query string
 *   @param {Array} [params] - Query parameters for prepared statements
 *   @returns {Promise<Array>} Query results
 *
 * @property {function(function(DatabasePort): Promise<T>): Promise<T>} transaction
 *   Execute a callback within a database transaction.
 *   If the callback resolves, the transaction is committed.
 *   If the callback rejects, the transaction is rolled back.
 *   @template T
 *   @param {function(DatabasePort): Promise<T>} callback - Transaction callback receiving a transaction-scoped DatabasePort
 *   @returns {Promise<T>} Result of the callback
 *
 * @property {function(): Promise<void>} close
 *   Close the database connection and release resources.
 *   @returns {Promise<void>}
 *
 * @property {function(): boolean} isConnected
 *   Check if the database connection is active.
 *   @returns {boolean}
 *
 * @property {function(): Object} getConnectionInfo
 *   Get information about the current database connection.
 *   @returns {Object} Connection information (host, port, database name, etc.)
 */

/**
 * Validates that an adapter implements the required DatabasePort methods
 * @param {Object} adapter
 * @returns {Array<string>} - Array of missing method names (empty if valid)
 */
function validateDatabasePort(adapter) {
  const required = [
    'query',
    'transaction',
    'close',
    'isConnected',
    'getConnectionInfo'
  ];

  const missing = [];
  for (const method of required) {
    if (typeof adapter[method] !== 'function') {
      missing.push(method);
    }
  }
  return missing;
}

module.exports = {
  validateDatabasePort
};