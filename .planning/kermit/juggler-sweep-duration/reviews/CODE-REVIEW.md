# Ernie Review — WhenSection.jsx duration field (999.889 + 999.890) — new — 2026-06-26

## Status: DONE

## Scooter Consult
**Question asked:** `--ask "task-sidebar duration field free-type + min/max range + minutes unit; canonical range = task.schema.js taskUpdateSchema min(5).max(480); any vetoes/prior decisions on the WhenSection duration input?" --domain scheduler`

**Scooter's answer (cited):**
- **Confidence:** documented (with one contested edge — see below).
- Canonical PUT/save validator is `juggler-backend/src/schemas/task.schema.js:17` — `dur: z.number().int().min(5).max(480).optional()`. The diff's `DUR_MIN=5` / `DUR_MAX=480` mirror this exactly, and the comment at WhenSection.jsx:26-27 names that file as the source of truth. Approach is correct and relitigates **no** veto. `config.schema.js:22` independently uses the same `min(5).max(480)` for `splitMinDefault`, corroborating 480 as the live ceiling.
- **Contested fact (CHALLENGE emitted):** Brain `fact #120` (score 0.34, file-derived) asserts *"juggler_task invariant: Duration is capped at 720 minutes (12h)."* This contradicts the authoritative zod schema (`max(480)` = 8h). Per the precedence ladder (BASE-STANDARD / live SPEC validator ▸ file-derived fact), the **zod schema wins** and this leg is correct to enforce 480. The stale 720 invariant should be superseded/reconciled in the Brain — it does **not** block this leg. Recorded as a contested-knowledge note for reconciliation; the *code* correctly follows the authoritative 480 validator.
- **Vetoes/constraints in play:** none on the WhenSection duration input. No prior decision forbids free-type or the min/max attrs.
- **Gap emitted:** contested-fact note (#120 vs schema) for Scooter reconcile.

Conclusion: the approach (free-type draft + range enforcement 5–480 + minutes unit, mirroring `task.schema.js`) is consistent with the authoritative source and relitigates no settled decision. Clear to proceed.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=new, files=WhenSection.jsx (positional) | present |
| Scope detect | `git diff` WhenSection.jsx + full-file Read 190-330 | 1 file, diff localized to L26-27 (consts) + L202-205 (hooks) + L298-323 (input) |
| Mode gate (new) | SPEC = 999.889/890 intent (free-type + range 5–480 + min unit); canonical range confirmed vs schema | satisfied |
| Complexity scan | file ~330 lines, changed block nesting ≤3 | within bounds |
| Error handling scan | no async/promises/try-catch in diff | n/a — pure sync React handlers |
| Input validation scan | onChange guard + onBlur clamp vs DUR_MIN/DUR_MAX | present & correct |
| Unapproved-fallback scan | `if (isNaN(n)) n = dur` (L314) | revert-to-last-committed, NOT a magic default — sound (see F3) |
| Numeric/boundary scan | `parseInt(raw,10)` / `parseInt(durDraft,10)` radix-10; clamp Math.min/max | radix present; nearest-bound correct |
| Resource scan | no I/O, timers, handles | n/a |
| Concurrency scan | no shared mutable state / async | n/a |
| Type safety scan | `value={durDraft}` string on controlled number input | safe (no `as any`/ts-ignore) |
| React logic scan | useState/useEffect placement + dep array + draft resync | correct (see F1) |
| Observability scan | no console.* added | clean |
| Dead code scan | no TODO/FIXME/commented blocks added | clean |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present: mode=new, file scope non-empty (WhenSection.jsx)
- [x] Scope confirmed — 1 file, diff + targeted Read (L190-330) printed in PoW
- [x] Mode noted + gate checked — new: canonical range/intent confirmed against `task.schema.js:17`
- [x] Complexity scan run — file ~330 lines (no introduced bloat), changed nesting ≤3
- [x] Error handling scan run — no async/promise/catch in diff (pure sync handlers)
- [x] Floating-promise / forEach(async) / Promise.all scan run — none present (no async in scope)
- [x] Error-cause-preservation scan run — no catch blocks in diff
- [x] Input validation scan run — onChange range guard + onBlur clamp validated before `onDurChange`
- [x] Unapproved-fallback scan run — `n = dur` revert read in context; revert-to-last-committed, not a silent default (F3); no `||`/`??` introduced
- [x] Numeric precision/boundary scan run — `parseInt(_,10)` radix present; clamp nearest-bound correct; integer-only path
- [x] ReDoS scan run — no regex / `new RegExp` in scope
- [x] Date/TZ & DB-clock scan run — `addMinutesTo24h` is pre-existing pure string math, unchanged; no Date/clock added
- [x] Resource management scan run — no I/O / handles / timers
- [x] DB-transaction/atomicity scan run — frontend; no DB writes
- [x] Concurrency safety scan run — no module-level mutable state / N+1
- [x] Idempotency-under-retry scan run — n/a (no queue/webhook consumer)
- [x] Grep matches triaged, not just counted — `isNaN`/`n=dur` fallback + parseInt + hook-dep matches READ in context and reasoned
- [x] Type safety scan run — controlled-input string value safe; no unsafe casts
- [x] React logic scan run — hook order/placement, `[dur]` dep array, draft resync, no infinite loop (F1)
- [x] Observability scan run — no bare console.* added
- [x] Dead code scan run — no TODO/FIXME / commented-out blocks
- [x] Flag-and-refer lines emitted — coverage→telly (F4), visual/UX→bird (F5)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" finding filed as a defect (referred to telly)
- [x] No security findings reviewed in depth (none applicable; nothing to refer to elmo)
- [x] Requirements doc-standards: feature has happy path (in-range commit) + unhappy paths (empty/out-of-range/garbage → clamp); ≤5 acceptance paths
- [x] Prior knowledge consulted via Scooter — see `## Scooter Consult`; no relitigation
- [x] Knowledge change reported to Scooter — contested-fact note (#120 720 vs schema 480) flagged for reconcile
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written with PoW + Checklist + Findings + Coverage + Sign-off
- [x] Status line set: DONE (no unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| F1 | INFO | WhenSection.jsx:202-205 | `useState(String(dur))` + `useEffect(setDurDraft(String(dur)), [dur])` is correct. Dep array `[dur]` is complete; `setDurDraft` is a stable setter (not needed in deps). No infinite loop: effect writes `durDraft` which is NOT a dep, so it cannot re-trigger; when value is unchanged React bails. Draft correctly resyncs when `dur` changes externally (End-time→dur at L287, snapshot revert at TaskEditForm L323). Hooks are placed at top of component before any early return. No action. | None — verified correct |
| F2 | INFO | WhenSection.jsx:301-310 | onChange live-commit guard `!isNaN(n) && String(n)===raw && n>=DUR_MIN && n<=DUR_MAX` is conservative and safe. Leading-zeros (`'05'`), `'+5'`, `'1e3'`, `'-'`, whitespace all fail `String(n)===raw` and defer to onBlur (no live commit) rather than mis-committing — correct. parseInt has radix 10. No bug. | None — verified correct |
| F3 | INFO | WhenSection.jsx:312-319 | onBlur clamp `if(isNaN(n)) n=dur; clamped=Math.min(MAX,Math.max(MIN,n))` gives correct nearest-bound behavior. Empty/garbage reverts to last-committed `dur` (the genuine current state, a number), NOT a magic constant — this is sound and is the intended UX, NOT an unapproved fallback. Even the rare `dur===''` parent state (TaskEditForm L253) coerces to a safe in-range `5`. No data-integrity concern. | None — judged sound (not a silent default) |
| F4 | INFO | WhenSection.jsx:202-322 | New draft-state / live-commit-guard / onBlur-clamp / Enter-blur behavior changes the testable surface (existing `WhenSection*.test.jsx` suite covers this component). Coverage of: in-range live commit, out-of-range deferral, empty→revert, clamp-to-bound, End-time resync. REFER→telly | REFER→telly — confirm new branches covered |
| F5 | INFO | WhenSection.jsx:299,322 | `Duration (min)` label + amber `{DUR_MIN}–{DUR_MAX} min` hint span are visual/branding choices (font 9, `TH.amberText`). REFER→bird | REFER→bird — visual/UX |
| F6 | INFO | WhenSection.jsx:287 (pre-existing, unchanged) | The End-time→dur path `onDurChange(endMins - startMins)` can set `dur` outside [DUR_MIN,DUR_MAX] (e.g. a 3-min or 600-min span), bypassing the new Duration-field clamp; such a value would fail the backend `max(480)`/`min(5)` zod validator with a 400 on save. PRE-EXISTING (this handler is untouched by the diff) and out of the introduced scope, but the range is now only enforced on one of the two inputs that write `dur`. Note for follow-up, not a blocker for this leg. | Optional follow-up: clamp/validate the End-time-derived dur too (file backlog item); not in scope here |
| F7 | INFO | task.schema.js:17 vs Brain fact #120 | Contested invariant surfaced by Scooter: Brain holds a stale file-derived fact "duration capped at 720min"; authoritative zod schema enforces `max(480)`. Code correctly follows 480. Recorded for Scooter reconcile (supersede the 720 fact). No code change. | REFER→scooter reconcile (knowledge, not code) |

No BLOCK findings. No WARN findings.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Draft/effect resync, live-commit guard, and onBlur clamp all traced (F1–F3); nearest-bound clamp verified; consts mirror authoritative `task.schema.js:17` | No logic defect |
| Readability | covered | Inline comment names the canonical source (L26-27) and explains the revert (L314); clear var naming | — |
| Maintainability | covered | DUR_MIN/DUR_MAX are single source for attrs + guard + clamp + hint (no duplicated literals) | exported consts reusable |
| Error Handling | covered | No async/throw paths; invalid input handled by guard-then-defer + clamp, not exceptions | n/a for promises |
| Coupling | covered | Depends only on injected props (`dur`, `onDurChange`, `onEndTimeChange`, `time`) + pure `addMinutesTo24h` | clean |
| Type Safety | covered | Controlled number input with string `value={durDraft}` is React-safe; parseInt radix-10; no `as any`/ts-ignore | — |
| API Design | covered | Commit contract unchanged: still emits integer via `onDurChange`; only adds range gating | back-compatible with parent |
| Resource Management | covered | No handles/timers/I/O introduced | n/a |
| Concurrency Safety | covered | Pure synchronous React handlers; no shared mutable state, no async | n/a |

## Sign-off
Signed: Ernie — 2026-06-26T00:00:00Z
