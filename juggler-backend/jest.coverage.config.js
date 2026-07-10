/**
 * jest.coverage.config.js — 999.1206: measurable coverage WITHOUT the DB gate.
 *
 * Extends the base jest.config.js but swaps the DB globalSetup (which requires
 * a live test-bed MySQL on 3407 and refuses anything else) for the empty one,
 * so the mock-based subset of the suite can run --coverage on any machine with
 * no docker dependency.
 *
 * This config is driven by scripts/coverage-unit.js, which selects the no-DB
 * test files (DB-backed suites are TEST-FR-001 fail-loud and are excluded
 * there). Do not point a bare `npx jest --config jest.coverage.config.js` at
 * the whole suite — DB suites will fail loud by design.
 *
 * Coverage threshold: intentionally ABSENT here. This config exists to make
 * the number real and reproducible, not to gate. The measured baseline is
 * recorded by scripts/coverage-unit.js output; ratchet floors stay in the base
 * jest.config.js for the full test-bed run.
 */

'use strict';

const base = require('./jest.config');

// Drop the full-suite ratchet floor: the unit subset covers less than the
// full DB-backed suite by construction, and this run measures, not gates.
const { coverageThreshold, ...rest } = base;
void coverageThreshold;

module.exports = {
  ...rest,
  globalSetup: '<rootDir>/tests/helpers/empty-globalSetup.js',
  coverageDirectory: '<rootDir>/coverage',
  // Deterministic suite order: the default sequencer sorts by cached timings,
  // which shuffles order every run and lets the suite's known cross-file timer
  // bleed pick a DIFFERENT victim set each time. Alphabetical order makes the
  // baseline (and any order-coupled failure) reproducible.
  testSequencer: '<rootDir>/scripts/coverage-unit.sequencer.js',
};
