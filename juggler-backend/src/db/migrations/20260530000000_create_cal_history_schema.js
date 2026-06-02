'use strict';

/**
 * Create cal_history table for tracking calendar history
 */
exports.up = async function(knex) {
  // Check if table already exists
  const tableExists = await knex.schema.hasTable('cal_history');
  
  if (!tableExists) {
    await knex.raw(`
      CREATE TABLE cal_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci,
        user_id VARCHAR(36) NOT NULL,
        scheduled_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        previous_status VARCHAR(20) NULL,
        calendar_provider VARCHAR(20) NULL,
        calendar_event_id VARCHAR(255) NULL,
        status_reason VARCHAR(255) NULL,
        metadata JSON NULL,
        created_by VARCHAR(100) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add indexes for performance
    await knex.raw('ALTER TABLE cal_history ADD INDEX idx_cal_history_task_created (task_id, created_at)');
    await knex.raw('ALTER TABLE cal_history ADD INDEX idx_cal_history_user_scheduled (user_id, scheduled_at)');
    await knex.raw('ALTER TABLE cal_history ADD INDEX idx_cal_history_user_status (user_id, status)');
    await knex.raw('ALTER TABLE cal_history ADD INDEX idx_cal_history_status_scheduled (status, scheduled_at)');

    // Add CHECK constraints
    await knex.raw(`
      ALTER TABLE cal_history 
      ADD CONSTRAINT chk_cal_history_status 
      CHECK (status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'))
    `);

    await knex.raw(`
      ALTER TABLE cal_history 
      ADD CONSTRAINT chk_cal_history_previous_status 
      CHECK (previous_status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED') OR previous_status IS NULL)
    `);

    // Add foreign key constraint
    await knex.raw(`
      ALTER TABLE cal_history 
      ADD CONSTRAINT fk_cal_history_task_id 
      FOREIGN KEY (task_id) REFERENCES task_instances(id) ON DELETE CASCADE
    `);
  }
};

exports.down = async function(knex) {
  // Check if table exists before dropping
  const tableExists = await knex.schema.hasTable('cal_history');
  
  if (tableExists) {
    await knex.raw('ALTER TABLE cal_history DROP FOREIGN KEY fk_cal_history_task_id');
    await knex.raw('DROP TABLE cal_history');
  }
};