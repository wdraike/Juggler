/**
 * W3 (H5) — GeminiAIAdapter 8s call timeout (B5). Uses an injected hanging client
 * + a tiny timeoutMs so the test is fast. Asserts the call rejects ETIMEDOUT and a
 * fast call is unaffected.
 *
 * IMPORTANT — how the timeout mechanism works:
 *   GeminiAIAdapter creates an AbortController and passes its `.signal` into the
 *   GenerateContentConfig as `abortSignal`. The real @google/genai SDK honours
 *   `abortSignal` and rejects when the signal fires. The fake client below must do
 *   the same — it receives `{ ..., config: { abortSignal } }` and must reject when
 *   the signal fires. A naive `new Promise(() => {})` ignores the signal, hangs
 *   forever, and causes Jest's own 5s watchdog to fire instead of the adapter's
 *   40ms deadline.
 *
 * NOTE (backlog — orphaned telemetry):
 *   On a slow-but-finite call (resolves/rejects after timeoutMs), the `finally`
 *   block in gemini-tracked-call.js enqueues a usage row AFTER the caller already
 *   received ETIMEDOUT. This is a production-code concern (orphaned ai_usage_outbox
 *   row); bert/cookie own the fix. The test below pins the ETIMEDOUT rejection path;
 *   the orphaned-enqueue path is explicitly NOT tested here (noted as backlog).
 *
 * TEST 3 — abort-pin (zoe WARN-2):
 *   The third test below pins that `controller.abort()` is actually called when the
 *   timeout fires. Zoe's MUTATION D2 showed that removing ONLY `controller.abort()`
 *   (while keeping Promise.race) left the first two tests GREEN — the race still
 *   rejects ETIMEDOUT without abort firing. This third test catches that gap by
 *   capturing the AbortSignal handed to the fake client and asserting
 *   `signal.aborted === true` AFTER the timeout fires. If `controller.abort()` is
 *   removed, the signal stays un-aborted and the assertion FAILS.
 */
'use strict';

const GeminiAIAdapter = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');

// noopDb — trackedGeminiCall's enqueue path needs a db argument that has an .insert().
// On a hanging call the finally block will fire if/when the call eventually settles,
// but for the never-settling client below the finally block never runs, so noopDb is safe.
const noopDb = () => ({ insert: async () => {} });

/**
 * Fake client that models the real @google/genai SDK's AbortSignal support:
 * generateContent receives `{ ..., config: { abortSignal } }` and returns a
 * promise that rejects with an AbortError when the signal fires.
 *
 * NOTE on signal wiring: GeminiAIAdapter.generate() builds a `signalClient`
 * wrapper that merges `abortSignal: controller.signal` into the params before
 * calling the injected client's generateContent. So the injected client here
 * receives params with `config.abortSignal` already present.
 *
 * trackedGeminiCall passes config directly to generateContent as the third arg:
 *   client.models.generateContent({ model, contents, config })
 * so the signal is at args[0].config.abortSignal.
 */
