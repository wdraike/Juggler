/**
 * GetLocations — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `getLocations` handler (config.controller.js:303-318) over
 * the W3 ConfigRepositoryPort: read locations ordered by sort_order, map to the
 * {id,name,icon,lat,lon,displayName} API shape (lat/lon parseFloat'd when present,
 * displayName `|| undefined`), return { status: 200, body: {locations} }.
 *
 * ── NO NEW FALLBACKS ── every `|| undefined` is preserved verbatim from the handler.
 *
 * @typedef {Object} GetLocationsDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {Function} [parseFloat]  injected; defaults to global parseFloat.
 */

'use strict';

/** @param {GetLocationsDeps} deps */
function GetLocations(deps) {
  if (!deps || !deps.repo) throw new Error('GetLocations: { repo } is required');
  this.repo = deps.repo;
  this._parseFloat = deps.parseFloat || parseFloat;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetLocations.prototype.execute = async function execute(input) {
  var pf = this._parseFloat;
  var rows = await this.repo.getLocations(input.userId);
  return {
    status: 200,
    body: {
      locations: rows.map(function (l) {
        return {
          id: l.location_id,
          name: l.name,
          icon: l.icon,
          lat: l.lat != null ? pf(l.lat) : undefined,
          lon: l.lon != null ? pf(l.lon) : undefined,
          displayName: l.display_name || undefined
        };
      })
    }
  };
};

module.exports = GetLocations;
