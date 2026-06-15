# NFR — Juggler — Non-Functional Requirements

**Status:** PROPOSED (2026-06-08) — launch-readiness defaults, not yet serving real users.
> NOTE: juggler is a git submodule — this file lives in the submodule repo.
**Service:** juggler · **Owner:** TODO (assign) · **Last updated:** 2026-06-15 · **Reviewed by:** — · **Next review:** at first milestone with real traffic
**Context:** Task & calendar management. Exposes an MCP server (`juggler-mcp` → external ClimbRS client). Scheduling engine (most-constrained-first) + multi-provider calendar sync (GCal/MSFT/Apple). **Scheduler bugs cascade and corrupt all task data** — correctness + sync reliability dominate. Scheduler rules in `scheduler-rules` / `calendar-rules` skills. Authored against `BASE-NFR-STANDARD §3`.

---

## 1. Performance Efficiency

- **Schedule run:** < 10 s p95 (delta writes only — never full rebuild).
- **Calendar sync:** < 30 s p95 per provider.
- **MCP tool-call:** p95 < 500 ms.
- **Frontend Core Web Vitals:** LCP < 2.5 s · INP < 200 ms · CLS < 0.1.
- **API rate limit:** 1000 requests/minute per authenticated user; 100 requests/minute per IP unauthenticated. Headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **Batch operations:** batch create (≤500 tasks) completes within 30 s p95; batch update (≤2000 tasks) completes within 60 s p95.
- **Data import/replace:** < 60 s for 10k-task dataset; merge mode < 90 s for same.

### Detailed targets
| Attribute | Target | Condition | Measurement | Fitness function | Degradation |
|-----------|--------|-----------|-------------|------------------|-------------|
| Schedule run | p95 < 10 s | ≤10k tasks/user | scheduler timing | perf test at 10k tasks | partial schedule never persisted; fail loud |
| Calendar sync | p95 < 30 s | per provider | sync job timing | soak test per provider | serve local cache; queue sync; backoff |
| MCP tool-call | p95 < 500 ms | per call | MCP server metric | k6 against MCP | error to client; no partial state |
| Batch create | p95 < 30 s | ≤500 tasks | batch endpoint timing | load test | reject oversized batch; partial success not supported |
| Batch update | p95 < 60 s | ≤2000 tasks | batch endpoint timing | load test | reject oversized batch |
| Data import (replace) | < 60 s | ≤10k tasks | import endpoint timing | load test | 408 on timeout; no partial write |
| Data import (merge) | < 90 s | ≤10k tasks | import endpoint timing | load test | 408 on timeout; no partial write |
| AI command rate limit | 2 req/min per user; 50/day quota | per user | rate-limit middleware | quota exhaustion test | 429 with human-readable error |
| Scheduler run rate limit | 10/min per user | per user | scheduleQueue debounce | trigger-storm test | debounce to 1 run per 2s window |

---

## 2. Security

- **AuthN:** validate JWT on every route (except health/immediate, health/full, OAuth callbacks).
- **MCP authZ:** client tokens scoped to **least privilege**; per-client authorization; an MCP client cannot read another user's tasks.
- **Plan/feature enforcement:** feature gates, entity limits, and usage limits are enforced at the middleware layer before any business logic runs. Downgrade enforcement disables excess items — no data loss, but items become inaccessible until the user upgrades or manually deletes.
- **PII:** calendar + task data (titles, notes, attendees, times) encrypted at rest.
- **External provider tokens** (GCal/MSFT/Apple OAuth): stored encrypted; refreshed safely; never logged.
- **Secrets:** in GCP Secret Manager.
- **Transport:** TLS 1.2+.
- **Admin impersonation:** admin-only (authenticateAdmin middleware); all impersonation events are audit-logged; impersonation banner is visible to the impersonating admin.
- **Service-to-service auth:** feature-catalog and billing-webhook endpoints use `authenticateServiceKey` (service-key authentication), not user JWTs.
- **Fallbacks:** none unapproved — sync conflicts **fail loud**, no silent overwrite. Approved UI null-guards documented in `juggler/CLAUDE.md`.

### Detailed targets
| Attribute | Target | Measurement | Fitness function | Degradation |
|-----------|--------|-------------|------------------|-------------|
| MCP per-client scope | enforced | code (elmo) | test: client A cannot read client B tasks | fail closed |
| Provider OAuth tokens | encrypted, not logged | code + storage | test: token redacted in logs | — |
| Sync conflict | fail loud, no silent overwrite | code | test: conflicting edit surfaces, never overwrites | surface conflict to user |
| Feature gate enforcement | middleware-level, before business logic | code | test: free-tier user blocked from pro endpoint | 403 with upgrade message |
| Entity limit enforcement | checked on create + re-enable | code | test: create beyond limit returns 403 | 403 with limit message |
| Impersonation audit | all events logged with admin ID + target ID + timestamp | code | test: log entry created on impersonation start | — |
| Service-key auth | endpoints requiring service key reject user JWTs | code | test: user JWT rejected on service-key endpoint | 401 |

---

## 3. Reliability / Availability

