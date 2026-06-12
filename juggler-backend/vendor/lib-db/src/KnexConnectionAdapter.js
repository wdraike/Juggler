/**
 * KnexConnectionAdapter
 *
 * Adapter that implements the ConnectionPort interface using Knex.
 * This adapter bridges the hexagonal architecture by providing a concrete
 * Knex-based implementation of the connection port.
 */

const { validateDatabasePort } = require('./ports/DatabasePort');

class KnexConnectionAdapter {
  /**
   * Create a new KnexConnectionAdapter
   *
   * @param {Object} knexInstance - Configured Knex instance
   * @param {Object} options - Adapter options
   */
  constructor(knexInstance, options = {}) {
    if (!knexInstance) {
      throw new Error('knexInstance is required');
    }
    
    this.knex = knexInstance;
    this.logger = options.logger || console;
    this.isConnected = true; // Knex manages connection pooling internally
  }

  /**
   * Execute query using this connection
   *
   * @param {string} sql - SQL query string
   * @param {Array} [params] - Query parameters for prepared statements
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    try {
      this.logger.debug(`[KnexConnectionAdapter] Executing query: ${sql.substring(0, 100)}`);
      const result = await this.knex.raw(sql, params);
      return result && result.length > 0 ? result[0] : [];
    } catch (error) {
      this.logger.error(`[KnexConnectionAdapter] Query failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Begin transaction on this connection
   *
   * @returns {Promise<Object>} Transaction object with commit/rollback methods
   */
  async beginTransaction() {
    try {
      this.logger.debug('[KnexConnectionAdapter] Beginning transaction');
      const transaction = await this.knex.transaction();
      
      return {
        query: async (sql, params = []) => {
          try {
            const result = await transaction.raw(sql, params);
            return result && result.length > 0 ? result[0] : [];
          } catch (error) {
            this.logger.error(`[KnexConnectionAdapter] Transaction query failed: ${error.message}`);
            throw error;
          }
        },
        commit: async () => {
          await transaction.commit();
          this.logger.debug('[KnexConnectionAdapter] Transaction committed');
        },
        rollback: async () => {
          await transaction.rollback();
          this.logger.debug('[KnexConnectionAdapter] Transaction rolled back');
        }
      };
    } catch (error) {
      this.logger.error(`[KnexConnectionAdapter] Failed to begin transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Close the connection
   *
   * @returns {Promise<void>}
   */
  async close() {
    try {
      this.logger.debug('[KnexConnectionAdapter] Closing connection');
      await this.knex.destroy();
      this.isConnected = false;
    } catch (error) {
      this.logger.error(`[KnexConnectionAdapter] Failed to close connection: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the underlying Knex instance (for advanced use cases)
   *
   * @returns {Object} Knex instance
   */
  getKnexInstance() {
    return this.knex;
  }
}

/**
 * Factory function to create a KnexConnectionAdapter
 *
 * @param {Object} knexInstance - Configured Knex instance
 * @param {Object} options - Adapter options
 * @returns {IConnectionPort} Connection port instance
 */
function createKnexConnectionAdapter(knexInstance, options = {}) {
  return new KnexConnectionAdapter(knexInstance, options);
}

module.exports = {
  KnexConnectionAdapter,
  createKnexConnectionAdapter
};