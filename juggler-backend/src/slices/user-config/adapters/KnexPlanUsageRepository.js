/**
 * KnexPlanUsageRepository — plan_usage entitlement metering, moved VERBATIM
 * from user-config/facade.js (JUG-FACADE-DB-VIOLATIONS stage 2) so the facade
 * carries no direct db access (adapters are the slice's only DB layer).
 *
 * checkAndIncrement's INSERT ... ON DUPLICATE KEY UPDATE is the concurrency
 * contract: a SINGLE atomic statement, not a read-then-write and not a
 * transaction — two concurrent gate checks may not lose an increment.
 * GateFeature (application) treats any thrown error as fail-open (allow) by
 * design; this adapter must not add its own catch.
 */

'use strict';

var libDb = require('../../../lib/db');
function getDb() { return libDb.getDefaultDb(); }

async function checkAndIncrement(userId, usageKey, limit, periodStart, periodEnd) {
  var db = getDb();
  // `await` (not `.then`) — db.raw resolves to a query that is awaited, exactly as
  // the legacy feature-gate.js:133-140 did (the mock's raw returns a plain value).
  await db.raw(
    'INSERT INTO plan_usage (user_id, usage_key, period_start, period_end, `count`, limit_value, updated_at)\n' +
    '    VALUES (?, ?, ?, ?, 1, ?, NOW())\n' +
    '    ON DUPLICATE KEY UPDATE\n' +
    '      `count` = `count` + 1,\n' +
    '      limit_value = ?,\n' +
    '      updated_at = NOW()',
    [userId, usageKey, periodStart, periodEnd, limit, limit]
  );

  var row = await db('plan_usage')
    .where('user_id', userId)
    .where('usage_key', usageKey)
    .where('period_start', periodStart)
    .first();

  return { allowed: row.count <= limit, currentCount: row.count, limit: limit };
}

module.exports = { checkAndIncrement: checkAndIncrement };
