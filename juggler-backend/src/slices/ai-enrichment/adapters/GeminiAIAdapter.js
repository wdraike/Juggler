/**
 * GeminiAIAdapter — the ONLY place the `@google/genai` SDK is instantiated
 * (Phase H5). Implements `AIPort`. Consolidates the Vertex-AI / API-key client
 * factory that was DUPLICATED in `ai.controller.getGenAIClient` and the
 * `task.routes /suggest-icon` handler, and routes the usage-telemetry enqueue
 * through `lib/db` (ADR-0002) instead of the `src/db.js` singleton.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * The `db` handed to `trackedGeminiCall` (for the ai_usage_outbox enqueue) is
 * `lib/db`'s shared pool via `getDefaultDb()` — the SAME pool src/db.js re-exports,
 * so behavior is identical; the slice simply no longer imports `src/db.js`.
 * Injectable for tests.
 *
 * ── BEHAVIOR-IDENTICAL (H5 refactor — W1) ────────────────────────────────────
 * Client instantiation reproduces `getGenAIClient` step-for-step: Vertex branch
 * (`USE_VERTEX_AI=true`, requires GOOGLE_CLOUD_PROJECT — else throws the same
 * 'GOOGLE_CLOUD_PROJECT required for Vertex AI') vs API-key branch (requires
 * GEMINI_API_KEY — else throws 'GEMINI_API_KEY not configured'); the client is
 * lazily built once and cached. `generate` returns the raw provider result exactly
 * as `trackedGeminiCall` did. **No timeout here — W1 is behavior-identical; the 8s
 * AbortController timeout is added in W3 (isolated).**
 */

'use strict';

const { trackedGeminiCall } = require('../../../services/gemini-tracked-call');
const { createLogger } = require('@raike/lib-logger');

// W3 (isolated additive): the 8s call timeout. 8s is the juggler convention from
// H1-weather (KG juggler_hex_slice_external_http_calls·must_use — AbortController).
// The @google/genai SDK accepts `abortSignal` inside GenerateContentConfig
// (genai.d.ts:4273), so a real AbortController is used: when the deadline fires,
// the in-flight SDK call is cancelled. A belt-and-suspenders Promise.race is also
// used (mirroring H1 fetchWithTimeout:57-62) so that a signal-ignoring SDK version
// or test double still produces a deterministic rejection within the budget.
const AI_CALL_TIMEOUT_MS = 8000;

/**
 * @param {object} [deps]
 * @param {object}   [deps.client]   pre-built `@google/genai` client (tests inject a fake)
 * @param {Function} [deps.db]       knex handle (default: lib/db getDefaultDb())
 * @param {string}   [deps.model]    model name (default: env GEMINI_MODEL)
 * @param {object}   [deps.env]      env override (default: process.env)
 * @param {object}   [deps.logger]   logger (default: createLogger('ai-enrichment'))
 */
function GeminiAIAdapter(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  this._client = d.client || null; // lazily built if not injected
  this._db = d.db || null;         // resolved lazily to avoid requiring lib/db at construct
  this.model = d.model || env.GEMINI_MODEL || 'gemini-2.5-flash';
  this._env = env;
  this.timeoutMs = typeof d.timeoutMs === 'number' ? d.timeoutMs : AI_CALL_TIMEOUT_MS;
  this.logger = d.logger || createLogger('ai-enrichment');
}

GeminiAIAdapter.prototype._getDb = function _getDb() {
  if (!this._db) this._db = require('../../../lib/db').getDefaultDb();
  return this._db;
};

// Consolidated from getGenAIClient (ai.controller) + the /suggest-icon route —
// identical branch + identical thrown errors.
GeminiAIAdapter.prototype._getClient = function _getClient() {
  if (this._client) return this._client;

  const { GoogleGenAI } = require('@google/genai');
  const env = this._env;

  if (env.USE_VERTEX_AI === 'true') {
    const project = env.GOOGLE_CLOUD_PROJECT;
    const location = env.VERTEX_AI_LOCATION || 'us-central1';
    if (!project) throw new Error('GOOGLE_CLOUD_PROJECT required for Vertex AI');
    this._client = new GoogleGenAI({ vertexai: true, project, location });
    this.logger.info('🤖 Juggler AI: Using Vertex AI (project:', project + ')');
  } else {
    const apiKey = env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    this._client = new GoogleGenAI({ apiKey });
    this.logger.info('🤖 Juggler AI: Using Gemini API with API key');
  }

  return this._client;
};

/**
 * @implements AIPort.generate
 * Returns the raw provider result (`{text?, candidates?, usageMetadata?}`).
 */
GeminiAIAdapter.prototype.generate = async function generate(contents, config, meta) {
  // The 8s deadline uses BOTH an AbortController wired into the SDK config AND a
  // belt-and-suspenders Promise.race (mirroring H1 fetchWithTimeout:57-62). The
  // AbortController threads `abortSignal` into GenerateContentConfig so the SDK
  // cancels the in-flight HTTP request when the deadline fires. The Promise.race
  // ensures a deterministic rejection even if the SDK or a test double ignores the
  // signal. The caller's existing error path then runs (suggest-icon → null;
  // handleCommand → 500) instead of hanging.
  //
  // TELEMETRY ISOLATION (B5-new): `abortSignal` must NOT reach `trackedGeminiCall`'s
  // persisted `modelParams` — serialising an AbortSignal produces `{}`, which would
  // break the refactor's byte-identity invariant for `ai_usage_outbox.model_params`.
  // Fix: pass the ORIGINAL `config` to `trackedGeminiCall` (for telemetry); inject
  // `abortSignal` only at the SDK `generateContent` boundary by wrapping the client's
  // `models.generateContent` to merge it in transparently.
  const controller = new AbortController();

  // Build a thin client wrapper that merges abortSignal into the generateContent
  // call without touching the config arg that trackedGeminiCall persists as modelParams.
  const rawClient = this._getClient();
  const signalClient = {
    models: {
      generateContent: (params) =>
        rawClient.models.generateContent(
          Object.assign({}, params, { config: Object.assign({}, params.config, { abortSignal: controller.signal }) })
        ),
    },
  };

  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error('Gemini call timed out after ' + this.timeoutMs + 'ms');
      err.code = 'ETIMEDOUT';
      reject(err);
    }, this.timeoutMs);
    if (timer.unref) timer.unref();
  });
  // BLOCK B fix (mirrors H1 fetchWithTimeout:82): swallow the timer-reject when it
  // fires as the loser — i.e. when generate() is a floating promise that was never
  // awaited and callPromise settled first. Without this, the 8s timer fires into an
  // unhandled rejection and crashes the jest runner.
  timeoutPromise.catch(() => {});

  // Pass the ORIGINAL config so trackedGeminiCall persists byte-identical modelParams.
  const callPromise = trackedGeminiCall(
    this._getDb(), signalClient, this.model, contents, config, meta || {}
  );
  // Swallow the loser's late rejection (belt-and-suspenders, mirrors H1 pattern).
  callPromise.catch(() => {});

  try {
    return await Promise.race([callPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
};

module.exports = GeminiAIAdapter;
