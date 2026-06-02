'use strict';

/**
 * Fix cal_history status enum to match application constants
 * 
 * This migration aligns the database cal_history.status enum constraint
 * with the application constants defined in src/constants/status-enum.js
 * 
 * Current DB enum: 'PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED', 'SKIPPED'
 * Target enum: 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'
 * 
 * This removes 'PENDING' and 'SKIPPED' from the enum to match the application constants.
 */
exports.up = async function(knex) {
  console.log('Fixing cal_history status enum to match application constants...');
  
  // Drop existing constraint
  try {
    await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_status');
    console.log('Dropped existing status constraint');
  } catch (e) {
    if (!e.message.includes('doesn\'t exist') && !e.message.includes('not found')) {
      console.warn('Constraint chk_cal_history_status not found, continuing...');
    }
  }
  
  // Add new constraint with correct enum values matching status-enum.js
  await knex.raw(`
    ALTER TABLE cal_history
    ADD CONSTRAINT chk_cal_history_status
    CHECK (status IN ('SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'))
  `);
  console.log('Updated status enum constraint to match application constants');
  
  // Clean up any existing rows with invalid status values
  // Convert PENDING to SCHEDULED (most logical mapping)
  // Convert SKIPPED to CANCELLED (most logical mapping)
  const updateResult = await knex('cal_history')
    .whereIn('status', ['PENDING', 'SKIPPED'])
    .update({
      status: knex.raw("CASE WHEN status = 'PENDING' THEN 'SCHEDULED' WHEN status = 'SKIPPED' THEN 'CANCELLED' END")
    });
  
  if (updateResult > 0) {
    console.log(`Updated ${updateResult} rows with invalid status values`);
  }
  
  console.log('✅ cal_history status enum fixed successfully');
};

exports.down = async function(knex) {
  console.log('Reverting cal_history status enum changes...');
  
  // Drop the fixed constraint
  try {
    await knex.raw('ALTER TABLE cal_history DROP CONSTRAINT chk_cal_history_status');
    console.log('Dropped fixed status constraint');
  } catch (e) {
    console.warn('Constraint chk_cal_history_status not found, skipping...');
  }
  
  // Restore original constraint with PENDING and SKIPPED
  await knex.raw(`
    ALTER TABLE cal_history
    ADD CONSTRAINT chk_cal_history_status
    CHECK (status IN ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED', 'SKIPPED'))
  `);
  console.log('Restored original status enum with PENDING and SKIPPED');
  
  console.log('✅ cal_history status enum reverted successfully');
};