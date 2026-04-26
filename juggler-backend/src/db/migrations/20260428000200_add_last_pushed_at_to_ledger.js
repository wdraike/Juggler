exports.up = async function(knex) {
  await knex.raw(`
    ALTER TABLE cal_sync_ledger
    ADD COLUMN last_pushed_at TIMESTAMP NULL DEFAULT NULL
    AFTER last_pushed_hash
  `);
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.dropColumn('last_pushed_at');
  });
};
