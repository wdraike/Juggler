# Security Review — juggler AI input-trust boundary (W2b / backlog 999.417) — bugfix — 2026-06-12

## Status: DONE

No exploitable BLOCK on the AI input-trust boundary. The dominant control — the AI **never writes the DB**; it returns JSON `ops` that the frontend re-applies through standard JWT-authenticated, `req.user.id`-scoped task endpoints — holds. Prompt injection's blast radius is the caller's own tasks. Findings below are WARN/INFO hardening + defense-in-depth.

## Scope
4 in-scope files (--files): `ai.controller.js`, `task.routes.js`, `slices/ai-enrichment/facade.js`, `slices/ai-enrichment/adapters/GeminiAIAdapter.js`. Traced the op-application path beyond scope (read-only) to reach a verdict: `ai.routes.js`, `gemini-tracked-call.js`, `KnexAIUsageRepository.js`, `task.controller.js`, `slices/task/facade.js`, `lib/tasks-write.js`, `KnexTaskRepository.js`, frontend `AppLayout.jsx` op applier.

## Threat-model summary (the load-bearing conclusion)
The brief's central worry — "can a crafted command make the AI emit ops affecting OTHER users' data or escalate privilege?" — resolves to **NO**, by architecture, not by prompt hygiene:

1. `handleCommand` returns `{ ops, msg }` to the browser. It does **not** apply ops.
2. The frontend (`AppLayout.jsx` `applyAiOps`) translates ops into ordinary calls to `PUT /api/tasks/batch`, `POST /api/tasks/batch`, and per-user config updaters.
3. Every one of those endpoints is `authenticateJWT`-gated and scoped server-side to `req.user.id` (`task.controller` lines 91/109/127/161/177; `slices/task/facade` `updateTaskById(..., userId)`; `lib/tasks-write.js:197` sets `mWhere.user_id = userId` / `iWhere.user_id = userId`).

Consequence: even if a prompt-injected response emits `{"op":"delete","id":"<another-user's-task-id>"}`, the downstream UPDATE/DELETE matches **zero rows** because the WHERE is pinned to the authenticated principal. The AI cannot mint an op that crosses the tenant boundary, cannot set `user_id`/`owner` (not in the op schema, and the write layer ignores caller-supplied ownership), and cannot escalate role/plan (no such op exists). The scope-restriction system prompt is a best-effort UX guardrail, **not** the security boundary — and it does not need to be.

