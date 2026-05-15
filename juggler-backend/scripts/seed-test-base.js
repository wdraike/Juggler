#!/usr/bin/env node
/**
 * Seed base test data into juggler_test (port 3308).
 * Called by setup-test-db.sh after migrations complete.
 * Safe to re-run — all inserts are upserts.
 *
 * Usage: NODE_ENV=test node scripts/seed-test-base.js
 */

process.env.NODE_ENV = 'test';

var db = require('../tests/helpers/test-db');
var { seedBaseUser, seedSecondUser } = require('../tests/helpers/seed/base-user');

async function main() {
  try {
    var ok = await db.isAvailable();
    if (!ok) {
      console.error('✗  Test DB not reachable — is the container running?');
      process.exit(1);
    }

    var user = await seedBaseUser(db);
    console.log('✓  Primary test user seeded:', user.id);

    var user2 = await seedSecondUser(db);
    console.log('✓  Secondary test user seeded:', user2.id);

    console.log('✓  Base seed complete');
  } catch (err) {
    console.error('✗  Seed failed:', err.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