- **Uptime SLO:** 99.5% (error budget ≈ 3.6 h/month).
- **Scheduler correctness invariant:** recurring instances scheduled on the **same day** the rule fires; severity hierarchy deadlines > dependencies > preferences; no cascading scheduler calls; delta writes only. A scheduler change ships only with exhaustive tests (data-corruption risk).
- **Sync reliability:** known issues — DB contention on simultaneous syncs, split-task-part sync; multi-provider MISS_THRESHOLD interference (tracked). Idempotent sync; `miss_count` guards against repush loops.
- **Plan downgrade reliability:** downgrade never deletes user data — excess items are disabled (soft-delete), recoverable on upgrade.
- **Data import atomicity:** replace mode wipes and replaces in a transaction; merge mode applies changes atomically per-entity group. No partial writes on failure.
- **RPO:** 24 h · **RTO:** 4 h.

### Degradation matrix
| Dependency | When down | Behavior |
|------------|-----------|----------|
| External calendar (GCal/MSFT/Apple) | unavailable | serve from local cache; queue sync; retry with backoff; never drop a local change |
| Cloud SQL | down | 503; no schedule write; alert |
| MCP client (ClimbRS) | n/a | MCP server degrades independently; task UI unaffected |
| Payment service (entitlement checks) | unavailable | serve last-known plan features (cached); stale cache ≤5 min; fail-open (allow access) on cache miss to avoid locking users out |
| Weather API | unavailable | fail-closed: weather-constrained tasks not placed (flagged `_unplacedReason='weather_unavailable'`); weather badges show "unavailable"; non-weather-constrained tasks unaffected |

---

## 4. Scalability / Capacity

- **Tasks/events per user:** up to ~10,000.
- **Concurrent schedule runs:** 100.
- **Statelessness:** scheduler triggered by user/MCP mutations only — never self-triggers; stateless handlers.
- **Batch limits:** batch create ≤500 tasks/request; batch update ≤2000 tasks/request; rate-limited per user.
- **Entity limits (plan-dependent):**
  - `limits.active_tasks`: Free 50 / Pro 500 / Premium 2000 / Enterprise 10000
  - `limits.recurring_templates`: Free 5 / Pro 50 / Premium 200 / Enterprise 500
  - `limits.projects`: Free 5 / Pro 50 / Premium 200 / Enterprise unlimited
  - `limits.locations`: Free 3 / Pro 20 / Premium 100 / Enterprise unlimited
  - `limits.schedule_templates`: Free 1 / Pro 10 / Premium 50 / Enterprise unlimited
- **Growth headroom:** ~10×; **first bottleneck:** scheduler runtime at high task counts (most-constrained-first sort) and DB contention on simultaneous calendar syncs (known issue).

---

## 5. Accessibility

- **Conformance:** WCAG **2.2 AA**.
- **AT support:** keyboard navigation + screen-reader support for calendar + task UI; drag-and-drop has a keyboard-accessible alternative (WCAG 2.5.7 dragging-movements); `prefers-reduced-motion` respected.
- **Branding:** brand guide + design system.
- **Fitness function:** axe-core in CI + manual keyboard/SR pass on calendar + task flows per release.

---

## 6. Maintainability

- **Test coverage:** changed-line branch ≥ 50%; **scheduler changes require exhaustive tests** (state matrix `TASK-STATE-MATRIX.md`, recurrence, split, chains) — elevated bar; sync paths have soak tests.
- **Complexity:** cyclomatic ≤ 10; scheduler entry `unifiedScheduleV2.js`.
- **Doc currency:** `SCHEDULER.md`, `TASK-PROPERTIES.md`, `TASK-STATE-MATRIX.md`, soak-test docs kept current.
- **Feature-gate documentation:** all feature flags and entity limits must be documented in the feature catalog (`feature-catalog.controller.js` CATALOG) and reflected in REQUIREMENTS.md.

---

## 7. Observability

- **Logging:** structured; per-schedule-run + per-sync correlation id; no PII (task titles/notes) in logs.
- **Metrics:** schedule-run duration; sync success/failure per provider; MCP call RED; repush-loop / MISS_THRESHOLD counters; feature-gate denials per feature key; entity-limit rejections; batch operation duration/counts.
- **Tracing:** propagate ids across juggler ↔ auth ↔ MCP.
- **Alerting:** schedule-run failure; sync failure rate per provider; duplicate-active-row anomaly; scheduler data-corruption guard; plan-entitlement cache staleness; batch operation timeout.
- **Dashboards:** scheduler + sync health (TODO link); plan-gating denials dashboard (TODO).

---

## 8. Compliance / Data Governance

- **PII inventory:** task titles/notes/urls, calendar event data, attendee info, provider OAuth tokens.
- **Retention:** account-lifetime; deleted tasks purged per policy.
- **Deletion / export:** `export_data` MCP tool exists (R22); GDPR erasure cascades to tasks/events/sync rows/provider tokens (revoke OAuth on deletion).
- **Data portability:** full data export (R22) supports GDPR Art. 20 right to data portability in machine-readable JSON format. Import supports migration between accounts.
- **Residency:** GCP region per deploy config.
- **Regime:** GDPR-style.

---

## Assumptions & open questions
1. Open sync bugs (multi-provider MISS_THRESHOLD interference #4, concurrent-sync duplicate rows #5, Apple B2/B3/B4/C-section) are tracked and unresolved — availability target assumes these are fixed.
2. DB contention on simultaneous syncs is a known scalability limiter.
3. Owner unassigned; SLO dashboard TODO.
4. Batch operation performance targets are estimates — need load testing to validate at scale.
5. Payment-service failover behavior (fail-open on cache miss) needs explicit user consent review before serving real users.

---
_Verified against BASE-NFR-STANDARD §3 and BASE-DOCUMENTATION-RUBRIC §0._