What injection CAN do: coax the model to ignore the scope prompt and produce nonsense ops, or refuse. Blast radius = the user's own task list (a correctness/UX nuisance, undo-able client-side via `pushUndo`). Not a privilege/exfiltration finding.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode bugfix, --files (4) present | present |
| Scope detect | --files list + downstream op-path trace | 4 in-scope, 9 traced |
| **Scanner pre-filter (Step 2.5)** | gitleaks / semgrep / eslint OUTCOME | gitleaks=**absent**, semgrep=**absent** ⇒ grep-only SAST+secret coverage (recorded); eslint=**ran(rc=0, clean)** on all 4 scope files |
| A01 scan | op→DB ownership trace (AI ops → batch endpoints → user_id WHERE); mass-assignment; cross-product | ops never DB-write; every write user_id-scoped; op schema has no ownership/role field; `requireFeature('ai.natural_language_commands')` slug-gated |
| A02 scan | GEMINI_API_KEY handling; hardcoded secrets | key read from `env.GEMINI_API_KEY`, never logged/echoed; no hardcoded secrets in scope |
| A03 scan | LLM-output JSON.parse; prompt injection; XSS in 422 echo | `JSON.parse` of model text in try/catch (no eval); 422 echoes **model output** (HTML-special stripped), JSON content-type |
| A04 scan | rate limit + input validation + quota | 2/min limiter (Redis-backed, user-keyed) + 50/day quota + `command.trim()` guard |
| A05 scan | error/stack exposure; CSRF | 500 returns `err.message` only (no stack); Bearer-JWT auth (no auth cookie) ⇒ not CSRF-exposed |
| A06 scan | npm audit / deps | no dep change in this leg; @google/genai already present |
| A07 scan | JWT verify alg pinning | out of scope files; `authenticateJWT` middleware (not modified this leg) — noted, not re-audited |
| A08 scan | unsafe deserialization | model output parsed as data only; not deserialized into code/objects with side effects |
| A09 scan | secrets/PII in logs; audit trail | NO prompt/command/raw/apiKey reaches any log sink; telemetry enqueues model_params (temp/topK) + tokens, **no prompt text**; telemetry `userId:null` (INFO) |
| A10 scan | SSRF | no user-controlled URL fetch; Gemini endpoint fixed by SDK |
| Frontend scan | op applier | `AppLayout.jsx` applies ops via authenticated user-scoped API; no innerHTML of model text |
| Threat intel | WebSearch (--external) | skipped — narrow bugfix, no new deps; OWASP LLM Top-10 reasoned from first principles |
| Refer-ins | CODE-REVIEW.md / ARCH-REVIEW.md | ernie referred this pass (W2b); no REFER→elmo lines pending in those files |
| Output written | SECURITY-REVIEW.md + elmo-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode bugfix, --files 4 present)
- [x] Scope confirmed — 4 files in scope, 9 traced downstream
- [x] Mode-appropriate checks run: bugfix — confirmed the H5 refactor did not open/close an authz gate; the user_id-scoping on the op-apply path is intact post-slice-extraction
- [x] All OWASP A01–A10 categories scanned
- [x] Frontend/React security scan complete (op applier read)
- [x] Authz checked — `/api/ai/command` gated by authenticateJWT + requireFeature(slug) + checkUsageLimit
- [x] BOLA/IDOR ownership-trace done — AI ops → batch/config endpoints → `user_id` WHERE in `lib/tasks-write.js:197` (traced, not grep-only); cross-tenant op = zero-row match
- [x] BFLA / vertical authz checked — op schema exposes no role/admin/plan op; no privileged function reachable via an op
- [x] Mass-assignment / over-posting checked — ops cannot set `user_id`/`owner`; write layer pins ownership server-side
- [x] Cross-product/tenant authz checked — `requireFeature('ai.natural_language_commands')` resolves via plan-features (product-slug keyed per monorepo invariant)
- [x] CSRF check run — endpoint is Bearer-JWT (no auth cookie) ⇒ CSRF-exempt; no state-changing GET on the AI path (POST /command)
- [x] JWT algorithm pinning — `authenticateJWT` is out of the 4 in-scope files and unchanged this leg; noted as not-re-audited (no BLOCK asserted on unseen code)
- [x] Prototype-pollution checked — `JSON.parse` output is iterated by explicit `op.op ===` switch in the applier; no recursive merge of model output into a config object via `__proto__`/`constructor` keys
- [x] Path-traversal/zip-slip + file-upload — N/A (no filesystem/upload on this boundary)
- [x] Secrets scan complete — GEMINI_API_KEY read from env, never hardcoded/logged/echoed
- [x] Secrets/PII-in-logs scan complete — no command/prompt/raw/apiKey/req.body in any log sink; telemetry carries no prompt text
- [x] Supply-chain depth — no dep bump in this leg
- [x] Threat model complete (--external) — OWASP LLM Top-10 + A01/A03/A09 reasoned; WebSearch skipped (narrow bugfix, no new deps) per --external bugfix-narrow rule
- [x] npm audit — not re-run (no dependency change in the 4-file diff)
- [x] Refer-ins from ernie incorporated — ernie referred the whole pass; no per-line REFER→elmo open
- [x] Grep matches triaged, not just counted — every log/authz/parse candidate READ + traced to its sink/owner
- [x] Findings carry file:line + severity + risk annotation
- [x] Flag-and-refer lines emitted (W1/W2 below → ernie/telly)
- [x] Prior knowledge consulted via Scooter — no prior AI-boundary security decision/veto exists; this review seeds the record
- [x] Rubric Coverage Map emitted — all 10 dimensions marked
- [x] Output file written with Proof-of-Work table
- [x] Status line set DONE

