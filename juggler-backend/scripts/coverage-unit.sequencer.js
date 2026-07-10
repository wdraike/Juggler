/**
 * Deterministic (alphabetical-by-path) jest test sequencer — 999.1206.
 *
 * Jest's default sequencer orders suites by CACHED per-suite timings, so the
 * execution order changes run-to-run. The juggler suite has known cross-file
 * bleed (stray timers — see test-helpers/afterEachFile.js), so a shifting
 * order makes a DIFFERENT small set of victim suites flake on every run.
 * Pinning the order makes the coverage baseline reproducible and any
 * order-coupled failure stable and attributable.
 */

'use strict';

const Sequencer = require('@jest/test-sequencer').default;

class AlphabeticalSequencer extends Sequencer {
  sort(tests) {
    return Array.from(tests).sort((a, b) => (a.path > b.path ? 1 : a.path < b.path ? -1 : 0));
  }
}

module.exports = AlphabeticalSequencer;
