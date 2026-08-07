/**
 * requireDB.contract.test.js — W0 RED repro for BUG-1 / TEST-FR-001
 *
 * Traceability: .planning/kermit/TRACEABILITY-juggler-test-nodb-failloud.md BUG-1
 * Governing requirement: TEST-FR-001 (docs/testing/TESTING-STANDARDS.md
 *   §Test Integrity Requirements) — "A DB-backed test MUST FAIL (loud) when
 *   its required DB is unavailable; never silently skip / green-with-zero-assertions."
 *
 * PRE-FIX BUG (do not fix here — this file is the repro, not the remedy):
 *
 *   ~16 juggler suites copy-paste this guard:
 *
 *     function skipIfNoDB(fn) {
 *       return async () => {
 *         if (!await isDbAvailable()) return;  // <-- silent no-op
 *         await fn();
 *       };
 *     }
 *
 *   When MySQL is unreachable, the returned async function resolves with
 *   `undefined`. Jest records a PASS with 0 assertions. TEST-FR-001 is
 *   violated: the CI is green, the bug is invisible.
 *
 * THE FIX (W1, bert):
 *   A shared helper `tests/helpers/requireDB.js` that exports `requireDB(fn)`.
 *   When the DB is unavailable, `requireDB(fn)` REJECTS / throws with a message
 *   identifying TEST-FR-001 and the unavailability — making Jest record a
 *   FAIL (loud), not a PASS (silent).
 *
 * THIS FILE IS RED UNTIL requireDB.js EXISTS AND THROWS (i.e. until W1 lands).
 * It will be GREEN after bert implements requireDB.js.
 */

'use strict';

// ---------------------------------------------------------------------------
// Probe stub — pure unit; does NOT require a live DB.
// We inject a synthetic probe rather than calling real MySQL.
// ---------------------------------------------------------------------------

/**
 * Returns a probe function that returns the given value when called.
 * Used to simulate DB available (true) and DB unavailable (false).
 */
function makeProbe(available) {
  return jest.fn().mockResolvedValue(available);
}

// ---------------------------------------------------------------------------
// Import the module under test.
// This require() will THROW / ERROR if requireDB.js does not exist yet,
// which is the W0 red state: module-absent => test file itself errors =>
// Jest reports FAIL for the suite.
// ---------------------------------------------------------------------------
const { requireDB, assertDbAvailable } = require('./requireDB');

// ---------------------------------------------------------------------------
// Demonstration: the OLD silent-return shape does NOT throw.
// This inline implementation mirrors the copy-pasted `skipIfNoDB` bug.
// It is used in assertions below to prove this contract test discriminates
// the buggy behavior from the fixed behavior.
// ---------------------------------------------------------------------------
function silentSkip(fn, probe) {
  return async () => {
    if (!await probe()) return; // silent no-op — the bug
    await fn();
  };
}

// ---------------------------------------------------------------------------
// Contract tests for requireDB(fn)
// ---------------------------------------------------------------------------