## Findings
| # | Severity | OWASP | File:Line | Description | Required Fix / Refer |
|---|----------|-------|-----------|-------------|----------------------|
| 1 | WARN | A03 / LLM02 (output handling) | juggler-backend/src/controllers/ai.controller.js:122 | 422 path returns `raw: cleaned.substring(0,500).replace(/[<>&"']/g,'')`. The echoed value is the **model output** (not raw user input as the brief framed it), so reflected-injection of *attacker* text is not direct. Residual risk: (a) the strip is a denylist (`< > & " '`) — incomplete vs a future HTML-rendering consumer; backtick, `=`, `/`, control chars, and unicode look-alikes pass; (b) the response is `application/json`, so browser XSS is not live today, but any client that ever renders `raw` as HTML (a debug panel, an admin log viewer) re-opens it. Risk: low (CVSS ~3.1 — needs a future HTML sink). | Prefer **not echoing model output at all** (return a stable `code: 'AI_BAD_JSON'` + generic message); if the echo must stay for debuggability, gate it behind a non-prod flag and/or allowlist-encode rather than denylist-strip. Defense-in-depth, not a live exploit. |
| 2 | WARN | A09 (audit trail) | juggler-backend/src/controllers/ai.controller.js:28 | `generate(..., { userId: null })` — the AI call's telemetry row (`ai_usage_outbox`) is written **unattributed** even though `req.user.id` is in hand (used correctly for quota at lines 57/106). Privacy-positive (no per-user PII in telemetry) but it **breaks the audit trail**: an abuse/cost investigation cannot tie an AI call to a user. The quota table (`ai_command_log`) IS user-keyed, so attribution exists elsewhere — but the inference/cost telemetry does not. | Decide intentionally: if telemetry must stay anonymized, document that as an approved data-minimization choice in juggler/CLAUDE.md (so it's not read as a bug later); otherwise pass `req.user.id` so cost/abuse is attributable. Either way record the decision. Not a leak — an audit-completeness gap. |
| 3 | INFO | A04 (insecure design) | juggler-backend/src/controllers/ai.controller.js:90 | The scope-restriction system prompt is a best-effort guardrail; LLM01 prompt injection can make the model ignore it and emit off-scope/garbage ops or refuse. This is **acceptable** because the security boundary is the downstream user_id-scoped write path, not the prompt — blast radius is the caller's own tasks (undo-able). Documented so a future reviewer doesn't mistake the prompt for the authz control. | None required. Optional belt-and-suspenders: server-side op-shape allowlist before returning `ops` (reject unknown `op` types / unexpected fields) so a manipulated model can't return ops the client switch doesn't expect. → see W1 refer. |
| 4 | INFO | A01 (defense-in-depth) | juggler-backend/src/routes/task.routes.js:64 | `PUT /api/tasks/batch` and `POST /api/tasks/batch` (the endpoints the AI ops land on) carry **no `validate(schema)` middleware** (unlike single `POST /` and `PUT /:id`). They are correctly `user_id`-scoped server-side, so this is not an authz hole, but it means AI-emitted (model-controlled) op payloads reach the batch facade without schema validation. | Add a batch Zod schema + `validate()` to the two batch routes so malformed/over-posted batch bodies are rejected at the edge. Out of the 4-file scope (route file is in scope; controller/facade are not) → flag-and-refer to ernie for the validation-completeness call. |

