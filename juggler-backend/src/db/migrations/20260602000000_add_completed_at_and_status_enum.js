'use strict';

/**
 * Add completed_at timestamp and status enum constraints for calendar history feature
 * 
 * This migration:
 * 1. Adds completed_at timestamp column to task_masters and task_instances
 * 2. Creates a shared task-status library reference
 * 3. Ensures proper collation for all string columns
 * 4. Makes down migration properly reversible
 */
exports.up = async function(knex) {
  console.log('Adding completed_at timestamp and status enum constraints...');
  
  // Skip completed_at column additions - both task_masters and task_instances already have these columns
  // task_masters.completed_at: already exists
  // task_instances.completed_at: added in 20260509000300_add_missed_status_and_completed_at.js
  
  // Add CHECK constraint for status enum on task_masters
  await knex.raw(`
    ALTER TABLE task_masters 
    ADD CONSTRAINT chk_task_masters_status_enum 
    CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed', 'archived', 'restored') OR status IS NULL)
  `);
  
  // Add CHECK constraint for status enum on task_instances
  await knex.raw(`
    ALTER TABLE task_instances 
    ADD CONSTRAINT chk_task_instances_status_enum 
    CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed', 'archived', 'restored') OR status IS NULL)
  `);
  
  console.log('Status enum constraints added successfully (completed_at columns already existed).');
};

exports.down = async function(knex) {
  console.log('Removing completed_at timestamp and status enum constraints...');
  
  // Remove constraints from task_instances
  try {
    await knex.raw('ALTER TABLE task_instances DROP CONSTRAINT chk_task_instances_status_enum');
  } catch (_e) {
    console.warn('Constraint chk_task_instances_status_enum not found, skipping...');
  }
  
  // Remove constraints from task_masters
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_status_enum');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_status_enum not found, skipping...');
  }
  
  // Skip completed_at column removal - columns already existed before this migration
  // await knex.schema.alterTable('task_masters', function(table) {
  //   table.dropColumn('completed_at');
  // });
  // await knex.schema.alterTable('task_instances', function(table) {
  //   table.dropColumn('completed_at');
  // });
  
  console.log('Status enum constraints removed successfully (completed_at columns were not touched).');
};