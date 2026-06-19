'use strict';

/**
 * credentialGate — TEST-FR-002 shared guard for credential/data-gated tests.
 *
 * Governing requirement: TEST-FR-002 (docs/testing/TESTING-STANDARDS.md
 *   §Test Integrity Requirements)
 *
 * Counterpart to requireDB (TEST-FR-001). Where TEST-FR-001 forbids a
 * DB-backed test from silently passing when the DB is down (it must FAIL
 * loud), TEST-FR-002 forbids a credential/data-gated test from silently
 * passing when the credential or fixture data is absent — it must SKIP
 * visibly (Jest reports "skipped"), never report green with zero assertions.
 *
 * The classic anti-pattern this replaces:
 *
 *     it('pushes to GCal', async () => {
 *       if (!hasGCalCredentials()) return;   // ← FALSE PASS: green, 0 assertions
 *       ... real assertions ...
 *     });
 *
 * With no creds that `it` records a PASS having exercised nothing — manufactured
 * confidence. TEST-FR-002 requires the test to instead appear as SKIPPED.
 *
 * Mechanism: the gate predicate (e.g. hasGCalCredentials()) is a pure
 * environment read evaluable at Jest *collection* time, so we choose
 * describe/it vs describe.skip/it.skip up front. Jest then renders the
 * gated tests as "skipped" rather than silently no-opping inside a passing
 * body.
 *
 * Usage — gate a whole describe block (preferred for adapter suites):
 *   const { describeWithCreds } = require('./helpers/credentialGate');
 *   describeWithCreds(hasGCalCredentials, 'GCal adapter — createEvent', () => {
 *     it('creates an event', async () => { ... });   // skipped when no creds
 *   });
 *
 * Usage — gate a single test:
 *   const { itWithCreds } = require('./helpers/credentialGate');
 *   itWithCreds(hasMsftCredentials, 'pushes to MSFT', async () => { ... });
 *
 * Invariants (no-unapproved-fallbacks rule):
 *   - The predicate is evaluated exactly once, at collection time. No silent
 *     `return` is ever substituted for a visible skip.
 *   - The predicate must be a boolean-returning function (or boolean). It is
 *     NOT swallowed: if it throws, the error propagates (never a silent pass).
 */

/**
 * Resolve a gate argument (function or boolean) to a boolean, evaluated now.
 * @param {Function|boolean} cond
 * @returns {boolean}
 */
function resolveGate(cond) {
  return typeof cond === 'function' ? !!cond() : !!cond;
}

/**
 * describe that runs only when `cond` is truthy; otherwise describe.skip
 * (Jest reports its tests as skipped — never silently passing).
 *
 * @param {Function|boolean} cond  Credential/data predicate (collection-time).
 * @param {string} name            Suite name.
 * @param {Function} fn            Suite body.
 */
function describeWithCreds(cond, name, fn) {
  return (resolveGate(cond) ? describe : describe.skip)(name, fn);
}

/**
 * it/test that runs only when `cond` is truthy; otherwise it.skip.
 *
 * @param {Function|boolean} cond  Credential/data predicate (collection-time).
 * @param {string} name            Test name.
 * @param {Function} fn            Test body.
 * @param {number} [timeout]       Optional Jest per-test timeout.
 */
function itWithCreds(cond, name, fn, timeout) {
  return (resolveGate(cond) ? it : it.skip)(name, fn, timeout);
}

module.exports = {
  resolveGate,
  describeWithCreds,
  itWithCreds,
  // alias — some suites read better with `test`
  testWithCreds: itWithCreds
};
