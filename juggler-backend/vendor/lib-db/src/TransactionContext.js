/**
 * TransactionContext - Wraps a Knex transaction object and provides transaction management
 *
 * @module lib-db/transaction-context
 */

/**
 * TransactionContext class that manages transaction state
 * and provides a wrapper around Knex transaction objects
 */
class TransactionContext {
  /**
   * Create a new TransactionContext
   *
   * @param {Object} trx - The Knex transaction object
   * @param {string} transactionId - The transaction ID
   */
  constructor(trx, transactionId) {
    this.trx = trx;
    this.transactionId = transactionId;
    this.isCommitted = false;
    this.isRolledBack = false;
  }

  /**
   * Execute a query within the transaction context
   *
   * @param {string|Object} query - The query to execute
   * @param {Array} [bindings] - Query bindings
   * @returns {Promise<any>} The query result
   */
  async query(query, bindings) {
    if (this.isCommitted || this.isRolledBack) {
      throw new Error('Cannot execute query: transaction has already been committed or rolled back');
    }
    
    if (!this.trx) {
      throw new Error('No transaction available');
    }
    
    // If query is already a Knex query builder, execute it with the transaction
    if (typeof query === 'function') {
      return query(this.trx);
    }
    
    // If query is a string, use the transaction object to execute it
    if (typeof query === 'string') {
      return this.trx.raw(query, bindings);
    }
    
    // If query is a Knex query builder object
    return query.transacting(this.trx);
  }

  /**
   * Commit the transaction
   *
   * @returns {Promise<void>}
   */
  async commit() {
    if (this.isCommitted) {
      throw new Error('Transaction already committed');
    }
    
    if (this.isRolledBack) {
      throw new Error('Cannot commit: transaction was rolled back');
    }
    
    if (!this.trx) {
      throw new Error('No transaction available to commit');
    }
    
    await this.trx.commit();
    this.isCommitted = true;
  }

  /**
   * Rollback the transaction
   *
   * @returns {Promise<void>}
   */
  async rollback() {
    if (this.isRolledBack) {
      throw new Error('Transaction already rolled back');
    }
    
    if (this.isCommitted) {
      throw new Error('Cannot rollback: transaction was committed');
    }
    
    if (!this.trx) {
      throw new Error('No transaction available to rollback');
    }
    
    await this.trx.rollback();
    this.isRolledBack = true;
  }

  /**
   * Get the transaction ID
   *
   * @returns {string} The transaction ID
   */
  getTransactionId() {
    return this.transactionId;
  }

  /**
   * Get the underlying Knex transaction object
   *
   * @returns {Object} The Knex transaction object
   */
  getTransaction() {
    return this.trx;
  }

  /**
   * Check if the transaction is still active
   *
   * @returns {boolean} True if transaction is active
   */
  isActive() {
    return !this.isCommitted && !this.isRolledBack;
  }
}

module.exports = TransactionContext;