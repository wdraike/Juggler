const { enqueue } = require('./ai-usage-queue.service');
// Named envConfig (not `config`) to avoid shadowing this file's own `config`
// parameter (the Gemini SDK call config) below (999.1473).
const envConfig = require('../../../lib/config');

// Default AI call budget: read at call time so process.env overrides in tests
// take effect without re-requiring the module. Mirrors H1 fetchWithTimeout pattern.
// Weather keeps its own 8s constant (EXTERNAL_CALL_TIMEOUT_MS); AI calls use this
// larger budget because model inference is slower than weather HTTP lookups.
// 45s default lives in lib/config's SCHEMA now; override via AI_CALL_TIMEOUT_MS (999.1473).

async function trackedGeminiCall(db, client, modelName, contents, config, { useCase, userId = null, correlationId = null, timeoutMs } = {}) {
  // Read env at call time (not module load) so tests setting process.env.AI_CALL_TIMEOUT_MS
  // before require() take effect via isolateModules, and runtime env overrides work.
  // config.getInt reads process.env fresh on every call (never memoized), same contract.
  const budget = (timeoutMs != null) ? timeoutMs : envConfig.getInt('AI_CALL_TIMEOUT_MS'); // 999.1473

  const controller = new AbortController();

  // sdkConfig merges abortSignal into the SDK call only — the original config
  // is passed unchanged to enqueue() so persisted model_params stay byte-identical
  // (B2 invariant). Do NOT mutate the caller's config object.
  const sdkConfig = Object.assign({}, config, { abortSignal: controller.signal });

  // timedOut flag: set synchronously by the timer BEFORE controller.abort() fires.
  // The callPromise finally block reads this flag to suppress orphaned enqueue() calls
  // on the timeout-abort path (B4 fix). A genuine provider error (non-timeout) leaves
  // timedOut=false, so those failures still enqueue a telemetry row with errorFlag=true.
  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const err = new Error('Gemini call timed out after ' + budget + 'ms');
      err.code = 'ETIMEDOUT';
      reject(err);
    }, budget);
    if (timer.unref) timer.unref();
  });
  // Swallow the loser's late rejection so no unhandled-rejection fires when the
  // other branch settles first (mirrors H1 fetchWithTimeout:82).
  timeoutPromise.catch(() => {});

  const start = Date.now();
  let result = null;
  let errorFlag = false;
  let errorType = null;

  // callPromise wraps the SDK call + telemetry enqueue in a finally block.
  // It passes sdkConfig (with abortSignal) to the SDK but the ORIGINAL config
  // (no abortSignal) to enqueue — preserving the B2 byte-identity invariant.
  const callPromise = (async () => {
    try {
      result = await client.models.generateContent({ model: modelName, contents, config: sdkConfig });
      return result;
    } catch (err) {
      errorFlag = true;
      errorType = err.code ?? err.constructor.name ?? 'UnknownError';
      throw err;
    } finally {
      // B4 fix: suppress orphaned telemetry rows on timeout-abort. When our own
      // deadline fires (timedOut=true), the call was abandoned by the caller — do
      // NOT write a billing/telemetry row. A genuine provider error (timedOut=false)
      // still enqueues with errorFlag=true (intended behavior unchanged).
      if (!timedOut) {
        const usage = result?.usageMetadata ?? {};
        enqueue(db, {
          userId,
          useCase,
          modelName,
          modelParams:   config ?? null,   // original config — no abortSignal
          tokensIn:      usage.promptTokenCount     ?? 0,
          tokensOut:     usage.candidatesTokenCount ?? 0,
          latencyMs:     Date.now() - start,
          error:         errorFlag,
          errorType,
          correlationId,
          occurredAt:    new Date(start),
        });
      }
    }
  })();
  // Swallow the loser's late rejection (belt-and-suspenders, mirrors H1 pattern).
  callPromise.catch(() => {});

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { trackedGeminiCall };
