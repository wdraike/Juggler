'use strict';

/**
 * ui-coverage.js — PURE coverage calculator for the juggler UI map.
 *
 * No I/O, no requires, CommonJS. Given a parsed ui-map.json and a list of
 * covered ids (harvested from @covers annotations in E2E specs), it reports
 * how much of the known UI surface is exercised.
 *
 * Categories:
 *   - "screens"  = screens[] ∪ modals[]  (all reachable surfaces)
 *   - "paths"    = paths[]               (transitions between surfaces)
 *   - "overall"  = screens + paths
 *
 * Integrity rules (per project CLAUDE.md "No unapproved fallbacks"):
 *   - A covered id that is NOT in the map is NEVER silently counted. It is
 *     returned in `unmatched` and excluded from `covered`.
 *   - coveredIds are de-duplicated before counting (each id counts once).
 *   - The ONLY permitted default is the div-by-zero guard: when a category
 *     total is 0, pct is 0 (we cannot divide by zero). This is documented and
 *     intentional — not a fallback masking missing data.
 */

function round(n) {
  return Math.round(n);
}

function pct(covered, total) {
  // Documented div-by-zero guard: an empty category is 0% by definition.
  if (total === 0) {
    return 0;
  }
  return round((covered / total) * 100);
}

function idsOf(list) {
  // Map entries are required to carry an `id`; a missing id is a data bug,
  // not something to paper over — we surface it by throwing.
  return list.map(function (entry) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error('ui-map entry missing string id: ' + JSON.stringify(entry));
    }
    return entry.id;
  });
}

/**
 * @param {object} uiMap   parsed ui-map.json ({ screens, modals, paths })
 * @param {string[]} coveredIds  ids referenced by E2E specs
 * @returns {{
 *   screens: {covered:number,total:number,pct:number},
 *   paths:   {covered:number,total:number,pct:number},
 *   overall: {covered:number,total:number,pct:number},
 *   unmatched: string[]
 * }}
 */
function computeCoverage(uiMap, coveredIds) {
  const screens = Array.isArray(uiMap.screens) ? uiMap.screens : [];
  const modals = Array.isArray(uiMap.modals) ? uiMap.modals : [];
  const paths = Array.isArray(uiMap.paths) ? uiMap.paths : [];

  const surfaceIds = new Set(idsOf(screens).concat(idsOf(modals)));
  const pathIds = new Set(idsOf(paths));
  const knownIds = new Set([...surfaceIds, ...pathIds]);

  // De-dupe covered ids — each id counts at most once.
  const uniqueCovered = new Set(coveredIds);

  let surfacesCovered = 0;
  let pathsCovered = 0;
  const unmatched = [];

  for (const id of uniqueCovered) {
    if (surfaceIds.has(id)) {
      surfacesCovered += 1;
    } else if (pathIds.has(id)) {
      pathsCovered += 1;
    } else {
      // Covered but unknown to the map — never inflates covered counts.
      unmatched.push(id);
    }
  }

  const surfacesTotal = surfaceIds.size;
  const pathsTotal = pathIds.size;
  const overallCovered = surfacesCovered + pathsCovered;
  const overallTotal = knownIds.size;

  return {
    screens: {
      covered: surfacesCovered,
      total: surfacesTotal,
      pct: pct(surfacesCovered, surfacesTotal),
    },
    paths: {
      covered: pathsCovered,
      total: pathsTotal,
      pct: pct(pathsCovered, pathsTotal),
    },
    overall: {
      covered: overallCovered,
      total: overallTotal,
      pct: pct(overallCovered, overallTotal),
    },
    unmatched: unmatched,
  };
}

module.exports = { computeCoverage };
