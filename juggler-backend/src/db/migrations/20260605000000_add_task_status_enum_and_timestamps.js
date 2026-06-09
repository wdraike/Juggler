'use strict';

/**
 * Add task status enum and timestamp fields for calendar history feature
 * 
 * This migration:
 * 1. Adds status enum column to task_masters with proper constraints
 * 2. Adds completed_at timestamp column to task_masters
 * 3. Adds scheduled_at timestamp column to task_masters (required for terminal statuses)
 * 4. Ensures all string columns use COLLATE utf8mb4_unicode_ci
 * 5. Creates appropriate indexes for performance
 */
exports.up = async function(knex) {
  console.log('Adding task status enum and timestamp fields...');
  
  await knex.transaction(async (trx) => {
    // Step 1: Add status column to task_masters if it doesn't exist
    try {
      await trx.raw(`
        ALTER TABLE task_masters 
        ADD COLUMN status VARCHAR(20) 
        COLLATE utf8mb4_unicode_ci 
        DEFAULT '' 
        COMMENT 'pending, done, skip, cancel, missed'
      `);
      console.log('Added status column to task_masters');
    } catch (error) {
      if (error.message.includes('Duplicate column name')) {
        console.warn('Status column already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Step 2: Add completed_at column to task_masters
    try {
      await trx.raw(`
        ALTER TABLE task_masters 
        ADD COLUMN completed_at DATETIME NULL 
        COMMENT 'When task was completed (for terminal statuses)'
      `);
      console.log('Added completed_at column to task_masters');
    } catch (error) {
      if (error.message.includes('Duplicate column name')) {
        console.warn('completed_at column already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Step 3: Add scheduled_at column to task_masters (required for terminal statuses)
    try {
      await trx.raw(`
        ALTER TABLE task_masters 
        ADD COLUMN scheduled_at DATETIME NULL 
        COMMENT 'When task was scheduled (required for terminal statuses)'
      `);
      console.log('Added scheduled_at column to task_masters');
    } catch (error) {
      if (error.message.includes('Duplicate column name')) {
        console.warn('scheduled_at column already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Step 4: Add CHECK constraint for status enum on task_masters
    try {
      await trx.raw(`
        ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status_enum
        CHECK (status IN ('', 'pending', 'done', 'skip', 'cancel', 'missed') OR status IS NULL)
      `);
      console.log('Added status enum constraint to task_masters');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Status enum constraint already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Step 5: Add index for status-based queries
    try {
      await trx.raw(`
        ALTER TABLE task_masters 
        ADD INDEX idx_task_masters_status (user_id, status, completed_at) 
        COMMENT 'Status-based query performance'
      `);
      console.log('Added status index to task_masters');
    } catch (error) {
      if (error.message.includes('Duplicate key name')) {
        console.warn('Status index already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Step 5b: Backfill terminal-status rows that would violate the constraint.
    // Mirrors 20260527213906 (task_instances): a terminal status with NULL
    // scheduled_at is invalid data. Without this backfill the ADD CONSTRAINT below
    // fails on any DB that already holds terminal task_masters rows (fresh test/CI
    // DBs included), aborting the whole migrate:latest chain.
    const tmFixed = await trx.raw(`
      UPDATE task_masters
      SET scheduled_at = completed_at
      WHERE status IN ('done','skip','cancel','missed')
        AND scheduled_at IS NULL
        AND completed_at IS NOT NULL
    `);
    const tmFixedCount = tmFixed[0] ? (tmFixed[0].affectedRows || tmFixed[0].changedRows || 0) : 0;
    // Last resort: any remaining terminal row with no completed_at to borrow — clear
    // status to non-terminal (the scheduler will re-place if needed). Never fabricate
    // a placement time.
    const tmCleared = await trx.raw(`
      UPDATE task_masters
      SET status = ''
      WHERE status IN ('done','skip','cancel','missed')
        AND scheduled_at IS NULL
    `);
    const tmClearedCount = tmCleared[0] ? (tmCleared[0].affectedRows || tmCleared[0].changedRows || 0) : 0;
    if (tmFixedCount > 0) console.log(`[MIGRATION] task_masters: backfilled scheduled_at from completed_at (${tmFixedCount} rows)`);
    if (tmClearedCount > 0) console.log(`[MIGRATION] task_masters: cleared invalid terminal status (${tmClearedCount} rows)`);

    // Step 6: Add CHECK constraint for scheduled_at requirement on terminal statuses
    try {
      await trx.raw(`
        ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_scheduled_at_for_terminal
        CHECK (
          (status NOT IN ('done', 'skip', 'cancel', 'missed') OR scheduled_at IS NOT NULL)
          OR
          (status IS NULL OR status = '')
        )
      `);
      console.log('Added scheduled_at constraint for terminal statuses');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Scheduled_at constraint already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
  });
  
  console.log('Task status enum and timestamp fields added successfully.');
};

exports.down = async function(knex) {
  console.log('Removing task status enum and timestamp fields...');
  
  await knex.transaction(async (trx) => {
    // Remove scheduled_at constraint
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_scheduled_at_for_terminal');
    } catch (e) {
      console.warn('Constraint chk_task_masters_scheduled_at_for_terminal not found, skipping...');
    }
    
    // Remove status index
    try {
      await trx.raw('ALTER TABLE task_masters DROP INDEX idx_task_masters_status');
    } catch (e) {
      console.warn('Index idx_task_masters_status not found, skipping...');
    }
    
    // Remove status enum constraint
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_status_enum');
    } catch (e) {
      console.warn('Constraint chk_task_masters_status_enum not found, skipping...');
    }
    
    // Remove scheduled_at column
    try {
      await trx.raw('ALTER TABLE task_masters DROP COLUMN scheduled_at');
    } catch (e) {
      console.warn('Column scheduled_at not found on task_masters, skipping...');
    }
    
    // Remove completed_at column
    try {
      await trx.raw('ALTER TABLE task_masters DROP COLUMN completed_at');
    } catch (e) {
      console.warn('Column completed_at not found on task_masters, skipping...');
    }
    
    // Remove status column
    try {
      await trx.raw('ALTER TABLE task_masters DROP COLUMN status');
    } catch (e) {
      console.warn('Column status not found on task_masters, skipping...');
    }
  });
  
  console.log('Task status enum and timestamp fields removed successfully.');
};
