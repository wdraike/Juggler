'use strict';

/**
 * Add 'missed' status to task_instances status enum constraint
 * 
 * This migration updates the task_instances table to support the 'missed' status
 * in the status CHECK constraint, and ensures the completed_at timestamp column
 * exists for terminal statuses.
 * 
 * Requirements from task:
 * - Add 'missed' status to task_instances status CHECK constraint
 * - Add completed_at timestamp column for terminal statuses
 * - Include COLLATE utf8mb4_unicode_ci on any new string columns
 * - Write rollback script
 */
exports.up = async function(knex) {
  console.log('Adding missed status to task_instances enum and completed_at column...');
  
  await knex.transaction(async (trx) => {
    // Step 1: Drop existing CHECK constraint if it exists
    try {
      await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
      console.log('Dropped existing status constraint');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown constraint')) {
        console.warn('Existing status constraint not found, continuing...');
      } else {
        throw error;
      }
    }

    // Step 2: Add new CHECK constraint with 'missed' status
    await trx.raw(`
      ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
      CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed'))
    `);
    console.log('Added status enum constraint with missed status');

    // Step 3: Add completed_at column if it doesn't exist
    try {
      const hasColumn = await trx.schema.hasColumn('task_instances', 'completed_at');
      if (!hasColumn) {
        await trx.raw('ALTER TABLE task_instances ADD COLUMN completed_at DATETIME NULL');
        console.log('Added completed_at column');
      } else {
        console.log('completed_at column already exists');
      }
    } catch (error) {
      if (error.message.includes('duplicate column') || error.message.includes('already exists')) {
        console.warn('completed_at column already exists, skipping...');
      } else {
        throw error;
      }
    }

    // Step 4: Add index for purge operations with proper collation
    try {
      await trx.raw('ALTER TABLE task_instances ADD INDEX idx_task_instances_purge (user_id, status, completed_at) COMMENT "Sharded purge query support"');
      console.log('Added purge index');
    } catch (error) {
      if (error.message.includes('duplicate key') || error.message.includes('already exists')) {
        console.warn('Purge index already exists, skipping...');
      } else {
        throw error;
      }
    }

    // Step 5: Backfill legacy rows with completed_at values
    await trx.raw(`
      UPDATE task_instances 
      SET completed_at = updated_at 
      WHERE status IN ('done','skip','cancel','missed') 
      AND completed_at IS NULL
    `);
    console.log('Backfilled completed_at for terminal statuses');
  });
  
  console.log('Task instances migration completed successfully.');
};

exports.down = async function(knex) {
  console.log('Reverting task instances migration...');
  
  await knex.transaction(async (trx) => {
    // Step 1: Remove the completed_at column
    try {
      await trx.raw('ALTER TABLE task_instances DROP COLUMN completed_at');
      console.log('Dropped completed_at column');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown column')) {
        console.warn('completed_at column not found, skipping...');
      } else {
        throw error;
      }
    }

    // Step 2: Drop the new constraint
    try {
      await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
      console.log('Dropped status enum constraint');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown constraint')) {
        console.warn('Status enum constraint not found, skipping...');
      } else {
        throw error;
      }
    }

    // Step 3: Re-add original constraint without 'missed' status
    await trx.raw(`
      ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
      CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
    `);
    console.log('Restored original status constraint without missed status');

    // Step 4: Drop the purge index
    try {
      await trx.raw('ALTER TABLE task_instances DROP INDEX idx_task_instances_purge');
      console.log('Dropped purge index');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown index')) {
        console.warn('Purge index not found, skipping...');
      } else {
        throw error;
      }
    }
  });
  
  console.log('Task instances migration reverted successfully.');
};