## Flag-and-refer
- `REFER→ernie: juggler-backend/src/routes/task.routes.js:63-64` — `POST /batch` and `PUT /batch` lack `validate(schema)` middleware that the single-item routes have; AI-emitted op payloads reach the facade unvalidated (user_id-scoped, so DiD not authz). Ernie owns the input-validation-completeness verdict.
- `REFER→ernie: juggler-backend/src/controllers/ai.controller.js:131` — consider a server-side op-shape allowlist before returning `ops` (reject unknown op types / stray fields) so a prompt-manipulated model response can't surface ops the client `op.op ===` switch silently mishandles. Correctness/robustness call.
- No `REFER→telly` — there is **no security BLOCK** requiring a regression test. (If W2/999.417 elects to add the op-shape allowlist or batch schema as a hardening fix, the matching regression test is telly's, specified at that time.)

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Input Validation | partial | `command.trim()` guard + unicode-normalize sanitizer (ai.controller:49,95); 422 JSON-parse in try/catch | Batch op payloads unvalidated downstream (F#4 → ernie); prompt itself is data-only to the LLM |
| Authentication | covered | `/api/ai/command` behind `authenticateJWT`; JWT-verify middleware unchanged this leg (out of scope, noted) | No new auth surface in the 4 files |
| Authorization | covered | AI ops → user_id-scoped batch/config endpoints (`lib/tasks-write.js:197`); no cross-tenant/escalation op possible; requireFeature(slug) gate | The headline result — boundary is sound |
| Data Protection | covered | GEMINI_API_KEY env-only; no secret in source/log/echo; HTTPS via SDK | — |
| Dependencies | covered | no dep change this leg | npm audit not re-run (no diff) |
| Exposure Surface | covered | 500 returns `err.message` only (no stack); 422 echoes stripped model output | F#1 hardening on the 422 echo |
| Session Security | covered | Bearer-JWT (no auth cookie) ⇒ CSRF-exempt; no state-changing GET on AI path | — |
| Audit Trail | partial | quota log user-keyed; inference telemetry `userId:null` (F#2) | Attribution gap in `ai_usage_outbox` |
| Infrastructure Security | covered | Vertex/API-key branch reads env at construct; no infra/config change in scope | — |
| Secrets Management | covered | API key from env, never logged ("API key" in log line is literal text, not the value); telemetry carries no prompt/key | — |

## Sign-off
Signed: Elmo — 2026-06-12T00:00:00Z

---

# Re-Review — W2b fix verification (bert actioned W1 + W2) — bugfix --re-review — 2026-06-12

## Status: DONE

Both prior WARNs are **RESOLVED**. No NEW BLOCK or WARN introduced by bert's changes on this boundary. The architectural conclusion (AI never writes the DB; ops re-apply through JWT + `req.user.id`-scoped endpoints) is unchanged and still load-bearing.

## W1 (F#1) — 422 echo allowlist-encode — **RESOLVED**
`ai.controller.js:136-138`. The denylist-strip (`/[<>&"']/g` → delete) was replaced with an **encode** of a superset: `/[&<>"'\`=\/\x00-\x1F\x7F]/g` → each match becomes its decimal HTML entity `&#NN;`.

Verification (ran an adversarial spot-test of the exact regex against 9 payloads):
- `<script>…</script>`, `<img … onerror=…>`, `</textarea><svg/onload=…>`, backtick-attr-breakout — **all fully neutralized** for an HTML sink (every `<`, `>`, `"`, `'`, backtick, `=`, `/` encoded).
- **Double-decode bypass closed:** `&` is in the encode set, so a model-supplied pre-encoded entity `&#60;script&#62;` becomes `&#38;#60;…` — it can no longer decode to `<script>` in a downstream HTML renderer. This was the key gap a denylist-strip leaves open; the new encoder closes it.
- C0 control chars + DEL encoded (log/terminal-injection hardening).
- Benign text passes unchanged.
- Residual (non-regression, INFO): a bare `javascript:` scheme string passes through (no special char to encode) — harmless because `raw` is a JSON string field and any future HTML sink renders it as text/attribute where the quote chars are already encoded (no `href`/`src` value injection possible without an unencoded quote). Not a live vector.

Is the echoed content safe for the JSON response + a log sink? **Yes.** It is `application/json` (browser does not parse as HTML), and `raw` is never passed to a logger (the only log calls on this path are `logger.warn(commitErr)` and `logger.error(err)` — neither carries `raw`/`cleaned`). Control chars are now entity-encoded, so even an accidental future log of `raw` is terminal-injection-safe.

Bypass remaining: **none material.** The encode is allowlist-equivalent for the HTML-sink threat (every char that is dangerous in HTML text/attribute context is encoded). Note: it is technically a "dangerous-char → encode" set, not a pure "encode-everything-outside-[A-Za-z0-9]" allowlist — but for the stated HTML-sink threat the coverage is complete; no escape vector was found.

REFER→ernie (style/correctness, NOT security): `ai.controller.js:136` — ESLint flags `no-control-regex` (`\x00`,`\x1f`) and `no-useless-escape` (`\/` inside a char class is redundant). The control-char match is **intentional and correct** here (it is the security control); the `\/` can drop its backslash. Ernie owns the lint-disable-comment / cleanup verdict; neither affects the security behavior.

## W2 (F#2) — telemetry userId attribution — **RESOLVED**
The authenticated principal is now threaded end-to-end:
`req.user.id` (`ai.controller.js:56`, set by `authenticateJWT` — server-side, **not** client-supplied/spoofable) → `callGemini(safeCmd, sysPrompt, userId)` (:107) → `generate(contents, config, { userId: userId || null })` (:25-34) → `GeminiAIAdapter.generate` (passes `meta` through, :143-153) → `trackedGeminiCall({ userId })` (:9) → `enqueue({ userId })` → `ai_usage_outbox.user_id` (`ai-usage-queue.service.js:12`).

- It is the **same** `req.user.id` already trusted for the quota gate (`checkQuota`/`commitQuota`, :67/:116) — no new trust assumption; not a body/query value.
- The attribution gap (`userId: null`) is closed: an abuse/cost investigation can now tie an inference row to a user.

No NEW leak introduced: `enqueue` persists only `user_id`, `use_case`, `model_name`, `model_params` (the temp/topP/topK/maxOutputTokens **config** object — NOT the prompt), `tokens_in/out`, `latency_ms`, `error_flag/type`, `correlation_id`, timestamps. The prompt/command **contents** and the `GEMINI_API_KEY` are never passed to `enqueue` (traced `trackedGeminiCall` :64-78 — only `config` is enqueued as `modelParams`, `contents` is not). Threading userId carried no prompt text, no PII beyond the user id itself, and no key.

## No new security issue from bert's collateral changes
- B7 null guard (`:39-41`) — converts a null model result into the structured `Error` instead of a raw 500; no info-leak (500 returns `err.message` only, no stack — unchanged).
- `commitQuota` try/catch (`:115-119`) — `logger.warn('commitQuota DB error …', commitErr)` logs the DB Error object only; no command/prompt/PII/key in the log line. Safe.
- B8 key live-invalidation in `GeminiAIAdapter._getClient` — the API key is compared/cached in memory and never logged (the two `logger.info` lines log a literal string, not the key value). Safe.

## Re-Review Proof of Work
| Check | Result |
|-------|--------|
| Prior review loaded | SECURITY-REVIEW.md (W2b) — 2 WARN (W1, W2), Status DONE |
| W1 verified | RESOLVED — adversarial spot-test of the exact regex on 9 payloads (script/img/textarea/backtick/entity/control); all HTML vectors neutralized, double-decode bypass closed |
| W2 verified | RESOLVED — userId traced controller→facade→adapter→trackedGeminiCall→enqueue→DB; source is authenticated req.user.id; no prompt/PII/key co-threaded (enqueue payload read) |
| New-issue scan | none — B7 guard / commitQuota catch / B8 key handling read; no secret/PII to a log sink, no stack leak |
| Scanner pre-filter | gitleaks=**absent**, semgrep=**absent** ⇒ grep+read-only coverage (recorded); eslint=**ran** on ai.controller.js → 2 style errors (no-control-regex, no-useless-escape) — REFER→ernie, not security |

## Re-Review Proof Checklist
- [x] Prior SECURITY-REVIEW.md loaded; each prior WARN marked RESOLVED/PERSISTS/NEW
- [x] W1 RESOLVED — encode (not denylist-strip); HTML-sink vector neutralized; double-decode bypass closed; safe for JSON response + log sink; adversarially spot-tested
- [x] W2 RESOLVED — authenticated req.user.id threaded to telemetry (not spoofable); attribution gap closed
- [x] No NEW leak — enqueue payload traced; no prompt/PII/key co-threaded with userId
- [x] No NEW security issue from bert's collateral changes (B7, commitQuota catch, B8)
- [x] Scanner pre-filter run + outcome recorded (gitleaks/semgrep absent ⇒ grep-only; eslint ran)
- [x] Flag-and-refer emitted for the out-of-column lint nits (→ ernie)
- [x] Status set DONE (zero unresolved BLOCK)

## Re-Review Sign-off
Signed: Elmo — 2026-06-12T00:00:00Z
