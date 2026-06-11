/**
 * ReplaceLocations — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `replaceLocations` handler (config.controller.js:320-358)
 * over the W3 ConfigRepositoryPort (transaction) + injected cache + the
 * reverse-geocode enrichment collaborator + the injected zod parse.
 *
 * ── STEP-FOR-STEP ────────────────────────────────────────────────────────────
 *   1. parseBody(body) (the legacy locationsBodySchema.safeParse) — !success → 400
 *      { error: 'Invalid locations payload', details: error.issues }.
 *   2. enrich: for each location with lat/lon but no displayName, best-effort
 *      reverseGeocode(lat, lon) — a thrown lookup is swallowed (save without name),
 *      exactly the legacy try/catch around reverseGeocodeDisplayName.
 *   3. repo.runInTransaction(trxRepo => trxRepo.replaceLocations(userId, rows)) — the
 *      delete-all-then-insert the legacy ran inside the transaction. The row mapping
 *      (location_id, sort_order=index, lat/lon/display_name nulls) is built here
 *      byte-identically to config.controller.js:339-348.
 *   4. cache.invalidateConfig(userId).
 *   5. respond { locations: enriched }.
 *
 * ── NO NEW FALLBACKS ── `l.icon || ''`, `l.lat != null ? l.lat : null`,
 * `l.displayName || null` preserved verbatim.
 *
 * @typedef {Object} ReplaceLocationsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {{invalidateConfig: Function}} cache
 * @property {(body: *) => {success: boolean, data?: {locations: Object[]}, error?: {issues: *}}} parseBody
 *   the locationsBodySchema.safeParse — injected so the application layer stays
 *   zod-free (W6 supplies the schema).
 * @property {(lat: number, lon: number) => Promise<string>} reverseGeocode
 *   the reverseGeocodeDisplayName collaborator (weather controller) — injected.
 */

'use strict';

/** @param {ReplaceLocationsDeps} deps */
function ReplaceLocations(deps) {
  if (!deps || !deps.repo || !deps.cache || !deps.parseBody || !deps.reverseGeocode) {
    throw new Error('ReplaceLocations: { repo, cache, parseBody, reverseGeocode } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.parseBody = deps.parseBody;
  this.reverseGeocode = deps.reverseGeocode;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.body  the raw request body ({ locations: [...] }).
 * @returns {Promise<{ status: number, body: Object }>}
 */
ReplaceLocations.prototype.execute = async function execute(input) {
  var self = this;
  var userId = input.userId;

  var parsed = this.parseBody(input.body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'Invalid locations payload', details: parsed.error.issues } };
  }
  var locations = parsed.data.locations;

  // Fill in missing display names for locations that have coords but no name.
  var enriched = await Promise.all(locations.map(async function (l) {
    if (l.lat != null && l.lon != null && !l.displayName) {
      try {
        l = Object.assign({}, l, { displayName: await self.reverseGeocode(l.lat, l.lon) });
      } catch { /* best-effort — save without display name if lookup fails */ }
    }
    return l;
  }));

  await this.repo.runInTransaction(function (trxRepo) {
    var rows = enriched.map(function (l, i) {
      return {
        user_id: userId,
        location_id: l.id,
        name: l.name,
        icon: l.icon || '',
        sort_order: i,
        lat: l.lat != null ? l.lat : null,
        lon: l.lon != null ? l.lon : null,
        display_name: l.displayName || null
      };
    });
    return trxRepo.replaceLocations(userId, rows);
  });

  await this.cache.invalidateConfig(userId);
  return { status: 200, body: { locations: enriched } };
};

module.exports = ReplaceLocations;
