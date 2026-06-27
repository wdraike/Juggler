#!/usr/bin/env node
'use strict';

/**
 * collect-coverage.js — harvest @covers annotations from E2E specs and report
 * UI coverage against e2e/ui-map.json.
 *
 * Run:  node e2e/report/collect-coverage.js
 *
 * It scans BOTH spec trees recursively for lines like:
 *     // @covers screen:daily
 *     // @covers path:2
 *   - tests/e2e/**\/*.spec.js  (the pre-existing smoke suite)
 *   - e2e/specs/**\/*.spec.js  (the new per-surface specs)
 * collects every referenced id, and feeds them to the pure computeCoverage
 * calculator. Output is a human-readable report; it does NOT launch a browser,
 * touch a DB, or start a server.
 *
 * Sentinel: `@covers none` explicitly declares a spec exercises NO UI surface
 * (e.g. a backend/MCP integration smoke). It is dropped here so it is neither
 * counted nor reported as an unmatched id.
 */

const fs = require('node:fs');
const path = require('node:path');
const { computeCoverage } = require('./ui-coverage');

const E2E_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(E2E_DIR, '..');
const MAP_PATH = path.join(E2E_DIR, 'ui-map.json');
// Both spec trees contribute coverage. Paths are relative to juggler-frontend/.
const SPEC_DIRS = [
  path.join(FRONTEND_DIR, 'tests', 'e2e'),
  path.join(E2E_DIR, 'specs'),
];

const COVERS_RE = /@covers\s+([A-Za-z0-9:_-]+)/g;
// `none` is a documented sentinel — "this spec covers no UI surface" — and is
// never treated as a map id.
const SENTINELS = new Set(['none']);

function loadMap() {
  const raw = fs.readFileSync(MAP_PATH, 'utf8');
  return JSON.parse(raw);
}

function specFilesUnder(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...specFilesUnder(full));
    } else if (entry.isFile() && entry.name.endsWith('.spec.js')) {
      out.push(full);
    }
  }
  return out;
}

function collectCoveredIds() {
  const covered = [];
  for (const dir of SPEC_DIRS) {
    for (const file of specFilesUnder(dir)) {
      const contents = fs.readFileSync(file, 'utf8');
      let m;
      while ((m = COVERS_RE.exec(contents)) !== null) {
        if (SENTINELS.has(m[1])) continue;
        covered.push(m[1]);
      }
    }
  }
  return covered;
}

function allMapIds(uiMap) {
  const ids = [];
  for (const k of ['screens', 'modals', 'paths']) {
    if (Array.isArray(uiMap[k])) {
      for (const e of uiMap[k]) ids.push(e.id);
    }
  }
  return ids;
}

function bar(label, cat) {
  return `  ${label.padEnd(10)} ${String(cat.covered).padStart(3)}/${String(cat.total).padEnd(3)}  ${String(cat.pct).padStart(3)}%`;
}

function main() {
  const uiMap = loadMap();
  const coveredIds = collectCoveredIds();
  const result = computeCoverage(uiMap, coveredIds);

  const knownIds = new Set(allMapIds(uiMap));
  const coveredSet = new Set(coveredIds.filter((id) => knownIds.has(id)));
  const uncovered = [...knownIds].filter((id) => !coveredSet.has(id)).sort();

  console.log('');
  console.log('=== Juggler UI E2E Coverage ===');
  console.log(`map:   ${path.relative(process.cwd(), MAP_PATH)}`);
  for (const dir of SPEC_DIRS) {
    console.log(`specs: ${path.relative(process.cwd(), dir)}/**/*.spec.js`);
  }
  console.log(`@covers annotations found: ${coveredIds.length}`);
  console.log('');
  console.log(bar('surfaces', result.screens));
  console.log(bar('paths', result.paths));
  console.log(bar('OVERALL', result.overall));
  console.log('');

  if (result.unmatched.length > 0) {
    console.log(`WARNING — @covers ids not present in ui-map.json (${result.unmatched.length}):`);
    for (const id of result.unmatched.sort()) console.log(`  ! ${id}`);
    console.log('');
  }

  console.log(`Still uncovered (${uncovered.length}):`);
  for (const id of uncovered) console.log(`  - ${id}`);
  console.log('');
  console.log('NOTE: partial coverage is expected — the retrofitted tests/e2e smoke suite');
  console.log('plus the new e2e/specs establish the @covers pattern; the rest are authored as the map grows.');
  console.log('');
}

main();
