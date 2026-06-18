'use strict';

/**
 * Add MISSED status enum and scheduled_at constraint for cal_history table
 * 
 * This migration addresses JUGGLER-CAL-HISTORY Phase A requirements:
 * - DB migration for missed status enum
 * - scheduled_at constraint (NOT NULL)
 * - completed_at tracking (already exists)
 * - Proper utf8mb4_unicode_ci collation
 * 
 * Requirements: D-01/D-02/D-04/D-05/D-12/D-15
 */
exports.up = async function(knex) {
  console.log('Applying cal_history schema updates for Phase A...');
  
  // 1. Ensure scheduled_at is NOT NULL
  await knex.raw(`
    ALTER TABLE cal_history 
    MODIFY scheduled_at DATETIME NOT NULL
  `);
  console.log('Added NOT NULL constraint to scheduled_at');
  
  // 2. Ensure proper collation for all string columns
  await knex.raw(`
    ALTER TABLE cal_history 
    MODIFY task_id VARCHAR(100) NOT NULL COLLATE utf8mb4_unicode_ci,
    MODIFY user_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci,
    MODIFY status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COLLATE utf8mb4_unicode_ci,
    MODIFY previous_status VARCHAR(20) NULL COLLATE utf8mb4_unicode_ci,
    MODIFY calendar_provider VARCHAR(20) NULL COLLATE utf8mb4_unicode_ci,
    MODIFY calendar_event_id VARCHAR(255) NULL COLLATE utf8mb4_unicode_ci,
    MODIFY status_reason VARCHAR(255) NULL COLLATE utf8mb4_unicode_ci,
    MODIFY created_by VARCHAR(100) NULL COLLATE utf8mb4_unicode_ci
  `);
  console.log('Ensured proper utf8mb4_unicode_ci collation for all string columns');
  
  // 3. Update status enum constraint to include MISSED status
  try {
    await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_status');
    console.log('Dropped existing status constraint');
  } catch (e) {
    if (!e.message.includes('doesn\'t exist') && !e.message.includes('not found')) {
      console.warn('Constraint chk_cal_history_status not found, continuing...');
    }
  }
  
  await knex.raw(`
    ALTER TABLE cal_history
    ADD CONSTRAINT chk_cal_history_status
    CHECK (status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED', 'SKIPPED'))
  `);
  console.log('Updated status enum constraint with MISSED and SKIPPED statuses');
  
  console.log('✅ Phase A cal_history schema updates completed successfully');
};

exports.down = async function(knex) {
  console.log('Reverting cal_history schema updates...');
  
  // Remove the updated constraint
  try {
    await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_status');
    console.log('Dropped updated status constraint');
  } catch (_e) {
    console.warn('Constraint chk_cal_history_status not found, skipping...');
  }
  
  // Restore original status enum (without MISSED and SKIPPED)
  await knex.raw(`
    ALTER TABLE cal_history
    ADD CONSTRAINT chk_cal_history_status
    CHECK (status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED'))
  `);
  console.log('Restored original status enum');
  
  // Revert scheduled_at to allow NULL
  await knex.raw(`
    ALTER TABLE cal_history 
    MODIFY scheduled_at DATETIME NULL
  `);
  console.log('Reverted scheduled_at to allow NULL');
  
  console.log('✅ Cal_history schema updates reverted successfully');
};