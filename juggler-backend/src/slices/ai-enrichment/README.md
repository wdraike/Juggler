---
type: explanation
status: active
version: leg/juggler-hex-h5 @ 2026-06-12
Last-updated: 2026-06-12
---

# AI Enrichment Slice

Hexagonal (ports-and-adapters) vertical slice for all AI/LLM provider
functionality. Phase H5 of the juggler hex migration — the AI-command and
icon-suggestion seam extracted from the inline `@google/genai` SDK calls that
previously lived in `controllers/ai.controller.js` and `routes/task.routes.js`.

External code must import only `slices/ai-enrichment/facade` (or
`slices/ai-enrichment`). Imports of slice internals (adapters, ports) from
outside the slice are forbidden by the active ESLint boundary rule
(`npm run lint:boundaries`).

---

## Structure

```
slices/ai-enrichment/
├── adapters/
│   ├── GeminiAIAdapter.js      # AIPort backed by @google/genai (Gemini/Vertex)
│   ├── KnexAIUsageRepository.js # AIUsagePort backed by ai_usage_outbox table (lib/db)
│   ├── MockAIAdapter.js        # Test double for AIPort
│   ├── gemini-tracked-call.js  # Timeout + usage-telemetry wrapper around the SDK call (999.1204)
│   ├── ai-usage-queue.service.js   # ai_usage_outbox enqueue (usage telemetry rows) (999.1204)
│   └── ai-usage-flusher.service.js # Outbox flusher → payment-service ingest (999.1204)
└── facade.js                   # Public API — lazy singleton wiring + boot-init hook
```

The `domain/ports/` JSDoc contract files (`AIPort.js`, `AIUsagePort.js`) were
deleted as dead code (999.1179 — never required at runtime); the port
contracts live as the facade's documented method signatures below.

No `application/` layer and no `value-objects/` layer. The scope of H5 was a
light extraction: the SDK seam and the quota gate. No `Enrichment` or
`UserOverride` entities exist in the codebase; building them would be a
separate `new` feature.

---

## Ports

### AIPort

Single method: `generate(contents, config, meta) → Promise<providerResult>`.

Returns the RAW `@google/genai` `generateContent` response
(`{ text?, candidates?, usageMetadata? }`) verbatim — the call-sites keep
their own result extraction and validation. Usage telemetry enqueueing
(`ai_usage_outbox`) stays inside the adapter.

Contract method list: `['generate']`

### AIUsagePort

Split check/commit interface (H5 W1b B5 fix):

| Method | Description |
|--------|-------------|
| `checkQuota(userId)` | Count-only, no insert. Returns `{ allowed: boolean }`. Call BEFORE the provider call. |
| `commitQuota(userId)` | Insert-only. Call ONLY after a successful provider call; never called on failure or timeout. |

Contract method list: `['checkQuota', 'commitQuota']`

**Binding invariant (AIUsagePort):** `checkQuota` and `commitQuota` are
deliberately separate operations. Calling `commitQuota` on a failed Gemini
call would over-count daily usage — the split interface prevents that.

---

## Adapters

### GeminiAIAdapter

Implements `AIPort`. Absorbs the `@google/genai` SDK instantiation branch
(Vertex AI vs. API-key path) previously inline in `getGenAIClient`. The
provider client is built once and cached. Model is the adapter's configured
`GEMINI_MODEL`.

### KnexAIUsageRepository

Implements `AIUsagePort`. Backed by `lib/db` (ADR-0002). Exposes the
`AI_DAILY_LIMIT` constant (50/day) as a static property.

### MockAIAdapter

Test double for `AIPort`. Not used in production — import directly from the
facade in tests.

---

## Facade

`slices/ai-enrichment/facade.js` is the single public API. Both singletons
(`GeminiAIAdapter` and `KnexAIUsageRepository`) are **lazy** — built on first
call to `generate` / `checkQuota` / `commitQuota` so requiring the facade
never touches the SDK or DB pool at import time.

| Export | Description |
|--------|-------------|
| `init()` | Boot hook — eagerly calls `getDefaultDb()` to validate DB configuration at server boot (B9 fail-fast). Does NOT build the AI/usage singletons. |
| `generate(contents, config, meta)` | Delegates to `GeminiAIAdapter.generate`. Returns the raw provider result. |
| `checkQuota(userId)` | Delegates to `KnexAIUsageRepository.checkQuota`. Returns `{ allowed: boolean }`. |
| `commitQuota(userId)` | Delegates to `KnexAIUsageRepository.commitQuota`. Insert-only, post-success call only. |
| `AI_DAILY_LIMIT` | Re-export of `KnexAIUsageRepository.AI_DAILY_LIMIT` (50). |
| `GeminiAIAdapter`, `KnexAIUsageRepository`, `MockAIAdapter` | Named adapter exports for explicit DI in tests. |
| `_setAdapters({ aiAdapter, usageRepo })` | Test-only DI hook. Explicit `undefined` leaves a singleton unchanged; explicit `null` resets it to lazy-rebuild. |
| `_reset()` | Full reset — sets both singletons to null for lazy-rebuild. |

**Boot-init hook:** `server.js` line 61 calls `facade.init()` during server
startup. This validates the DB pool configuration before the first AI request
arrives, surfacing any misconfig at boot rather than at runtime.

---

## Usage

### Importing the facade

```javascript
const aiFacade = require('./slices/ai-enrichment/facade');
```

There is no `index.js` re-export or namespace wrapper for this slice; the
facade is imported directly.

### Checking and committing quota

```javascript
const aiFacade = require('./slices/ai-enrichment/facade');

// Check before calling the provider
const { allowed } = await aiFacade.checkQuota(userId);
if (!allowed) {
  return res.status(429).json({ error: 'Daily AI limit reached' });
}

// Call the provider
const result = await aiFacade.generate(contents, config, { useCase: 'TASK_AI', userId });

// Commit only after success
await aiFacade.commitQuota(userId);
```

### Using MockAIAdapter in tests

```javascript
const { MockAIAdapter } = require('./slices/ai-enrichment/facade');

aiFacade._setAdapters({ aiAdapter: new MockAIAdapter({ text: 'test response' }) });
// ... run test ...
aiFacade._reset();
```

---

## Architecture Boundary

The ESLint boundary rule (`eslint.boundaries.config.js`, run via
`npm run lint:boundaries`, ref `JUG-HEX-H5 (W4)`) enforces that external code
imports only the facade, never slice internals. Direct imports of
`slices/ai-enrichment/adapters/*` from outside the slice are a lint error.
(server.js gets the usage flusher via `facade.createUsageFlusher`.)

The ai-enrichment slice has no `index.js`. The facade is the single import
point; there is no `{ aiEnrichment: facade }` namespace wrapper.

---

## Testing

Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The ai-enrichment suite covers:

- Contract tests asserting `GeminiAIAdapter` and `MockAIAdapter` satisfy `AI_PORT_METHODS`
- Contract tests asserting `KnexAIUsageRepository` satisfies `AI_USAGE_PORT_METHODS`
- Quota split-interface behavior: `checkQuota` does not insert; `commitQuota` inserts
- Facade lazy-singleton semantics: `_setAdapters` / `_reset` DI hook behavior
- `init()` boot hook: throws on bad DB config, resolves on valid config

---

## Dependencies

The slice adapters delegate to:

- `lib/db` — Knex DB access (`KnexAIUsageRepository`, `init()`)
- `@google/genai` — Gemini SDK (`GeminiAIAdapter`)
- `@raike/lib-logger` — structured logging (`GeminiAIAdapter`)
