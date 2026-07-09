/**
 * W1a RED regression tests — STEP 0 (pre-fix, must FAIL against current code)
 *
 * Three tests that define the target behavior for the W1a fix:
 *   B1 — AI budget must be env-tunable (currently hard-coded 8000ms)
 *   B3 — timeout must live in trackedGeminiCall (currently it has NONE)
 *   B2 — config/telemetry separation invariant guard (currently abortSignal is
 *          NOT injected by trackedGeminiCall; it lives only in the adapter wrapper)
 *
 * RED / GREEN labels per test:
 *   B1a — EXPECT-RED  (env-tuning ignored on current code)
 *   B3a — EXPECT-RED  (trackedGeminiCall has no timeout → 500ms ceiling fires)
 *   B2a — EXPECT-RED  (SDK call does not receive abortSignal via trackedGeminiCall)
 *   B1b / B3b / B2b — EXPECT-GREEN guard (non-regression; already pass)
 *
 * TRACEABILITY: .planning/kermit/juggler-h5-fixes/TRACEABILITY.md B1/B2/B3
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── Top-level mock: ai-usage-queue.service ────────────────────────────────────
// The variable name starts with 'mock' (case-insensitive) so Jest's babel
// transform allows it to be referenced inside the jest.mock factory.
const mockEnqueueFn = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({
  enqueue: mockEnqueueFn,
}));

// noopDb is sufficient — trackedGeminiCall only passes db to enqueue.
const noopDb = () => ({ insert: async () => {} });

beforeEach(() => {
  mockEnqueueFn.mockClear();
});

// ────────────────────────────────────────────────────────────────────────────
// B1 — AI budget env-tunable (AI_CALL_TIMEOUT_MS)
//
// Current state: the constant is defined as
//   const AI_CALL_TIMEOUT_MS = 8000;
// at module load inside GeminiAIAdapter.js — it does NOT read process.env.
// The constructor accepts `d.timeoutMs` but there is no env-read path.
//
// Target behavior after fix: GeminiAIAdapter reads process.env.AI_CALL_TIMEOUT_MS
// at construction time (or the constant is computed from env), making the budget
// tunable without a code change.
//
// How we prove RED:
//   We set process.env.AI_CALL_TIMEOUT_MS = '10' (10ms), load a fresh copy of
//   GeminiAIAdapter via jest.isolateModulesAsync(), inject a client that resolves
//   in 30ms (SignalAware: rejects on abort), and do NOT pass `timeoutMs` directly
//   to the constructor. The client resolves in 30ms > 10ms, so with the env-tuned
//   adapter we expect ETIMEDOUT. On current code the constructor ignores the env
//   var and falls back to AI_CALL_TIMEOUT_MS = 8000 → the 30ms client resolves
//   successfully → the ETIMEDOUT expectation FAILS → RED.
// ────────────────────────────────────────────────────────────────────────────

describe('B1 — AI budget env-tunable (AI_CALL_TIMEOUT_MS)', () => {
  afterEach(() => {
    delete process.env.AI_CALL_TIMEOUT_MS;
  });

  test(
    'B1a [EXPECT-RED]: env AI_CALL_TIMEOUT_MS=50 — adapter honours 50ms deadline; client resolving in 300ms TIMES OUT',
    async () => {
      // On current code: AI_CALL_TIMEOUT_MS is hard-coded to 8000ms at module load.
      // The constructor does NOT read process.env. So even with env set to 50, the
      // effective deadline is 8000ms → 300ms client resolves → no ETIMEDOUT → RED.
      // After fix: constructor reads env → 50ms → client too slow → ETIMEDOUT → GREEN.
      //
      // Margin widened (ernie/zoe flake report): was 10ms budget / 30ms client (20ms gap).
      // Now 50ms budget / 300ms client (250ms gap) — deterministic under parallel load.
      // The client uses an AbortSignal-aware approach: when abort fires the client
      // rejects immediately, so outcome depends on abort firing, not wall-clock races.

      process.env.AI_CALL_TIMEOUT_MS = '50';

      const GeminiAIAdapterFresh = await new Promise((resolve) => {
        jest.isolateModules(() => {
          // jest.mock() inside isolateModules: must use top-level mock reference.
          // The top-level jest.mock is already hoisted; re-declaring here is fine.
          const A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
          resolve(A);
        });
      });

      // Client that resolves in 300ms but also respects AbortSignal.
      // 300ms >> 50ms (budget) — 250ms margin eliminates timing flakiness.
      // AbortSignal-aware: when the adapter fires abort at 50ms, the client
      // rejects promptly (does not wait the remaining 250ms).
      const slowAbortAwareClient = {
        models: {
          generateContent: (params) => new Promise((resolve, reject) => {
            const signal = params && params.config && params.config.abortSignal;
            const timer = setTimeout(() => resolve({ text: 'slow-ok' }), 300);
            if (signal) {
              if (signal.aborted) {
                clearTimeout(timer);
                reject(signal.reason || new Error('aborted'));
                return;
              }
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(signal.reason || new Error('aborted'));
              });
            }
          }),
        },
      };

      // Do NOT pass timeoutMs — we want the env-read path to be exercised.
      const adapter = new GeminiAIAdapterFresh({
        client: slowAbortAwareClient,
        db: noopDb,
      });

      // Expect ETIMEDOUT because 300ms > 50ms (env budget).
      // On current code: 300ms < 8000ms → resolves normally → FAILS RED.
      await expect(
        adapter.generate('test prompt', { temperature: 0.5 }, { useCase: 'task-ai' })
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    },
    5000
  );

  test(
    'B1b [GUARD-GREEN]: fast client under any budget resolves successfully',
    async () => {
      // Non-regression: a client that resolves immediately always succeeds.
      // GREEN on current code AND after fix.

      const GeminiAIAdapterFresh = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
          resolve(A);
        });
      });

      const fastClient = {
        models: {
          generateContent: async () => ({
            text: 'immediate',
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
          }),
        },
      };

      const adapter = new GeminiAIAdapterFresh({ client: fastClient, db: noopDb });
      const result = await adapter.generate('hi', {}, { useCase: 'task-ai' });
      expect(result.text).toBe('immediate');
    },
    5000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// B3 — timeout altitude: deadline must live in trackedGeminiCall
//
// Current state: trackedGeminiCall has NO timeout. It calls
//   result = await client.models.generateContent({ model, contents, config });
// with no AbortController, no Promise.race, no setTimeout. If the client
// hangs, trackedGeminiCall hangs indefinitely.
//
// Target behavior after fix: trackedGeminiCall enforces the deadline internally
// (reads AI_CALL_TIMEOUT_MS from env or uses a default), so ANY caller gets
// timeout protection without wrapping in an adapter.
//
// How we prove RED:
//   We call trackedGeminiCall DIRECTLY (bypassing GeminiAIAdapter) with a
//   client that hangs forever (new Promise(() => {})). We set the test wall-clock
//   ceiling to 500ms. On current code: no timeout fires → the promise hangs →
//   the 500ms Jest ceiling triggers → test TIMES OUT → RED (via timeout failure).
//   After fix: ETIMEDOUT within 50ms (env budget) → assertion passes → GREEN.
//
// NOTE: Jest reports a test timeout as a failure with message
//   "Exceeded timeout of 500 ms". This IS the RED failure mode — it proves
//   trackedGeminiCall currently hangs rather than rejecting with ETIMEDOUT.
// ────────────────────────────────────────────────────────────────────────────

describe('B3 — timeout altitude: trackedGeminiCall enforces deadline', () => {
  afterEach(() => {
    delete process.env.AI_CALL_TIMEOUT_MS;
  });

  test(
    'B3a [EXPECT-RED]: hanging client — trackedGeminiCall direct call rejects ETIMEDOUT within 50ms budget',
    async () => {
      // On current code: trackedGeminiCall has no timeout → hangs → 500ms ceiling fires → RED.
      // After fix: rejects ETIMEDOUT within 50ms → GREEN.

      process.env.AI_CALL_TIMEOUT_MS = '50';

      const { trackedGeminiCall } = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const mod = require('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call');
          resolve(mod);
        });
      });

      // Client that hangs forever — never resolves or rejects on its own.
      const hangingClient = {
        models: {
          generateContent: () => new Promise(() => {}),
        },
      };

      await expect(
        trackedGeminiCall(
          noopDb,
          hangingClient,
          'gemini-2.5-flash',
          'test prompt',
          { temperature: 0.4 },
          { useCase: 'task-ai', userId: 'u1', correlationId: 'c1' }
        )
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    },
    500 // 500ms ceiling — if trackedGeminiCall has no timeout, this timer fires → RED
  );

  test(
    'B3b [GUARD-GREEN]: fast client — trackedGeminiCall resolves normally (no timeout fires)',
    async () => {
      // Non-regression: a fast client always resolves through trackedGeminiCall.
      // GREEN on current code AND after fix.

      const { trackedGeminiCall } = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const mod = require('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call');
          resolve(mod);
        });
      });

      const fastClient = {
        models: {
          generateContent: async () => ({
            text: 'fast-direct',
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
          }),
        },
      };

      const result = await trackedGeminiCall(
        noopDb,
        fastClient,
        'gemini-2.5-flash',
        'test prompt',
        { temperature: 0.2 },
        { useCase: 'task-ai', userId: 'u2', correlationId: 'c2' }
      );
      expect(result).toMatchObject({ text: 'fast-direct' });
    },
    2000
  );
});

// ────────────────────────────────────────────────────────────────────────────
// B2 — config/telemetry separation invariant guard
//
// Current state: abortSignal is injected by the `signalClient` wrapper inside
// GeminiAIAdapter.generate(). When calling trackedGeminiCall DIRECTLY (no adapter
// wrapper), the SDK call receives config as-is — no abortSignal is injected.
// So calling trackedGeminiCall directly: the SDK call does NOT get abortSignal.
//
// Target behavior after fix:
//   trackedGeminiCall itself creates an AbortController and injects abortSignal
//   into the SDK call params (NOT into the config arg passed by the caller).
//   The modelParams recorded in enqueue remain the original config: no abortSignal.
//
// Tests:
//   B2a [EXPECT-RED] — direct trackedGeminiCall: SDK call receives abortSignal.
//     On current code: trackedGeminiCall passes config as-is → no abortSignal → FAILS.
//     After fix: trackedGeminiCall injects signal at SDK boundary → PASSES.
//
//   B2b [GUARD-GREEN] — direct trackedGeminiCall: enqueue modelParams has no abortSignal.
//     On current code: PASSES (no signal injection → modelParams clean).
//     After fix: must still PASS (signal injected at SDK params, not stored in config).
//
// Both B2a and B2b call trackedGeminiCall directly, capturing what the client
// receives vs. what enqueue receives.
// ────────────────────────────────────────────────────────────────────────────

describe('B2 — config/telemetry separation invariant', () => {
  afterEach(() => {
    delete process.env.AI_CALL_TIMEOUT_MS;
  });

  test(
    'B2a [EXPECT-RED]: SDK generateContent call receives abortSignal when called via trackedGeminiCall directly',
    async () => {
      // On current code: trackedGeminiCall passes {model, contents, config} to
      // client.models.generateContent with no abortSignal added → capturedParams.config
      // does not have abortSignal → assertion FAILS → RED.
      // After fix: trackedGeminiCall creates AbortController, merges signal into the
      // SDK params object before calling generateContent → PASSES.

      // Set a generous budget to avoid timeout during this test.
      process.env.AI_CALL_TIMEOUT_MS = '5000';

      let capturedParams = null;
      const capturingClient = {
        models: {
          generateContent: async (params) => {
            capturedParams = params;
            return {
              text: 'captured',
              usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
            };
          },
        },
      };

      const { trackedGeminiCall } = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const mod = require('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call');
          resolve(mod);
        });
      });

      const originalConfig = { temperature: 0.7, maxOutputTokens: 512 };

      await trackedGeminiCall(
        noopDb,
        capturingClient,
        'gemini-2.5-flash',
        'test prompt',
        originalConfig,
        { useCase: 'task-ai', userId: 'u1', correlationId: 'b2a-test' }
      );

      // B2a: the SDK call must receive an abortSignal.
      // On current code: capturedParams === { model, contents, config } where
      // config === originalConfig (no abortSignal) → FAILS RED.
      expect(capturedParams).not.toBeNull();
      const sdkConfig = capturedParams && capturedParams.config;
      expect(sdkConfig).toBeDefined();
      // The abortSignal must be an actual AbortSignal instance.
      expect(sdkConfig.abortSignal).toBeInstanceOf(AbortSignal);
    },
    6000
  );

  test(
    'B2b [GUARD-GREEN]: enqueue modelParams equals original config — NO abortSignal present',
    async () => {
      // This passes on current code (trackedGeminiCall passes original config to enqueue).
      // Must continue to pass after the fix (signal injected into SDK params, NOT into config).

      process.env.AI_CALL_TIMEOUT_MS = '5000';

      const fastClient = {
        models: {
          generateContent: async () => ({
            text: 'fast',
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
          }),
        },
      };

      const { trackedGeminiCall } = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const mod = require('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call');
          resolve(mod);
        });
      });

      const originalConfig = { temperature: 0.7, maxOutputTokens: 512 };

      await trackedGeminiCall(
        noopDb,
        fastClient,
        'gemini-2.5-flash',
        'test prompt',
        originalConfig,
        { useCase: 'task-ai', userId: 'u1', correlationId: 'b2b-test' }
      );

      expect(mockEnqueueFn).toHaveBeenCalledTimes(1);
      const enqueuedEvent = mockEnqueueFn.mock.calls[0][1];

      // modelParams must be byte-identical to originalConfig — no abortSignal key.
      expect(enqueuedEvent.modelParams).toEqual(originalConfig);
      expect(enqueuedEvent.modelParams).not.toHaveProperty('abortSignal');
    },
    6000
  );
});
