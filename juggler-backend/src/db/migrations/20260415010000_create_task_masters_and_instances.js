/**
 * Create task_masters (user intent) and task_instances (scheduler-placed occurrences).
 *
 * Model:
 *   - task_masters: one row per logical task. Holds user-provided settings only.
 *   - task_instances: N rows per master (N=1 for one-shots, N>=1 for recurring/splits).
 *     Holds scheduler-decided placement and per-occurrence state.
 *     Linked to master via master_id. Compound ordinal (occurrence_ordinal, split_ordinal).
 *
 * This migration only creates empty tables. Backfill from the `tasks` table runs in
 * the next migration (20260415010100). Dropping `tasks` runs last (20260415010300).
 */
exports.up = async function(knex) {
  await knex.schema.createTable('task_masters', function(table) {
    table.string('id', 100).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');

    // Identity
    table.string('text', 1000);
    table.string('project', 255);
    table.string('section', 255);
    table.text('notes');

    // Duration / priority
    table.integer('dur').defaultTo(30);
    table.string('pri', 5).defaultTo('P3');

    // Scheduling intent
    table.datetime('desired_at').nullable();
    table.date('desired_date').nullable();
    table.date('due_at').nullable();
    table.date('start_after_at').nullable();
    table.string('when', 255).nullable();
    table.string('day_req', 30).nullable();
    table.integer('time_flex').nullable();
    table.boolean('flex_when').defaultTo(false);
    table.boolean('rigid').defaultTo(false);
    table.boolean('marker').defaultTo(false);
    table.integer('preferred_time_mins').nullable();
    table.string('tz', 100).nullable();
    table.string('prev_when', 255).nullable();

    // Recurrence
    table.boolean('recurring').defaultTo(false);
    table.json('recur').nullable().comment('{type, days, every}');
    table.date('recur_start').nullable();
    table.date('recur_end').nullable();

    // Split config
    table.boolean('split').nullable();
    table.integer('split_min').nullable();

    // Dependencies / context
    table.json('depends_on').nullable();
    table.json('location').nullable();
    table.json('tools').nullable();
    table.integer('travel_before').nullable();
    table.integer('travel_after').nullable();

    // Lifecycle (master-level only — applies to all instances)
    table.timestamp('disabled_at').nullable();
    table.string('disabled_reason', 50).nullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index(['user_id', 'project']);
  });

  await knex.schema.createTable('task_instances', function(table) {
    table.string('id', 100).primary();
    table.string('master_id', 100).notNullable().references('id').inTable('task_masters').onDelete('CASCADE');
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');

    // Ordinals — compound identity within a master
    table.integer('occurrence_ordinal').notNullable().defaultTo(1).comment('1 for one-shot; 1..N for recurring');
    table.integer('split_ordinal').notNullable().defaultTo(1).comment('1 for unsplit; 1..N for split chunks');
    table.integer('split_total').notNullable().defaultTo(1).comment('Total chunks in this occurrence');

    // Placement — scheduler-owned
    table.datetime('scheduled_at').nullable();
    table.integer('dur').notNullable().defaultTo(30).comment('Per-chunk duration for splits');

    // Derived local-tz caches (recomputed from scheduled_at on write)
    table.string('date', 10).nullable().comment('M/D');
    table.string('day', 3).nullable();
    table.string('time', 20).nullable().comment('9:00 AM');

    // User-pin overrides
    table.boolean('date_pinned').defaultTo(false);
    table.string('original_date', 10).nullable();
    table.string('original_time', 20).nullable();
    table.string('original_day', 3).nullable();

    // Per-occurrence state
    table.string('status', 10).defaultTo('').comment('empty, done, wip, skip, cancel, unscheduled');
    table.integer('time_remaining').nullable();
    table.boolean('unscheduled').nullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['master_id', 'occurrence_ordinal', 'split_ordinal'], 'uq_instance_ordinals');
    table.index('master_id');
    table.index(['user_id', 'scheduled_at']);
    table.index(['user_id', 'status']);
    table.index(['user_id', 'date']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('task_instances');
  await knex.schema.dropTableIfExists('task_masters');
};
