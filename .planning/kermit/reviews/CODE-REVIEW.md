# Ernie Review — juggler-tz-display-a1 (tz display + config payload) — bugfix — 2026-06-22

## Status: DONE

## Scooter Consult
- **Question asked:** "For task-time DISPLAY, is users.timezone authoritative over the browser timezone when no explicit per-user override is set? (TZ-DISPLAY-1 / R31.3). Does users.timezone default to America/New_York (non-null)? Any prior decision on unconfigured-user display = browser vs NY?"
- **Cited answer:** YES — `users.timezone` is authoritative over the browser for display. **TZ-DISPLAY-1** (`juggler-backend/docs/TIMEZONE-RULES.md:39-43`, brain #77669) and **R31.3** (`docs/REQUIREMENTS.md:361`, brain #77140) both require display in the configured `users.timezone`. The diff's core ordering (override → configured → browser → NY) is documented-correct and the per-user override still wins.
- **Constraint surfaced (not a veto):** **TZ-DISPLAY-3** (`TIMEZONE-RULES.md:50-51`) documents the *unset* fallback as `America/New_York`, **not** the browser. The diff falls back to *browser* for unset users. Additionally `users.timezone` carries a DB default of `'America/New_York'` (`20260301000000_initial_schema.js:13`, non-null in practice), so a production "unset" user actually stores `'America/New_York'` and the browser-fallback branch is largely unreachable. No recorded human decision overturns TZ-DISPLAY-3 — this is an undocumented divergence, filed WARN (W1), not BLOCK. Scooter emitted an INBOX gap notice.
- **Binding prior decision/veto relitigated:** none.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from working-tree diff on leg/juggler-tz-display-a1 | present |
| Scope detect | `git diff --stat` + untracked test | 10 tracked files (5 BE incl. test, 5 FE) + 1 untracked FE test |
| Bugfix gate | reproduction captured in untracked test (12:00 UTC → 8:00 AM NY, sanity 9:00 PM Tokyo) | present (failing-repro encoded as regression test) |
| Complexity scan | `wc -l` changed files | all ≤ 377 (useConfig 377, timezone 188); no new file > 300; resolveDisplayTimezone is a 3-line pure fn |
| Error handling scan | grep `.then(`/`catch{}`/floating promise | KnexConfigRepo `.then()` matches the file's existing knex-builder convention; `getUserTimezone` thenable consumed by an awaited `Promise.all` — no floating promise, no new unhandled rejection |
| Input validation scan | userId path / config payload | userId unchanged from siblings (already JWT-scoped upstream); no new public entry point; FE reads localStorage with try/catch |
| Unapproved-fallback scan | grep `\|\|` / `??` in new code | All `\|\|` are intentional resolution-order/null-coalescing on tz strings (display default `America/New_York` is the documented contract value, TZ-DISPLAY-3); none papers over a maybe-missing data field silently → see W1 (semantics divergence, not a banned fallback) |
| Resource scan | sync I/O / handles / timers | none added |
| Concurrency scan | shared mutable state / N+1 | none added; GetConfig `Promise.all` index wiring verified (res[4] ↔ getUserTimezone, 5th element) |
| Type safety scan | as any / null guards | JS (no TS); null guards present (`row && row.timezone`, `tz ? tz : null`, `opts \|\| {}`) |
| React logic scan | useEffect deps / .map keys / state | `useTimezone` useMemo([]) for browser tz is correct (browser tz stable for session); `initFromConfig` useCallback — setUserTimezone added, setters are stable so no dep-array change needed; no new `.map`/key |
| Observability scan | bare console.log | none added (try/catch swallow on localStorage is a pre-existing pattern, acceptable for a non-critical UI sync) |
| Dead code scan | TODO/FIXME | none added |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 11 files in scope (printed above)
- [x] Scope confirmed — file list non-empty (BE: KnexConfigRepository, GetConfig, ConfigRepositoryPort, InMemoryConfigRepository, configUseCases.test; FE: useConfig, useTaskState, useTimezone, apiClient, timezone.js, timezone.test.js)
- [x] Mode noted + gate checked — bugfix; reproduction encoded as the untracked regression test (failing-before / passing-after assertions present)
- [x] Complexity scan run — sizes reported, all under threshold; new logic is a pure 3-line resolver
- [x] Error handling scan run — `.then()` matches existing knex convention; thenable awaited via Promise.all; no empty catch on a critical path
- [x] Floating-promise / forEach(async) / Promise.all-partial scan run — no floating promise; Promise.all here wants all-or-nothing (a config-read failure SHOULD reject the whole GetConfig), so Promise.all (not allSettled) is correct
- [x] Error-cause-preservation scan run — no new catch-and-rethrow; no catch-returns-success-default introduced
- [x] Input validation scan run — no new public entry point; userId scoping unchanged
- [x] Unapproved-fallback scan run — every new `\|\|` read in context; all are intentional tz-resolution coalescing, none a silent data-field substitution; semantic divergence captured as W1
- [x] Numeric precision/boundary scan run — no numeric/money/index math in this diff
- [x] ReDoS scan run — no regex added
- [x] Date/TZ & DB-clock scan run — no hand-rolled date math; conversion delegates to existing `convertTimeForDisplay`; DB clock not involved (display-only)
- [x] Resource management scan run — no sync I/O, handles, or timers added
- [x] DB-transaction/atomicity scan run — `getUserTimezone` is a single read; no multi-write
- [x] Concurrency scan run — no shared mutable state; Promise.all index wiring verified correct
- [x] Idempotency-under-retry scan run — n/a (no queue/webhook consumer; pure read + display)
- [x] Grep matches triaged, not just counted — `.then()`, `\|\|`, Promise.all matches each READ in context before filing/clearing
- [x] Type safety scan run — null guards present at every new nullable read
- [x] React logic scan run — useMemo deps, useCallback setters, no new map/key issues
- [x] Observability scan run — no bare console.log added
- [x] Dead code scan run — no TODO/FIXME/commented blocks added
- [x] Flag-and-refer lines emitted — telly (test-coverage), bird (UX of unset-user behavior) referred
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed as ernie BLOCK (referred to telly); logic-testability noted
- [x] No security findings reviewed in depth (none applicable; nothing referred to elmo — no auth/injection surface in this diff)
- [x] Requirements Documentation Standards — R31.3 has a Happy path; this is display-only, contract documented in TIMEZONE-RULES.md
- [x] Prior knowledge consulted via Scooter — see `## Scooter Consult`; TZ-DISPLAY-1/2/3 + R31.3 + column default surfaced, no relitigation
- [x] Knowledge changes reported to Scooter — Scooter emitted an INBOX gap notice for the TZ-DISPLAY-3 divergence (W1)
- [x] Rubric Coverage Map emitted — all 9 dimensions below
- [x] Output file written with Proof-of-Work, Checklist, Findings, Sign-off
- [x] Status line set — DONE (no unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| W1 | WARN | juggler-frontend/src/utils/timezone.js:152-155 ; juggler-backend/.../KnexConfigRepository.js:144-152 | Unset-user fallback diverges from documented contract. `resolveDisplayTimezone` falls back to **browser** before NY, but **TZ-DISPLAY-3** (`TIMEZONE-RULES.md:50-51`) specifies `America/New_York` for the unset case. Compounding: `users.timezone` has a DB default of `'America/New_York'` (`20260301000000_initial_schema.js:13`, non-null in practice), so `getUserTimezone` returns `'America/New_York'` for "unset" prod users — the FE then pins NY and the browser-fallback branch is effectively dead for real rows. Net: the stated rationale ("non-NY unset users don't regress to NY") only holds for an explicitly-NULL timezone column, which the schema default prevents. Behavior is correct for the bug under repro (configured NY user). | Either (a) align the unset fallback to NY per TZ-DISPLAY-3 and drop the browser tier, OR (b) record a decision superseding TZ-DISPLAY-3 for the display path with rationale (Scooter INBOX gap notice already filed). Confirm whether any real user row can have NULL timezone; if not, the browser tier is dead code. NOT blocking — display is correct for configured users. |
| W2 | WARN | juggler-frontend/src/hooks/useConfig.js:174-180 | localStorage sync runs only inside `if (config.userTimezone !== undefined)`. If a future config payload omits `userTimezone` (older backend / partial cache), the stale `USER_TZ_KEY` from a prior session persists and the non-React readers keep a now-wrong configured tz. The set-vs-removeItem branch itself is correct (truthy → set; falsy incl. null/'' → remove). The gap is the surrounding `undefined`-guard, mirroring the pre-existing `timezoneOverride` pattern. | Low risk: GetConfig always emits the `userTimezone` key (null when unset), so it is never `undefined` from the current backend. Acceptable as-is for this leg. Note for future: clear on absence would be safer if the field could ever be dropped. No change required now. |
| I1 | INFO | juggler-frontend/src/hooks/useConfig.js:178 | Empty-string `userTimezone` ('') from a malformed row hits `else` → `removeItem`, correctly falling through to browser/NY. Confirms the truthy `\|\|` chain in `resolveDisplayTimezone` treats '' as "not set" — consistent and intended. | none |
| I2 | INFO | juggler-backend/.../GetConfig.js:115-118 | `userTimezone` is included in the cached `result` (1h TTL). A user changing `users.timezone` won't see the new display tz until cache key `user:<id>:config` invalidates (≤1h) — same staleness window as every other config field, not new to this diff. | REFER→telly (cache-invalidation-on-tz-change test if absent); not an ernie BLOCK |
| I3 | INFO | juggler-frontend/src/utils/__tests__/timezone.test.js | Regression test correctly encodes the bug (override-wins, configured-beats-browser, browser fallback, NY default, end-to-end 12:00 UTC → 8:00 AM). Whether the backend `getUserTimezone` + the `useConfig` localStorage-sync paths are independently covered is telly's call. | REFER→telly |
| I4 | INFO | unset-user display behavior (resolveDisplayTimezone) | Whether a brand-new (no-explicit-tz) user should see browser-local or NY times is a UX/product call surfaced by W1, not pure logic. | REFER→bird |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Resolution order (override→configured→browser→NY) matches TZ-DISPLAY-1/R31.3 for the bug path; Promise.all res[4] index verified ↔ getUserTimezone; override still wins (no regression) | W1: unset tier diverges from TZ-DISPLAY-3 + dead under DB default |
| Readability | covered | Pure resolver with explicit doc comment; intent comments at each sync site | — |
| Maintainability | covered | Single source of truth (`resolveDisplayTimezone`) reused by all 3 readers + hook; no duplicated ordering logic | — |
| Error Handling | covered | localStorage try/catch (UI-non-critical); thenable awaited via Promise.all; no swallowed critical error | — |
| Coupling | covered | Port method added symmetrically (Knex + InMemory + port + CONFIG_REPOSITORY_PORT_METHODS); FE readers depend on one util | — |
| Type Safety | covered | JS; null guards at every new nullable read (`row && row.timezone`, `tz ? tz : null`, `opts \|\| {}`, config `!== undefined`) | — |
| API Design | covered | `userTimezone` added top-level to GetConfig body, null when unset — explicit, not defaulted at backend (deliberate, per intent) | — |
| Resource Management | covered | No I/O, handles, or timers added | — |
| Concurrency Safety | covered | No shared mutable state; useMemo([]) for stable browser tz is sound | — |

## Sign-off
Signed: Ernie — 2026-06-22T00:00:00Z
