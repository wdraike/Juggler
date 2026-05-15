/**
 * Seed utilities — single import for all test DB helpers.
 *
 * Usage:
 *   const seed = require('./seed');
 *   await seed.seedBaseUser(db);
 *   const ctx = await seed.simpleOneOffs(db, userId);
 *   const t = await seed.createTask(db, userId, { text: 'Thing', dur: 30 });
 */

module.exports = {
  ...require('./base-user'),
  ...require('./task-factory'),
  ...require('./scenarios')
};
