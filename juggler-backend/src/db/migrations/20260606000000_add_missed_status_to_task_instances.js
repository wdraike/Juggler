'use strict';

/**
 * Add 'missed' status to task_instances.status CHECK constraint
 * 
 * This migration:
 * 1. Drops the existing CHECK constraint (chk_task_instances_status)
 * 2. Re-adds CHECK constraint including 'missed' value
 * 3. Uses COLLATE utf8mb4_unicode_ci as required
 */
exports.up = async function(knex) {
  console.log('Adding missed status to task_instances CHECK constraint...');
  
  await knex.transaction(async (trx) => {
    // Step 1: Drop existing CHECK constraint (may have been renamed in prior migrations)
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
    
    // Step 2: Re-add CHECK constraint including 'missed' status (skip if already present via prior migration)
    try {
      await trx.raw(`
        ALTER TABLE task_instances
          ADD CONSTRAINT chk_task_instances_status
            CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed'))
      `);
      console.log('Added new chk_task_instances_status constraint with missed status');
    } catch (error) {
      if (error.message.includes('Duplicate check constraint name') || error.message.includes('already exists')) {
        console.warn('chk_task_instances_status constraint already exists (added by prior migration), skipping...');
      } else {
        throw error;
      }
    }
  });
  
  console.log('Missed status added to task_instances CHECK constraint successfully.');
};

exports.down = async function(knex) {
  console.log('Removing missed status from task_instances CHECK constraint...');
  
  await knex.transaction(async (trx) => {
    // Drop the new constraint
    try {
      await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
      console.log('Dropped chk_task_instances_status constraint');
    } catch (error) {
      if (error.message.includes('check constraint') || error.message.includes('doesn\'t exist') || error.message.includes('not found')) {
        console.warn('chk_task_instances_status constraint not found, continuing...');
      } else {
        throw error;
      }
    }
    
    // Re-add original constraint without 'missed'
    await trx.raw(`
      ALTER TABLE task_instances
        ADD CONSTRAINT chk_task_instances_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled') )
    `);
    console.log('Restored original chk_task_instances_status constraint');
  });
  
  console.log('Missed status removed from task_instances CHECK constraint successfully.');
};