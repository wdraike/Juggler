'use strict';

/**
 * Unit tests for computeCoverage — runnable with Node 22's built-in runner:
 *   node --test e2e/report/ui-coverage.test.js
 *
 * TDD note: authored test-first. Against an empty/absent implementation these
 * RED (module not found / undefined function); after ui-coverage.js they GREEN.
 *
 * Uses a small inline fixture map so the tests do not depend on the large
 * e2e/ui-map.json (decouples the calculator contract from map churn).
 */

const test = require('node:test');
const assert = require('node:assert');
const { computeCoverage } = require('./ui-coverage');

// Inline fixture: 2 screens + 1 modal = 3 surfaces, 2 paths.
const FIXTURE = {
  screens: [
    { id: 'screen:a' },
    { id: 'screen:b' },
  ],
  modals: [
    { id: 'modal:x' },
  ],
  paths: [
    { id: 'path:1' },
    { id: 'path:2' },
  ],
};

test('empty coverage => 0% everywhere, totals intact', () => {
  const r = computeCoverage(FIXTURE, []);
  assert.deepStrictEqual(r.screens, { covered: 0, total: 3, pct: 0 });
  assert.deepStrictEqual(r.paths, { covered: 0, total: 2, pct: 0 });
  assert.deepStrictEqual(r.overall, { covered: 0, total: 5, pct: 0 });
  assert.deepStrictEqual(r.unmatched, []);
});

test('partial coverage computes rounded percentages', () => {
  // 1 of 3 surfaces (33%), 1 of 2 paths (50%), 2 of 5 overall (40%).
  const r = computeCoverage(FIXTURE, ['screen:a', 'path:1']);
  assert.strictEqual(r.screens.covered, 1);
  assert.strictEqual(r.screens.pct, 33);
  assert.strictEqual(r.paths.covered, 1);
  assert.strictEqual(r.paths.pct, 50);
  assert.strictEqual(r.overall.covered, 2);
  assert.strictEqual(r.overall.pct, 40);
  assert.deepStrictEqual(r.unmatched, []);
});

test('full coverage => 100% everywhere', () => {
  const all = ['screen:a', 'screen:b', 'modal:x', 'path:1', 'path:2'];
  const r = computeCoverage(FIXTURE, all);
  assert.strictEqual(r.screens.pct, 100);
  assert.strictEqual(r.paths.pct, 100);
  assert.strictEqual(r.overall.pct, 100);
  assert.strictEqual(r.overall.covered, 5);
  assert.deepStrictEqual(r.unmatched, []);
});

test('unknown covered id goes to unmatched and does NOT inflate covered', () => {
  const r = computeCoverage(FIXTURE, ['screen:a', 'screen:ghost', 'path:does-not-exist']);
  assert.strictEqual(r.screens.covered, 1);
  assert.strictEqual(r.paths.covered, 0);
  assert.strictEqual(r.overall.covered, 1);
  assert.deepStrictEqual(r.unmatched.sort(), ['path:does-not-exist', 'screen:ghost']);
});

test('duplicate covered ids are counted once', () => {
  const r = computeCoverage(FIXTURE, ['screen:a', 'screen:a', 'screen:a', 'path:1', 'path:1']);
  assert.strictEqual(r.screens.covered, 1);
  assert.strictEqual(r.paths.covered, 1);
  assert.strictEqual(r.overall.covered, 2);
});

test('div-by-zero guard: empty category total => pct 0, not NaN', () => {
  const emptyMap = { screens: [], modals: [], paths: [] };
  const r = computeCoverage(emptyMap, []);
  assert.strictEqual(r.screens.total, 0);
  assert.strictEqual(r.screens.pct, 0);
  assert.strictEqual(r.paths.pct, 0);
  assert.strictEqual(r.overall.pct, 0);
  assert.ok(!Number.isNaN(r.overall.pct), 'pct must never be NaN');
});

test('missing map arrays are treated as empty, not crashes', () => {
  const r = computeCoverage({}, ['screen:a']);
  assert.strictEqual(r.overall.total, 0);
  assert.deepStrictEqual(r.unmatched, ['screen:a']);
});
