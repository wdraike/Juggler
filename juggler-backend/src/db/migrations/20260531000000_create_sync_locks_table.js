'use strict';

/**
 * Create sync_locks table for leader election and distributed locking
 */
exports.up = async function(knex) {
  // Check if table already exists
  const tableExists = await knex.schema.hasTable('sync_locks');
  
  if (!tableExists) {
    await knex.raw(`
      CREATE TABLE sync_locks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lock_name VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci,
        locked_by VARCHAR(100) NOT NULL,
        locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        UNIQUE KEY uk_sync_locks_name (lock_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add index for performance
    await knex.raw('ALTER TABLE sync_locks ADD INDEX idx_sync_locks_expires (expires_at)');
  }
};

exports.down = async function(knex) {
  // Check if table exists before dropping
  const tableExists = await knex.schema.hasTable('sync_locks');
  
  if (tableExists) {
    await knex.raw('DROP TABLE sync_locks');
  }
};