/**
 * Jest globalSetup — runs once before all test suites.
 * Runs pending migrations on juggler_test if the DB is reachable.
 * Tests that need DB call db.isAvailable() themselves and skip if false.
 */

process.env.NODE_ENV = 'test';

var knex = require('knex');
var knexConfig = require('../../knexfile');

module.exports = async function globalSetup() {
  var db = knex(knexConfig.test);
  try {
    await db.raw('SELECT 1');
  } catch (e) {
    // DB not running — tests will self-skip via isAvailable()
    await db.destroy();
    return;
  }

  try {
    await db.migrate.latest();
    console.log('\n✓  juggler_test migrations up to date');
  } catch (err) {
    console.error('\n✗  Migration failed in globalSetup:', err.message);
    throw err;
  } finally {
    await db.destroy();
  }
};
