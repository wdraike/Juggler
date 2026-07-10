/**
 * GetFeatureEventsReport — application query use-case (999.1196).
 *
 * Extracted VERBATIM from feature-events.routes.js GET / handler: clamps
 * days/limit, validates event_type, queries `feature_events` for the raw
 * event list plus a feature_key/event_type aggregation, and JSON-parses the
 * `value` column for the response.
 *
 * The service-key auth guard (authenticateServiceKey) is a ROUTE-EDGE concern
 * and stays in feature-events.routes.js — mirrors the billing-webhooks
 * HMAC-signature guard staying in its route (facade.js "ROUTE-EDGE GUARDS
 * PRESERVED" convention).
 *
 * @typedef {Object} GetFeatureEventsReportDeps
 * @property {Function} db  knex instance (queries feature_events)
 */

'use strict';

var MAX_DAYS = 90;
var MAX_LIMIT = 1000;
var ALLOWED_EVENT_TYPES = new Set(['used', 'blocked', 'limit_reached']);

function clampInt(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** @param {GetFeatureEventsReportDeps} deps */
function GetFeatureEventsReport(deps) {
  this._db = deps.db;
}

/**
 * @param {Object} input  req.query shape: { feature_key, event_type, user_id, days, limit }
 * @returns {Promise<{status: number, body: Object}>}
 */
GetFeatureEventsReport.prototype.execute = async function execute(input) {
  var db = this._db;
  var featureKey = input.feature_key;
  var eventType = input.event_type;
  var userId = input.user_id;
  var days = clampInt(input.days, 30, 1, MAX_DAYS);
  var limit = clampInt(input.limit, 100, 1, MAX_LIMIT);
  var since = new Date();
  since.setDate(since.getDate() - days);

  if (eventType && !ALLOWED_EVENT_TYPES.has(eventType)) {
    return { status: 400, body: { error: 'Invalid event_type' } };
  }

  var query = db('feature_events')
    .where('created_at', '>=', since)
    .orderBy('created_at', 'desc')
    .limit(limit);

  if (featureKey) query = query.where('feature_key', featureKey);
  if (eventType) query = query.where('event_type', eventType);
  if (userId) query = query.where('user_id', userId);

  var events = await query;

  var aggQuery = db('feature_events')
    .where('created_at', '>=', since)
    .select('feature_key', 'event_type')
    .count('id as count')
    .groupBy('feature_key', 'event_type')
    .orderBy('count', 'desc');

  if (featureKey) aggQuery = aggQuery.where('feature_key', featureKey);

  var aggregated = await aggQuery;

  return {
    status: 200,
    body: {
      success: true,
      period_days: days,
      total_events: events.length,
      aggregated: aggregated,
      events: events.map(function (e) {
        return Object.assign({}, e, {
          value: typeof e.value === 'string' ? JSON.parse(e.value) : e.value
        });
      })
    }
  };
};

module.exports = GetFeatureEventsReport;
