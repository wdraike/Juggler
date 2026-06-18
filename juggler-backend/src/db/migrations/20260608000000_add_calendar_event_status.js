'use strict';

/**
 * Add calendar event status columns to cal_sync_ledger table
 *
 * This migration adds status tracking columns for calendar events:
 * - event_status: enum column with values (pending, done, skip, cancel)
 * - completed_at: timestamp when event was completed
 * - scheduled_at: timestamp when event is scheduled (required for new rows)
 * - done_frozen: boolean flag for frozen done status
 *
 * Note: Uses 'event_status' instead of 'status' to avoid conflict with existing
 * 'status' column that tracks sync state (active/inactive).
 *
 * The migration preserves existing data and adds proper constraints with
 * COLLATE utf8mb4_unicode_ci per project conventions.
 */

exports.up = async function(knex) {
  console.log('Adding calendar event status columns to cal_sync_ledger...');
  
  await knex.transaction(async (trx) => {
    // 1. Add event_status column with enum constraint (different from existing 'status' column)
    console.log('Adding event_status column...');
    await trx.schema.alterTable('cal_sync_ledger', function(table) {
      table.string('event_status', 20)
        .collate('utf8mb4_unicode_ci')
        .defaultTo('pending')
        .nullable()
        .after('event_all_day');
    });
    
    // Add CHECK constraint for event_status enum values
    console.log('Adding event_status enum constraint...');
    try {
      await trx.raw(`
        ALTER TABLE cal_sync_ledger
        ADD CONSTRAINT chk_cal_sync_ledger_event_status_enum
        CHECK (event_status IN ('pending', 'done', 'skip', 'cancel') OR event_status IS NULL)
      `);
      console.log('Event_status enum constraint added successfully');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Event_status enum constraint already exists, skipping...');
      } else {
        throw error;
      }
    }
    
    // 2. Add completed_at timestamp column
    console.log('Adding completed_at column...');
    await trx.schema.alterTable('cal_sync_ledger', function(table) {
      table.timestamp('completed_at')
        .nullable()
        .defaultTo(null)
        .after('status');
    });
    
    // 3. Add scheduled_at timestamp column (nullable for existing rows)
    console.log('Adding scheduled_at column...');
    await trx.schema.alterTable('cal_sync_ledger', function(table) {
      table.timestamp('scheduled_at')
        .nullable()
        .defaultTo(null)
        .after('completed_at');
    });
    
    // 4. Add done_frozen boolean column
    console.log('Adding done_frozen column...');
    await trx.schema.alterTable('cal_sync_ledger', function(table) {
      table.boolean('done_frozen')
        .defaultTo(false)
        .notNullable()
        .after('scheduled_at');
    });
    
    // 5. Add constraint for scheduled_at validation (required for non-pending events)
    console.log('Adding scheduled_at validation constraint...');
    try {
      await trx.raw(`
        ALTER TABLE cal_sync_ledger
        ADD CONSTRAINT chk_cal_sync_ledger_scheduled_at_required
        CHECK (
          (event_status IS NULL) OR 
          (event_status = 'pending') OR 
          (scheduled_at IS NOT NULL)
        )
      `);
      console.log('Scheduled_at validation constraint added successfully');
    } catch (error) {
      if (error.message.includes('Duplicate key name') || error.message.includes('already exists') || error.message.includes('Duplicate check constraint name')) {
        console.warn('Scheduled_at validation constraint already exists, skipping...');
      } else {
        throw error;
      }
    }
    
    // 6. Update existing rows to have default status
    console.log('Setting default status for existing rows...');
    await trx('cal_sync_ledger')
      .update({
        event_status: 'pending',
        scheduled_at: trx.raw('created_at') // Use created_at as scheduled_at for existing events
      })
      .whereNull('event_status');
  });
  
  console.log('Calendar event status columns added successfully.');
};

exports.down = async function(knex) {
  console.log('Reverting calendar event status columns...');
  
  await knex.transaction(async (trx) => {
    // Remove constraints first
    try {
      await trx.raw('ALTER TABLE cal_sync_ledger DROP CONSTRAINT chk_cal_sync_ledger_scheduled_at_required');
      console.log('Dropped scheduled_at validation constraint');
    } catch (_e) {
      console.warn('Scheduled_at validation constraint not found, skipping...');
    }
    
    try {
      await trx.raw('ALTER TABLE cal_sync_ledger DROP CONSTRAINT chk_cal_sync_ledger_event_status_enum');
      console.log('Dropped event_status enum constraint');
    } catch (_e) {
      console.warn('Event_status enum constraint not found, skipping...');
    }
    
    // Remove columns
    await trx.schema.alterTable('cal_sync_ledger', function(table) {
      table.dropColumn('done_frozen');
      table.dropColumn('scheduled_at');
      table.dropColumn('completed_at');
      table.dropColumn('event_status');
    });
  });
  
  console.log('Calendar event status columns reverted successfully.');
};
