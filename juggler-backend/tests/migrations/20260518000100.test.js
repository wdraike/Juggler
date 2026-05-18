/**
 * 20260518000100.test.js — placement_mode ENUM redesign (Phase 9 Plan 1)
 *
 * Verifies post-migration schema and data invariants:
 *   1. placement_mode column is the new 6-value ENUM
 *   2. No rows carry any old 7-value enum values
 *   3. No 'allday' or 'fixed' tokens remain in the `when` column
 *   4. tasks_v view computes marker/rigid from new enum values
 *   5. tasks_with_sync_v view exists and returns marker/rigid columns
 *   6. down() throws (not a no-op — rollback is not possible)
 */

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

var db = require('../../src/db');
var migration = require('../../src/db/migrations/20260518000100_placement_mode_enum_redesign');

var _dbAvailable = null;
async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    _dbAvailable = false;
  }
  return _dbAvailable;
}

function skipIfNoDB(fn) {
  return async () => {
    if (!await isDbAvailable()) return;
    await fn();
  };
}

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await db.destroy();
});

describe('migration 20260518000100_placement_mode_enum_redesign (Phase 9-01)', () => {

  test('placement_mode column is the new 6-value ENUM with DEFAULT anytime', skipIfNoDB(async () => {
    var [rows] = await db.raw('SHOW COLUMNS FROM task_masters LIKE \'placement_mode\'');
    expect(rows).toHaveLength(1);
    var col = rows[0];
    expect(col.Type).toBe("enum('reminder','all_day','fixed','time_window','time_blocks','anytime')");
    expect(col.Null).toBe('NO');
    expect(col.Default).toBe('anytime');
  }));

  test('no rows carry any old 7-value enum values', skipIfNoDB(async () => {
    var [rows] = await db.raw(`
      SELECT COUNT(*) as cnt FROM task_masters
      WHERE placement_mode IN ('marker','pinned_date','recurring_rigid','recurring_window','recurring_flexible','flexible')
    `);
    expect(rows[0].cnt).toBe(0);
  }));

  test('all placement_mode values are from the new 6-value set', skipIfNoDB(async () => {
    var [rows] = await db.raw('SELECT DISTINCT placement_mode FROM task_masters ORDER BY placement_mode');
    var validValues = new Set(['reminder', 'all_day', 'fixed', 'time_window', 'time_blocks', 'anytime']);
    for (var row of rows) {
      expect(validValues.has(row.placement_mode)).toBe(true);
    }
  }));

  test('no allday or fixed tokens remain in the when column', skipIfNoDB(async () => {
    var [rows] = await db.raw(`
      SELECT COUNT(*) as cnt FROM task_masters
      WHERE \`when\` LIKE '%allday%' OR \`when\` LIKE '%fixed%'
    `);
    expect(rows[0].cnt).toBe(0);
  }));

  test('tasks_v view exists and returns marker/rigid computed from new enum values', skipIfNoDB(async () => {
    // Verify view exists and returns without error
    var [rows] = await db.raw('SELECT marker, rigid, placement_mode FROM tasks_v LIMIT 10');
    // marker=1 only for reminder rows; rigid=1 only for fixed rows
    for (var row of rows) {
      if (row.placement_mode === 'reminder') {
        expect(row.marker).toBe(1);
        expect(row.rigid).toBe(0);
      } else if (row.placement_mode === 'fixed') {
        expect(row.rigid).toBe(1);
        expect(row.marker).toBe(0);
      } else {
        expect(row.marker).toBe(0);
        expect(row.rigid).toBe(0);
      }
    }
  }));

  test('tasks_with_sync_v view exists and exposes marker and rigid columns', skipIfNoDB(async () => {
    var [rows] = await db.raw('SELECT marker, rigid FROM tasks_with_sync_v LIMIT 1');
    // Just verifies the view exists and returns the columns without error.
    // Row count may be 0 if no data — that is fine.
    expect(Array.isArray(rows)).toBe(true);
  }));

  test('down() throws an error (rollback not implemented)', async () => {
    await expect(migration.down(db)).rejects.toThrow(
      /Down migration for placement_mode_enum_redesign not implemented/
    );
  });

});
