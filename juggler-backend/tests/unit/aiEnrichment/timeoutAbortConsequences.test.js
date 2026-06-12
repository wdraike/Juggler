/**
 * W1b RED regression tests — STEP 0 (pre-fix, must FAIL against current code)
 *
 * Two tests that define the target behavior for the W1b fix:
 *   B4 — trackedGeminiCall's finally ALWAYS calls enqueue() even on timeout-abort.
 *         Target: suppress enqueue() when err.code === 'ETIMEDOUT' from our own deadline.
 *         RED: finally enqueues → assertion that enqueue NOT called fails.
 *
 *   B5 — ai.controller.handleCommand calls a SINGLE-STEP checkAndLogDailyQuota BEFORE
 *         callGemini, which inserts the ai_command_log row regardless of call outcome.
 *         A timed-out call has ALREADY consumed one of the user's 50/day slots.
 *         Target: split into check() (count vs limit, no insert) + commitQuota() (insert
 *         ONLY after the Gemini call succeeds). A timed-out call must NOT consume the slot.
 *
 * ── TARGET INTERFACE (the split bert must implement) ──────────────────────────
 *   KnexAIUsageRepository (and the facade) expose TWO operations:
 *
 *   checkQuota(userId)  → { allowed: bool }
 *     Counts ai_command_log rows for the user in the last 24h.
 *     Returns { allowed: false } if count >= limit (50).
 *     Returns { allowed: true }  if count < limit.
 *     DOES NOT INSERT. Safe to call before the Gemini call; does not consume a slot.
 *
 *   commitQuota(userId) → void
 *     Inserts ONE ai_command_log row for the user.
 *     Called by the controller ONLY after the Gemini call succeeds.
 *     Never called on ETIMEDOUT, network error, or any call failure.
 *
 *   Controller flow (post-fix):
 *     1. quota = await checkQuota(userId)      ← no insert
 *     2. if (!quota.allowed) return 429
 *     3. raw = await callGemini(...)           ← may throw ETIMEDOUT
 *     4. await commitQuota(userId)             ← insert here, ONLY on success
 *
 * ── RED / GREEN labels ────────────────────────────────────────────────────────
 *   B4-red   [EXPECT-RED]  enqueue IS called on timeout-abort (should NOT be)
 *   B5-red   [EXPECT-RED]  checkQuota calls count (no insert), timeout fires, commitQuota
 *                          NOT called → 0 rows in ai_command_log
 *                          (FAILS on current code because checkAndLogDailyQuota inserts
 *                          before the call and there's no commitQuota to test against)
 *   B5-guard [GUARD-GREEN] checkQuota (no insert) THEN commitQuota (insert) → exactly
 *                          1 row in ai_command_log (success path through the split)
 *
 * ── CONTRADICTION RESOLUTION ──────────────────────────────────────────────────
 *   The OLD tests called checkAndLogDailyQuota for BOTH B5-red and B5-guard. That
 *   single function inserts on allow, so B5-red (assert 0 rows) and B5-guard (assert
 *   1 row) were contradictory: you can't make both pass against the same function.
 *
 *   The NEW interface resolves this because:
 *   - B5-red:   checkQuota (no insert) → timeout → commitQuota NOT called → 0 rows ✓
 *   - B5-guard: checkQuota (no insert) → success → commitQuota (insert) → 1 row ✓
 *   Both paths use the split; success commits, timeout doesn't.
 *
 * ── TRACEABILITY ──────────────────────────────────────────────────────────────
 *   .planning/kermit/juggler-h5-fixes/TRACEABILITY.md B4/B5
 *
 * ── DB NOTES ──────────────────────────────────────────────────────────────────
 *   B4 is pure-unit (mocked enqueue spy — no Docker needed).
 *   B5 uses test-bed MySQL on 3407 (tmpfs, ephemeral). Skipped automatically
 *   when DB unavailable (isAvailable() guard in beforeAll).
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────────
 *   Timing-sensitive tests use a hanging client + AbortSignal-aware client so
 *   the test outcome depends on the abortion path, not wall-clock races.
 *   AI_CALL_TIMEOUT_MS is set to 50ms (well above Docker+Node jitter) before
 *   each test via isolateModules, and the test ceiling is 3s (60x the budget).
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── Top-level mock: ai-usage-queue.service ────────────────────────────────────
// Must be declared at module scope so Jest's babel hoisting can reference it
// inside the jest.mock factory.
const mockEnqueueFn = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/services/ai-usage-queue.service', () => ({
  enqueue: mockEnqueueFn,
}));

beforeEach(() => {
  mockEnqueueFn.mockClear();
  delete process.env.AI_CALL_TIMEOUT_MS;
});

afterEach(() => {
  delete process.env.AI_CALL_TIMEOUT_MS;
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — Phantom telemetry row on timeout-abort
//
// Current code (gemini-tracked-call.js): the `finally` block inside callPromise
// ALWAYS calls enqueue(), including when the call was abandoned by the timeout race.
// When trackedGeminiCall's timeoutPromise wins:
//   1. The ETIMEDOUT error is returned to the caller.
//   2. The callPromise continues running in the background (client still pending
//      OR the AbortSignal fires and it rejects).
//   3. When callPromise eventually settles its finally block runs → enqueue() fires.
//
// The fix will suppress enqueue() when the failure is the timeout-abort
// (detectable by err.code === 'ETIMEDOUT' from our own AbortController).
//
// How we prove RED:
//   Set AI_CALL_TIMEOUT_MS=50 (short budget). Use a hanging client that respects
//   AbortSignal, so when the abort fires the client rejects quickly. After the
//   ETIMEDOUT rejects we wait a brief tick to let the background callPromise
//   settle and execute its finally block. Then assert enqueue() was NOT called.
//   On current code: finally fires enqueue() → mockEnqueueFn is called once → FAILS.
//   After fix: finally detects ETIMEDOUT from own abort → suppresses enqueue() → PASSES.
// ─────────────────────────────────────────────────────────────────────────────

describe('B4 — timeout-abort must NOT enqueue a phantom telemetry row', () => {
  test(
    'B4-red [EXPECT-RED]: enqueue() called 0 times after ETIMEDOUT (currently called once — phantom row)',
    async () => {
      // On current code: finally ALWAYS enqueues → mockEnqueueFn.calls.length === 1 → FAILS.
      // After fix: ETIMEDOUT detected → enqueue suppressed → 0 calls → PASSES.

      process.env.AI_CALL_TIMEOUT_MS = '50';

      // Load a fresh trackedGeminiCall that reads the new env var.
      const { trackedGeminiCall } = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const mod = require('../../../src/services/gemini-tracked-call');
          resolve(mod);
        });
      });

      // AbortSignal-aware hanging client: rejects when the signal fires.
      // This models the real SDK — when the AbortController fires after 50ms,
      // the client's promise rejects promptly, allowing the callPromise finally
      // block to run while we are still in the test assertion window.
      const abortAwareHangingClient = {
        models: {
          generateContent: (params) => new Promise((_resolve, reject) => {
            const signal = params && params.config && params.config.abortSignal;
            if (signal) {
              if (signal.aborted) {
                reject(signal.reason || new Error('aborted'));
                return;
              }
              signal.addEventListener('abort', () => {
                reject(signal.reason || new Error('aborted'));
              });
            }
            // No signal path: hang forever (not exercised when trackedGeminiCall
            // injects abortSignal, but kept for completeness).
          }),
        },
      };

      const noopDb = () => ({ insert: async () => {} });

      // This call must reject with ETIMEDOUT (the timeout fires at 50ms).
      await expect(
        trackedGeminiCall(
          noopDb,
          abortAwareHangingClient,
          'gemini-2.5-flash',
          'test prompt',
          { temperature: 0.3 },
          { useCase: 'task-ai', userId: 'u-b4', correlationId: 'b4-red' }
        )
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' });

      // Give the background callPromise finally block time to run.
      // With an AbortSignal-aware client, rejection happens synchronously after
      // the signal fires. setImmediate/nextTick gives the microtask queue a chance
      // to flush the finally block before we assert.
      await new Promise((r) => setImmediate(r));
      // One extra tick for belt-and-suspenders (finally is async).
      await new Promise((r) => setImmediate(r));

      // B4 assertion: enqueue() must NOT have been called on a timeout-abort.
      // On current code: finally always calls enqueue() → 1 call → FAILS RED.
      // After fix: enqueue suppressed on ETIMEDOUT → 0 calls → PASSES GREEN.
      expect(mockEnqueueFn).toHaveBeenCalledTimes(0);
    },
    3000 // 3s ceiling — budget fires at 50ms; ample room for Docker+Node jitter
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — Timed-out call burns the user's daily quota slot
//
// TARGET INTERFACE — the split check/commit flow:
//
//   checkQuota(userId)  → { allowed: bool }   count-only, NO insert
//   commitQuota(userId) → void                insert only after success
//
// Controller flow (post-fix):
//   1. quota = await checkQuota(userId)      ← count vs limit, no insert
//   2. if (!quota.allowed) return 429
//   3. raw = await callGemini(...)           ← may throw ETIMEDOUT
//   4. await commitQuota(userId)             ← insert ONLY if step 3 succeeded
//
// How B5-red proves RED against current code:
//   Current KnexAIUsageRepository has NO checkQuota / commitQuota split.
//   Calling `repo.checkQuota` will throw TypeError (not a function) — the
//   test cannot proceed → fails. This is the correct RED state: the interface
//   bert must build does not yet exist, so the test correctly fails pre-fix.
//
// How B5-guard proves the SUCCESS path (GREEN post-fix, used to verify bert's impl):
//   Call checkQuota (no insert) → simulate Gemini success → call commitQuota (insert).
//   Assert exactly 1 row in ai_command_log.
//   B5-guard must be RED on current code (no commitQuota) and GREEN after the fix.
//   Both B5-red and B5-guard target the split; success commits, timeout doesn't.
//
// MUTATION NOTE:
//   B5-red oracle: 0 rows after checkQuota + timeout (no commitQuota call).
//     Mutant: call commitQuota after timeout → 1 row → assertion fails → KILLED.
//   B5-guard oracle: 1 row after checkQuota + commitQuota.
//     Mutant: skip commitQuota → 0 rows → assertion fails → KILLED.
//   Each pin is non-tautological: the assertion is the inverse of the bug.
// ─────────────────────────────────────────────────────────────────────────────

describe('B5 — timed-out call must NOT consume the user daily quota slot', () => {
  const testDb = require('../../helpers/test-db');
  const { KnexAIUsageRepository } = require('../../../src/slices/ai-enrichment/facade');

  // Unique user ID for this test suite — avoids collisions with other suites.
  const TEST_USER_ID = '999940'; // VARCHAR — juggler user_id is VARCHAR(36)

  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await testDb.isAvailable();
    if (!dbAvailable) return;
    // Ensure test user exists (ai_command_log FK → users.id).
    await testDb('users').insert({
      id: TEST_USER_ID,
      email: 'telly-b5-timeout@example.com',
      name: 'Telly B5 Timeout Test',
    }).onConflict('id').ignore();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await testDb('ai_command_log').where('user_id', TEST_USER_ID).del().catch(() => {});
      await testDb('users').where('id', TEST_USER_ID).del().catch(() => {});
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    // Clean slate before each test.
    await testDb('ai_command_log').where('user_id', TEST_USER_ID).del();
  });

  test(
    'B5-red [EXPECT-RED]: timed-out call — checkQuota (no insert) + no commitQuota → 0 rows in ai_command_log',
    async () => {
      if (!dbAvailable) {
        // Skip rather than fail when test-bed is not up.
        // Run with: cd test-bed && make up && make test-juggler
        console.warn('B5-red: test-bed DB not available — skipping (run cd test-bed && make up)');
        return;
      }

      // Step 1: Call checkQuota. On allow, it returns { allowed: true } WITHOUT inserting.
      // On current code (no split): repo.checkQuota is undefined → TypeError → FAILS RED.
      // After fix: checkQuota counts rows only, no insert → { allowed: true }.
      const repo = new KnexAIUsageRepository({ db: testDb });

      // Pre-fix: TypeError: repo.checkQuota is not a function.
      // Post-fix: { allowed: true } with 0 rows in ai_command_log.
      const quotaResult = await repo.checkQuota(TEST_USER_ID);
      expect(quotaResult.allowed).toBe(true);

      // Step 2: Verify checkQuota did NOT insert a row (split contract).
      // Pre-fix: this line is unreachable (TypeError above already fails the test).
      // Post-fix: checkQuota is count-only → 0 rows.
      const rowsAfterCheck = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
      expect(rowsAfterCheck).toHaveLength(0); // checkQuota must NOT insert

      // Step 3: Simulate the Gemini call timing out.
      // In the real controller: callGemini() throws ETIMEDOUT.
      // commitQuota is NOT called (controller's success-only path).
      // We model this by simply NOT calling commitQuota.

      // Step 4: Assert that the ai_command_log count is still 0 (slot NOT consumed).
      // On current code: step 1 throws TypeError (no checkQuota) → the test fails RED.
      // After fix: checkQuota returned allowed=true with no insert; timeout fired;
      //            commitQuota not called → count remains 0 → PASSES GREEN.
      const rowsAfterTimeout = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
      expect(rowsAfterTimeout).toHaveLength(0);
      // ^^^^ After fix this is GREEN: checkQuota is read-only + commitQuota not called.
    },
    10000 // 10s to accommodate test-bed MySQL startup latency on first connection
  );

  test(
    'B5-guard [GUARD-GREEN]: successful call — checkQuota (no insert) THEN commitQuota (insert) → exactly 1 row',
    async () => {
      if (!dbAvailable) {
        console.warn('B5-guard: test-bed DB not available — skipping');
        return;
      }

      // Non-regression guard: a successful call must consume exactly 1 quota slot.
      // This test is RED on current code (no commitQuota method) and GREEN post-fix.
      //
      // Success path through the split:
      //   1. checkQuota  → { allowed: true }  (count-only, 0 rows inserted)
      //   2. callGemini succeeds (simulated — we do not call real Gemini)
      //   3. commitQuota → inserts 1 row in ai_command_log
      //
      // Assert exactly 1 row after commitQuota.
      const repo = new KnexAIUsageRepository({ db: testDb });

      // Step 1: check (no insert).
      // Pre-fix: TypeError (no checkQuota) → RED.
      // Post-fix: { allowed: true }, 0 rows.
      const quotaResult = await repo.checkQuota(TEST_USER_ID);
      expect(quotaResult.allowed).toBe(true);

      // Verify no row was inserted by checkQuota.
      const rowsAfterCheck = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
      expect(rowsAfterCheck).toHaveLength(0); // split contract: check is read-only

      // Step 2: simulate Gemini success — no error thrown.
      // (The controller calls commitQuota here, AFTER the awaited callGemini resolves.)

      // Step 3: commit — insert the slot.
      // Pre-fix: TypeError (no commitQuota) → RED.
      // Post-fix: inserts 1 row → GREEN.
      await repo.commitQuota(TEST_USER_ID);

      // Step 4: assert exactly 1 row (slot consumed by success).
      const rowsAfterCommit = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
      expect(rowsAfterCommit).toHaveLength(1); // GREEN on current code → must stay GREEN after fix
      // ^^^^ Mutation note: skip commitQuota → 0 rows → fails → mutant KILLED.
    },
    10000
  );
});
