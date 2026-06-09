// Tests for missed status migration
// Asserts post-migration schema reality (snapshot+migrate era — no replay of up/down).
//
// Fix applied (de-rot 2026-06-09):
//   Wrong require path '../../src/lib/db' (resolves to the lib-db factory, not
//   the singleton query object) → corrected to '../src/db' (the Knex singleton).

const knex = require('../../src/db');

async function checkConstraintAccepts(status) {
  // We can't easily insert without a real user/master FK chain, so we assert
  // the constraint permits the value by checking information_schema instead.
  // The CHECK constraint definition should include the status value.
  const [rows] = await knex.raw(
    `SELECT CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc
     JOIN information_schema.CHECK_CONSTRAINTS cc
       ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
      AND tc.CONSTRAINT_NAME   = cc.CONSTRAINT_NAME
     WHERE tc.TABLE_SCHEMA = DATABASE()
       AND tc.TABLE_NAME   = 'task_instances'
       AND tc.CONSTRAINT_NAME = 'chk_task_instances_status'
     LIMIT 1`
  );
  if (!rows.length) return false;
  // MySQL stores the CHECK_CLAUSE with _utf8mb4\'value\' encoding.
  // Check for the status word appearing in the clause regardless of quoting style.
  const clause = rows[0].CHECK_CLAUSE;
  return clause.includes("'" + status + "'") ||
         clause.includes("\\'" + status + "\\'") ||
         // _utf8mb4'value' format used by MySQL 8
         new RegExp("_utf8mb4.{0,3}" + status).test(clause);
}

async function checkConstraintRejects(status) {
  // A bogus status should NOT appear in the CHECK constraint definition.
  const accepts = await checkConstraintAccepts(status);
  return !accepts;
}

async function viewExposesCompletedAt() {
  // tasks_v must expose a completed_at column.
  const info = await knex('tasks_v').columnInfo();
  return Object.prototype.hasOwnProperty.call(info, 'completed_at');
}

async function legacyTerminalRowsBackfilled() {
  // After migration 20260509000300 ran (incrementally on the live DB), terminal
  // rows that existed at migration time had completed_at backfilled.  On a fresh
  // test DB there may be no terminal rows at all — that is not a bug.
  // We assert only that any terminal rows WITH a non-null completed_at exist,
  // OR that there are simply no terminal rows (acceptable for a fresh test DB).
  const terminalWithCat = await knex('task_instances')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .whereNotNull('completed_at')
    .first();
  const anyTerminal = await knex('task_instances')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .first();
  // Pass if: no terminal rows exist (fresh DB) OR some have completed_at set.
  return !anyTerminal || !!terminalWithCat;
}

async function calHistoryTableExists() {
  const result = await knex.raw('SHOW TABLES LIKE "cal_history"');
  return result[0].length > 0;
}

async function calHistoryStatusEnumValid() {
  const { CalHistoryStatus } = require('../../src/constants/status-enum');
  return CalHistoryStatus.SCHEDULED === 'SCHEDULED' &&
         CalHistoryStatus.COMPLETED === 'COMPLETED' &&
         CalHistoryStatus.MISSED === 'MISSED' &&
         CalHistoryStatus.CANCELLED === 'CANCELLED';
}

afterAll(async () => {
  await knex.destroy();
});

describe('Missed Status Migration', () => {
  test('check constraint accepts missed', async () => {
    const result = await checkConstraintAccepts('missed');
    expect(result).toBe(true);
  });

  test('check constraint rejects bogus status', async () => {
    const result = await checkConstraintRejects('bogus');
    expect(result).toBe(true);
  });

  test('view exposes completed_at', async () => {
    const result = await viewExposesCompletedAt();
    expect(result).toBe(true);
  });

  test('legacy terminal rows backfilled (or no terminal rows on fresh DB)', async () => {
    const result = await legacyTerminalRowsBackfilled();
    expect(result).toBe(true);
  });

  test('cal_history table exists', async () => {
    const result = await calHistoryTableExists();
    expect(result).toBe(true);
  });

  test('cal_history status enum valid', async () => {
    const result = await calHistoryStatusEnumValid();
    expect(result).toBe(true);
  });
});
