'use strict';

/**
 * Update task status enum to include all required status values
 *
 * This migration updates the status enum constraint on task_masters to include
 * all status values used throughout the application:
 * - '' (empty/default)
 * - 'wip' (work in progress)
 * - 'done' (completed)
 * - 'cancel' (cancelled)
 * - 'skip' (skipped)
 * - 'pause' (paused)
 * - 'disabled' (disabled for subscription enforcement)
 * - 'missed' (missed deadline)
 * - 'pending' (pending/created but not started)
 * - 'archived' (archived tasks)
 * - 'restored' (restored from archive)
 *
 * This aligns the database schema with the shared task-status.js library
 * and the controller's expected status values.
 */

exports.up = async function(knex) {
  console.log('Updating task status enum to include all required status values...');
  
  await knex.transaction(async (trx) => {
    // First, drop the existing constraint if it exists
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_status_enum');
      console.log('Dropped existing status enum constraint');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown constraint')) {
        console.warn('Existing status enum constraint not found, continuing...');
      } else {
        throw error;
      }
    }
    
    // Add the updated constraint with all required status values for task_masters
    try {
      await trx.raw(`
        ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status_enum
        CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored') OR status IS NULL)
      `);
      console.log('Added updated status enum constraint to task_masters with all required status values');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Updated status enum constraint already exists on task_masters, skipping...');
      } else {
        throw error;
      }
    }
    
    // Also update task_instances status enum to include all required values
    try {
      await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
      console.log('Dropped existing chk_task_instances_status constraint');
    } catch (error) {
      if (error.message.includes('check constraint') || error.message.includes('doesn\'t exist') || error.message.includes('not found')) {
        console.warn('chk_task_instances_status constraint not found, continuing...');
      } else {
        throw error;
      }
    }
    
    try {
      await trx.raw(`
        ALTER TABLE task_instances
        ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored'))
      `);
      console.log('Added updated status enum constraint to task_instances with all required status values');
    } catch (error) {
      if (error.message.includes('Duplicate check constraint name') || error.message.includes('already exists')) {
        console.warn('chk_task_instances_status constraint already exists, skipping...');
      } else {
        throw error;
      }
    }
    
    // Also update the scheduled_at constraint to match the new status values
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_scheduled_at_for_terminal');
      console.log('Dropped existing scheduled_at constraint');
    } catch (error) {
      if (error.message.includes('doesn\'t exist') || error.message.includes('not found') || error.message.includes('Unknown constraint')) {
        console.warn('Existing scheduled_at constraint not found, continuing...');
      } else {
        throw error;
      }
    }
    
    try {
      await trx.raw(`
        ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_scheduled_at_for_terminal
        CHECK (
          (status NOT IN ('done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'archived', 'restored') OR scheduled_at IS NOT NULL)
          OR
          (status IS NULL OR status = '')
        )
      `);
      console.log('Added updated scheduled_at constraint for terminal statuses');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Updated scheduled_at constraint already exists, skipping...');
      } else {
        throw error;
      }
    }
  });
  
  console.log('Task status enum updated successfully.');
};

exports.down = async function(knex) {
  console.log('Reverting task status enum update...');
  
  await knex.transaction(async (trx) => {
    // Remove the updated scheduled_at constraint
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_scheduled_at_for_terminal');
    } catch (e) {
      console.warn('Constraint chk_task_masters_scheduled_at_for_terminal not found, skipping...');
    }
    
    // Remove the updated status enum constraint from task_instances
    try {
      await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
    } catch (e) {
      console.warn('Constraint chk_task_instances_status not found on task_instances, skipping...');
    }
    
    // Remove the updated status enum constraint from task_masters
    try {
      await trx.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_status_enum');
    } catch (e) {
      console.warn('Constraint chk_task_masters_status_enum not found, skipping...');
    }
    
    // Restore the original constraint for task_instances (from 20260606000000)
    try {
      await trx.raw(`
        ALTER TABLE task_instances
        ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed'))
      `);
    } catch (e) {
      console.warn('Failed to restore original task_instances status constraint');
    }
    
    // Restore the original constraint for task_masters (from 20260605000000)
    try {
      await trx.raw(`
        ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status_enum
        CHECK (status IN ('', 'pending', 'done', 'skip', 'cancel', 'missed') OR status IS NULL)
      `);
    } catch (e) {
      console.warn('Failed to restore original task_masters status enum constraint');
    }
    
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
    } catch (e) {
      console.warn('Failed to restore original scheduled_at constraint');
    }
  });
  
  console.log('Task status enum update reverted successfully.');
};
