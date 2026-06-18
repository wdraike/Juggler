'use strict';

/**
 * Add CHECK constraints for boolean columns and status validation
 * 
 * This migration ensures:
 * 1. Boolean columns only accept 0/1 values
 * 2. Status columns only accept valid status values
 * 3. Consistent validation across all task-related tables
 */
exports.up = async function(knex) {
  console.log('Adding CHECK constraints for boolean and status columns...');

  // Helper function to safely add constraints
  async function addConstraintIfNotExists(table, constraintName, constraintSQL) {
    try {
      await knex.raw(constraintSQL);
      console.log(`Added constraint ${constraintName} to ${table}`);
    } catch (error) {
      if (error.message.includes('Duplicate') || error.message.includes('already exists')) {
        console.warn(`Constraint ${constraintName} already exists on ${table}, skipping...`);
      } else {
        console.error(`Error adding constraint ${constraintName}:`, error.message);
        throw error;
      }
    }
  }

  // Add CHECK constraints for boolean columns in task_masters
  // Note: rigid column was dropped in 20260526000000_drop_pinned_and_rigid_columns.js
  await addConstraintIfNotExists('task_masters', 'chk_task_masters_flex_when', `
    ALTER TABLE task_masters 
    ADD CONSTRAINT chk_task_masters_flex_when 
    CHECK (flex_when IN (0, 1))
  `);
  
  // Skip rigid constraint - column was dropped
  // await addConstraintIfNotExists('task_masters', 'chk_task_masters_rigid', ...)
  
  // Skip marker constraint - column was dropped in 20260501000300_placement_mode_stored.js
  // await addConstraintIfNotExists('task_masters', 'chk_task_masters_marker', ...)
  
  await addConstraintIfNotExists('task_masters', 'chk_task_masters_recurring', `
    ALTER TABLE task_masters 
    ADD CONSTRAINT chk_task_masters_recurring 
    CHECK (recurring IN (0, 1))
  `);
  
  await addConstraintIfNotExists('task_masters', 'chk_task_masters_split', `
    ALTER TABLE task_masters 
    ADD CONSTRAINT chk_task_masters_split 
    CHECK (split IN (0, 1) OR split IS NULL)
  `);
  
  // Add CHECK constraints for boolean columns in task_instances
  // Note: date_pinned column was dropped in 20260526000000_drop_pinned_and_rigid_columns.js
  // await addConstraintIfNotExists('task_instances', 'chk_task_instances_date_pinned', ...)
  
  await addConstraintIfNotExists('task_instances', 'chk_task_instances_unscheduled', `
    ALTER TABLE task_instances 
    ADD CONSTRAINT chk_task_instances_unscheduled 
    CHECK (unscheduled IN (0, 1) OR unscheduled IS NULL)
  `);
  
  // Add CHECK constraints for status columns
  await addConstraintIfNotExists('task_masters', 'chk_task_masters_status', `
    ALTER TABLE task_masters 
    ADD CONSTRAINT chk_task_masters_status 
    CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed') OR status IS NULL)
  `);
  
  await addConstraintIfNotExists('task_instances', 'chk_task_instances_status', `
    ALTER TABLE task_instances 
    ADD CONSTRAINT chk_task_instances_status 
    CHECK (status IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed'))
  `);
  
  // Add CHECK constraints for cal_history status column
  await addConstraintIfNotExists('cal_history', 'chk_cal_history_status', `
    ALTER TABLE cal_history 
    ADD CONSTRAINT chk_cal_history_status 
    CHECK (status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'))
  `);
  
  // Skip previous_status constraint - there are data violations that need cleanup
  // await addConstraintIfNotExists('cal_history', 'chk_cal_history_previous_status', ...)
  
  console.log('CHECK constraints added successfully (with some skipped due to data issues).');
};

exports.down = async function(knex) {
  console.log('Removing CHECK constraints...');
  
  // Remove constraints from cal_history
  try {
    await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_status');
  } catch (_e) {
    console.warn('Constraint chk_cal_history_status not found, skipping...');
  }
  
  // Skip previous_status constraint removal - was skipped in up migration
  // try {
  //   await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_previous_status');
  // } catch (e) {
  //   console.warn('Constraint chk_cal_history_previous_status not found, skipping...');
  // }
  
  // Remove constraints from task_instances
  try {
    await knex.raw('ALTER TABLE task_instances DROP CONSTRAINT chk_task_instances_status');
  } catch (_e) {
    console.warn('Constraint chk_task_instances_status not found, skipping...');
  }
  
  // Skip date_pinned constraint removal - column was dropped
  // try {
  //   await knex.raw('ALTER TABLE task_instances DROP CONSTRAINT chk_task_instances_date_pinned');
  // } catch (e) {
  //   console.warn('Constraint chk_task_instances_date_pinned not found, skipping...');
  // }
  
  try {
    await knex.raw('ALTER TABLE task_instances DROP CONSTRAINT chk_task_instances_unscheduled');
  } catch (_e) {
    console.warn('Constraint chk_task_instances_unscheduled not found, skipping...');
  }
  
  // Remove constraints from task_masters
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_status');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_status not found, skipping...');
  }
  
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_split');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_split not found, skipping...');
  }
  
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_recurring');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_recurring not found, skipping...');
  }
  
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_marker');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_marker not found, skipping...');
  }
  
  // Skip rigid constraint removal - column was dropped
  // try {
  //   await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_rigid');
  // } catch (e) {
  //   console.warn('Constraint chk_task_masters_rigid not found, skipping...');
  // }
  
  try {
    await knex.raw('ALTER TABLE task_masters DROP CONSTRAINT chk_task_masters_flex_when');
  } catch (_e) {
    console.warn('Constraint chk_task_masters_flex_when not found, skipping...');
  }
  
  console.log('CHECK constraints removed successfully.');
};