function makeAbortAwareHangingClient() {
  return {
    models: {
      generateContent(args) {
        const signal = args && args.config && args.config.abortSignal;
        return new Promise((_resolve, reject) => {
          if (signal) {
            if (signal.aborted) {
              reject(signal.reason || new Error('aborted'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(signal.reason || new Error('aborted'));
            });
          }
          // No signal → hangs forever (not used in the test below, but defensive)
        });
      },
    },
  };
}

/**
 * Instrumented client for the abort-pin test (zoe WARN-2).
 *
 * Unlike makeAbortAwareHangingClient (which rejects when abort fires, letting
 * the abort-driven rejection win the race), this client HANGS FOREVER regardless
 * of the signal. It only captures the signal for post-rejection inspection.
 *
 * This is intentional: we want Promise.race to settle via the timeoutPromise
 * (ETIMEDOUT), then inspect whether `controller.abort()` was called. With a
 * signal-responding client the abort-driven rejection could win first, which
 * would still pass even if the abort fired only incidentally. The hang-forever
 * approach isolates the assertion: ETIMEDOUT fires → was abort() also called?
 *
 * The captured signal reference is returned alongside the client so the test
 * can read `capturedSignal.aborted` after `generate()` rejects.
 */
function makeSignalCapturingClient() {
  let capturedSignal = null;
  const client = {
    models: {
      generateContent(args) {
        capturedSignal = (args && args.config && args.config.abortSignal) || null;
        // Hang forever — never resolve or reject. The timeout race wins.
        // eslint-disable-next-line no-new
        return new Promise(() => {});
      },
    },
    // Accessor so the test can read the captured signal after the call settles.
    getCapturedSignal() {
      return capturedSignal;
    },
  };
  return client;
}

describe('GeminiAIAdapter timeout (B5)', () => {
  test('a hung Gemini call rejects ETIMEDOUT at the deadline', async () => {
    // The hanging client respects AbortSignal (models the real SDK).
    // The adapter fires the AbortController after timeoutMs=40ms; the client's
    // promise rejects with the abort reason, which the adapter re-throws as
    // `{ code: 'ETIMEDOUT' }` (set on the abort reason error by the adapter).
    const adapter = new GeminiAIAdapter({
      client: makeAbortAwareHangingClient(),
      db: noopDb,
      timeoutMs: 40,
    });
    await expect(
      adapter.generate('hi', {}, { useCase: 'task-ai' })
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  }, 10000); // 999.1444: 10s wall-clock ceiling (was 2s, flaked under coverage instrumentation) — adapter fires at 40ms, so 10s is generous

  test('a fast call resolves normally (timeout does not fire)', async () => {
    const fastClient = { models: { generateContent: async () => ({ text: '🎯' }) } };
    const adapter = new GeminiAIAdapter({ client: fastClient, db: noopDb, timeoutMs: 5000 });
    const r = await adapter.generate('hi', {}, { useCase: 'task-ai' });
    expect(r.text).toBe('🎯');
  });

  // ── abort-pin test (zoe WARN-2) ───────────────────────────────────────────────
  // Pins that `controller.abort()` is actually called when the timeout fires.
  //
  // SELF-MUTATION VERIFIED (2026-06-12):
  //   Remove `controller.abort()` from GeminiAIAdapter.js:122 (keep Promise.race):
  //     → this test FAILS: "Expected: true, Received: false" on signal.aborted
  //   Restore `controller.abort()`:
  //     → this test PASSES (signal.aborted === true confirmed)
  //   The existing two tests stay GREEN in both states (race alone rejects ETIMEDOUT)
  //   — confirming they do NOT pin the abort() call; this test does.
  //
  // Design: a signal-capturing client that hangs forever (never settles on its own).
  // Promise.race settles via timeoutPromise → ETIMEDOUT. We then inspect the
  // captured AbortSignal. If controller.abort() ran, signal.aborted===true.
  // If only the race fired (abort removed), signal.aborted===false → FAIL.
  test('timeout fires controller.abort() — signal.aborted is true after deadline (abort-pin)', async () => {
    const instrumentedClient = makeSignalCapturingClient();
    const adapter = new GeminiAIAdapter({
      client: instrumentedClient,
      db: noopDb,
      timeoutMs: 40,
    });

    // generate() must reject with ETIMEDOUT (the timeout race won)
    await expect(
      adapter.generate('hi', {}, { useCase: 'task-ai' })
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });

    // The AbortController's signal must have been aborted — i.e. controller.abort()
    // was called. This is the pin: removing controller.abort() makes this FAIL.
    const signal = instrumentedClient.getCapturedSignal();
    expect(signal).not.toBeNull(); // signal was threaded into the SDK call
    expect(signal.aborted).toBe(true); // controller.abort() was called
  }, 10000); // 999.1444: 10s ceiling (was 2s, flaked under coverage instrumentation) — adapter fires at 40ms
});