describe('requireDB — TEST-FR-001 contract', () => {

  describe('when DB is UNAVAILABLE', () => {

    it('TEST-FR-001: wrapped fn REJECTS / throws with a DB-unavailable message', async () => {
      // Arrange
      const probe = makeProbe(false); // DB unreachable
      const fn = jest.fn();           // should NOT be called
      const wrapped = requireDB(fn, probe);

      // Act + Assert: must reject (loud fail), not resolve silently
      await expect(wrapped()).rejects.toThrow(/TEST-FR-001|DB.*unavailable|database.*unavailable/i);
    });

    it('TEST-FR-001: fn is NOT invoked when DB is unavailable', async () => {
      const probe = makeProbe(false);
      const fn = jest.fn();
      const wrapped = requireDB(fn, probe);

      // Swallow the expected rejection so this assertion can run
      await wrapped().catch(() => {});

      expect(fn).not.toHaveBeenCalled();
    });

    it('CONTRAST — old silent-return shape does NOT throw (demonstrates the bug)', async () => {
      // This proves the test discriminates the buggy from the fixed behavior.
      // silentSkip resolves (returns undefined) when DB is unavailable —
      // Jest would record PASS with 0 assertions. requireDB must NOT do this.
      const probe = makeProbe(false);
      const fn = jest.fn();
      const oldStyle = silentSkip(fn, probe);

      // The buggy implementation resolves without throwing:
      await expect(oldStyle()).resolves.toBeUndefined();
      // fn was never called — zero assertions in the real test body.
      expect(fn).not.toHaveBeenCalled();
      // This CONTRAST assertion is here to make explicit that `resolves.toBeUndefined()`
      // is the FALSE-PASS that TEST-FR-001 forbids — requireDB must REJECT instead.
    });

  });

  describe('when DB is AVAILABLE', () => {

    it('wrapped fn IS invoked when DB is available', async () => {
      const probe = makeProbe(true);
      const fn = jest.fn().mockResolvedValue('ok');
      const wrapped = requireDB(fn, probe);

      await wrapped();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('return value of fn is propagated to caller', async () => {
      const probe = makeProbe(true);
      const fn = jest.fn().mockResolvedValue('expected-result');
      const wrapped = requireDB(fn, probe);

      const result = await wrapped();

      expect(result).toBe('expected-result');
    });

    it('fn is called with all arguments passed to the wrapped function', async () => {
      const probe = makeProbe(true);
      const fn = jest.fn().mockResolvedValue(undefined);
      const wrapped = requireDB(fn, probe);

      await wrapped('arg1', 42, { key: 'val' });

      expect(fn).toHaveBeenCalledWith('arg1', 42, { key: 'val' });
    });

    it('if fn throws, the error propagates (not swallowed)', async () => {
      const probe = makeProbe(true);
      const fn = jest.fn().mockRejectedValue(new Error('fn exploded'));
      const wrapped = requireDB(fn, probe);

      await expect(wrapped()).rejects.toThrow('fn exploded');
    });

  });

  describe('thrown message shape', () => {

    it('error message identifies TEST-FR-001 so failures are traceable', async () => {
      const probe = makeProbe(false);
      const fn = jest.fn();
      const wrapped = requireDB(fn, probe);

      let caught = null;
      try {
        await wrapped();
      } catch (e) {
        caught = e;
      }

      expect(caught).not.toBeNull();
      expect(caught.message).toMatch(/TEST-FR-001/);
    });

    // 999.5278 — pool runs allocate a dynamic per-slot port (e.g. slot 0 is
    // 3410), not the documented default 3407. The failure message must name
    // the port actually in use so it doesn't send the reader chasing a
    // config problem that doesn't exist.
    describe('999.5278 — port in the message reflects DB_PORT actually in use', () => {
      const ORIGINAL_DB_PORT = process.env.DB_PORT;

      afterEach(() => {
        if (ORIGINAL_DB_PORT === undefined) {
          delete process.env.DB_PORT;
        } else {
          process.env.DB_PORT = ORIGINAL_DB_PORT;
        }
      });

      it('requireDB() names the DYNAMIC pool-slot port (e.g. 3410), not the hardcoded 3407 default', async () => {
        process.env.DB_PORT = '3410';
        const wrapped = requireDB(jest.fn(), makeProbe(false));

        await expect(wrapped()).rejects.toThrow(/test-bed @3410/);
        await expect(wrapped()).rejects.not.toThrow(/test-bed @3407/);
      });

      it('assertDbAvailable() names the DYNAMIC pool-slot port too', async () => {
        process.env.DB_PORT = '3411';

        await expect(assertDbAvailable(makeProbe(false))).rejects.toThrow(/test-bed @3411/);
      });

      it('falls back to the documented default port only when DB_PORT is unset', async () => {
        delete process.env.DB_PORT;
        const wrapped = requireDB(jest.fn(), makeProbe(false));

        await expect(wrapped()).rejects.toThrow(/test-bed @3407/);
      });

      it('the unreachable-DB remediation no longer asserts a specific fixed port', async () => {
        process.env.DB_PORT = '3410';
        const wrapped = requireDB(jest.fn(), makeProbe(false));

        let caught = null;
        try {
          await wrapped();
        } catch (e) {
          caught = e;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).not.toMatch(/Start test-bed \(make up in test-bed\/\)/);
      });
    });

  });

});
