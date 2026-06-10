'use strict';

/**
 * requireDB — TEST-FR-001 shared guard for DB-backed tests
 *
 * Traceability: .planning/kermit/TRACEABILITY-juggler-test-nodb-failloud.md BUG-1
 * Governing requirement: TEST-FR-001 (docs/testing/TESTING-STANDARDS.md
 *   §Test Integrity Requirements)
 *
 * When the required DB is unavailable, the wrapped test THROWS (loud FAIL),
 * never silently returns (false PASS with zero assertions).
 *
 * Usage — wrapping a full test body:
 *   const { requireDB } = require('../helpers/requireDB');
 *   test('my test', requireDB(async () => { ... }));
 *
 * With a custom probe (for files whose DB handle lives outside test-db.js):
 *   test('my test', requireDB(async () => { ... }, () => isDbAvailable()));
 *
 * Usage — in-body assert (for tests that guard inline):
 *   const { assertDbAvailable } = require('../helpers/requireDB');
 *   test('my test', async () => {
 *     await assertDbAvailable();          // throws TEST-FR-001 if DB is down
 *     await assertDbAvailable(myProbe);   // custom probe variant
 *     ... rest of test body ...
 *   });
 *
 * The default probe is test-db.js isAvailable() — the canonical test-bed
 * availability check (MySQL at 127.0.0.1:3407, juggler_test).
 *
 * Invariants (no-unapproved-fallbacks rule):
 *   - If the probe itself throws, the error propagates — never a silent pass.
 *   - No || / ?? fallback is ever added to re-enable silent skipping.
 */

var testDb = require('./test-db');

/**
 * Returns an async wrapper that:
 *   - Calls probe() to check DB availability.
 *   - If unavailable (or probe throws): throws an Error identifying TEST-FR-001.
 *   - If available: calls fn(...args) and propagates its return value / errors.
 *
 * @param {Function} fn       The test body (async function).
 * @param {Function} [probe]  Optional async availability probe. Defaults to
 *                            testDb.isAvailable. Must return a truthy value when
 *                            the DB is reachable. If it throws, the error is
 *                            re-thrown as a TEST-FR-001 failure.
 * @returns {Function}        An async wrapper suitable as a Jest test callback.
 */
function requireDB(fn, probe) {
  var resolvedProbe = probe || testDb.isAvailable;

  return async function () {
    var available;
    try {
      available = await resolvedProbe();
    } catch (probeError) {
      throw new Error(
        '[TEST-FR-001] Required DB (test-bed @3407) is unreachable — ' +
        'probe threw: ' + (probeError && probeError.message ? probeError.message : String(probeError))
      );
    }

    if (!available) {
      throw new Error(
        '[TEST-FR-001] Required DB (test-bed @3407) is unreachable — ' +
        'this DB-backed test cannot run without a live database. ' +
        'Start test-bed (make up in test-bed/) before running DB-backed tests.'
      );
    }

    return fn.apply(this, arguments);
  };
}

/**
 * In-body DB availability assert — throws TEST-FR-001 when the DB is
 * unavailable (or the probe throws). Returns nothing on success.
 *
 * This is the counterpart to requireDB() for tests that guard inline rather
 * than wrapping their full callback. Usage:
 *
 *   await assertDbAvailable();           // uses canonical test-db probe
 *   await assertDbAvailable(myProbe);    // custom probe
 *
 * @param {Function} [probe]  Optional async availability probe. Defaults to
 *                            testDb.isAvailable. Must return truthy when
 *                            the DB is reachable. If it throws, the error
 *                            is re-thrown as a TEST-FR-001 failure.
 * @returns {Promise<void>}   Resolves when DB is available; throws otherwise.
 */
async function assertDbAvailable(probe) {
  var resolvedProbe = probe || testDb.isAvailable;
  var available;
  try {
    available = await resolvedProbe();
  } catch (probeError) {
    throw new Error(
      '[TEST-FR-001] Required DB (test-bed @3407) is unreachable — ' +
      'probe threw: ' + (probeError && probeError.message ? probeError.message : String(probeError))
    );
  }
  if (!available) {
    throw new Error(
      '[TEST-FR-001] Required DB (test-bed @3407) is unreachable — ' +
      'this DB-backed test cannot run without a live database. ' +
      'Start test-bed (make up in test-bed/) before running DB-backed tests.'
    );
  }
}

module.exports = { requireDB, assertDbAvailable };
