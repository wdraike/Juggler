/**
 * KnexFeatureEventsRepository — feature_events audit-log write + read access,
 * moved VERBATIM from user-config/facade.js (JUG-FACADE-DB-VIOLATIONS stage 2b)
 * so the facade carries no direct db access (adapters are the slice's only DB
 * layer — see eslint.boundaries.config.js DB_DIRECT_SELECTORS).
 *
 * - logFeatureEvent is feature-gate.js's audit-log insert (Surface-6 golden-master
 *   pin, incl. the FLAG-2 req-vs-userId branching and the fire-and-forget .catch —
 *   errors never reject the caller). Reproduced byte-for-byte, incl. the
 *   pre-existing dual `planId`/`plan_id` write.
 * - query() is the feature_events read seam GetFeatureEventsReport (999.1196)
 *   uses instead of a raw injected knex handle — same table, same call shape
 *   (`db('feature_events')`) the use-case already calls; the facade now hands it
 *   this adapter function instead of `getDb()`.
 */

'use strict';

var libDb = require('../../../lib/db');
var { createLogger } = require('@raike/lib-logger');
// Preserves the ORIGINAL log source label ('user-config.facade') — this is a
// relocation, not a rename; anything filtering logs on that label keeps working.
var logger = createLogger('user-config.facade');

function getDb() { return libDb.getDefaultDb(); }

/**
 * feature-gate.js's audit-log insert (Surface-6 pin). Verbatim relocation of
 * user-config/facade.js's logFeatureEvent.
 * @param {Object|string} reqOrUserId  req object (object-typeof branch) or a bare userId string
 * @param {string} featureKey
 * @param {string} eventType
 * @param {*} [value]
 * @returns {Promise<void>} never rejects — insert failures are logged and swallowed
 */
function logFeatureEvent(reqOrUserId, featureKey, eventType, value) {
  var userId = typeof reqOrUserId === 'object' ? (reqOrUserId.user && reqOrUserId.user.id) : reqOrUserId;
  var planId = typeof reqOrUserId === 'object' ? reqOrUserId.planId : 'free';
  return getDb()('feature_events').insert({
    user_id: userId,
    feature_key: featureKey,
    event_type: eventType,
    planId: planId || 'free',
    plan_id: typeof reqOrUserId === 'object' ? (reqOrUserId.planId || null) : null,
    endpoint: typeof reqOrUserId === 'object' ? (reqOrUserId.method + ' ' + (reqOrUserId.originalUrl || reqOrUserId.url)) : null,
    ip_address: typeof reqOrUserId === 'object' ? (reqOrUserId.ip || (reqOrUserId.headers && reqOrUserId.headers['x-forwarded-for']) || null) : null,
    request_id: typeof reqOrUserId === 'object' ? ((reqOrUserId.headers && reqOrUserId.headers['x-request-id']) || null) : null,
    value: value ? JSON.stringify(value) : null,
    created_at: new Date()
  }).catch(function (err) {
    logger.error('[feature-gate] Failed to log event:', { error: err });
  });
}

/**
 * feature_events query seam for GetFeatureEventsReport (999.1196 GET / route).
 * The use-case calls its injected `db` as `db('feature_events')` — this is
 * that same call shape, sourced from the adapter's own db handle instead of a
 * facade-held one. Honors its table arg (harrison INFO, stage 2b review) so a
 * future second-table read in the use-case cannot silently query the wrong
 * table; defaults to feature_events for the current call shape.
 * @param {string} [table]  table name; defaults to 'feature_events'.
 * @returns {*} a fresh knex query builder
 */
function query(table) {
  return getDb()(table || 'feature_events');
}

module.exports = { logFeatureEvent: logFeatureEvent, query: query };
