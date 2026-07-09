/**
 * Shared MCP helper: resolve a user's timezone for schedule-derived
 * responses. Looks up `users.timezone` and falls back to 'America/New_York'
 * via safeTimezone when the row is missing or the column is unset.
 *
 * Extracted from the byte-identical local closures previously duplicated
 * across tasks.js, data.js, and schedule.js (jug-mcp-facade WI-1 dedup).
 */
const db = require('../db');
const { safeTimezone } = require('juggler-shared/scheduler/dateHelpers');
const { DEFAULT_TIMEZONE } = require('juggler-shared/scheduler/getNowInTimezone');

async function getUserTimezone(userId) {
  var user = await db('users').where('id', userId).select('timezone').first();
  return safeTimezone(user ? user.timezone : null, DEFAULT_TIMEZONE);
}

module.exports = getUserTimezone;
