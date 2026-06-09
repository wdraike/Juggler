# NFR — Juggler — Non-Functional Requirements

**Status:** PROPOSED (2026-06-08) — launch-readiness defaults, not yet serving real users.
> NOTE: juggler is a git submodule — this file lives in the submodule repo.
**Service:** juggler · **Owner:** TODO (assign) · **Last updated:** 2026-06-09 · **Reviewed by:** — · **Next review:** at first milestone with real traffic
**Context:** Task & calendar management. Exposes an MCP server (`juggler-mcp` → external ClimbRS client). Scheduling engine (most-constrained-first) + multi-provider calendar sync (GCal/MSFT/Apple). **Scheduler bugs cascade and corrupt all task data** — correctness + sync reliability dominate. Scheduler rules in `scheduler-rules` / `calendar-rules` skills. Authored against `BASE-NFR-STANDARD §3`.

---

## 1. Performance Efficiency

- **Schedule run:** < 10 s p95 (delta writes only — never full rebuild).
- **Calendar sync:** < 30 s p95 per provider.
- **MCP tool-call:** p95 < 500 ms.
- **Frontend Core Web Vitals:** LCP < 2.5 s · INP < 200 ms · CLS < 0.1.

### Detailed targets
| Attribute | Target | Condition | Measurement | Fitness function | Degradation |
|-----------|--------|-----------|-------------|------------------|-------------|
| Schedule run | p95 < 10 s | ≤10k tasks/user | scheduler timing | perf test at 10k tasks | partial schedule never persisted; fail loud |
| Calendar sync | p95 < 30 s | per provider | sync job timing | soak test per provider | serve local cache; queue sync; backoff |
| MCP tool-call | p95 < 500 ms | per call | MCP server metric | k6 against MCP | error to client; no partial state |

---

## 2. Security

- **AuthN:** validate JWT on every route.
- **MCP authZ:** client tokens scoped to **least privilege**; per-client authorization; an MCP client cannot read another user's tasks.
- **PII:** calendar + task data (titles, notes, attendees, times) encrypted at rest.
- **External provider tokens** (GCal/MSFT/Apple OAuth): stored encrypted; refreshed safely; never logged.
- **Secrets:** in GCP Secret Manager.
- **Transport:** TLS 1.2+.
- **Fallbacks:** none unapproved — sync conflicts **fail loud**, no silent overwrite. Approved UI null-guards documented in `juggler/CLAUDE.md`.

### Detailed targets
| Attribute | Target | Measurement | Fitness function | Degradation |
|-----------|--------|-------------|------------------|-------------|
| MCP per-client scope | enforced | code (elmo) | test: client A cannot read client B tasks | fail closed |
| Provider OAuth tokens | encrypted, not logged | code + storage | test: token redacted in logs | — |
| Sync conflict | fail loud, no silent overwrite | code | test: conflicting edit surfaces, never overwrites | surface conflict to user |

---

## 3. Reliability / Availability

- **Uptime SLO:** 99.5% (error budget ≈ 3.6 h/month).
- **Scheduler correctness invariant:** recurring instances scheduled on the **same day** the rule fires; severity hierarchy deadlines > dependencies > preferences; no cascading scheduler calls; delta writes only. A scheduler change ships only with exhaustive tests (data-corruption risk).
- **Sync reliability:** known issues — DB contention on simultaneous syncs, split-task-part sync; multi-provider MISS_THRESHOLD interference (tracked). Idempotent sync; `miss_count` guards against repush loops.
- **RPO:** 24 h · **RTO:** 4 h.

### Degradation matrix
| Dependency | When down | Behavior |
|------------|-----------|----------|
| External calendar (GCal/MSFT/Apple) | unavailable | serve from local cache; queue sync; retry with backoff; never drop a local change |
| Cloud SQL | down | 503; no schedule write; alert |
| MCP client (ClimbRS) | n/a | MCP server degrades independently; task UI unaffected |

---

## 4. Scalability / Capacity

- **Tasks/events per user:** up to ~10,000.
- **Concurrent schedule runs:** 100.
- **Statelessness:** scheduler triggered by user/MCP mutations only — never self-triggers; stateless handlers.
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

---

## 7. Observability

- **Logging:** structured; per-schedule-run + per-sync correlation id; no PII (task titles/notes) in logs.
- **Metrics:** schedule-run duration; sync success/failure per provider; MCP call RED; repush-loop / MISS_THRESHOLD counters.
- **Tracing:** propagate ids across juggler ↔ auth ↔ MCP.
- **Alerting:** schedule-run failure; sync failure rate per provider; duplicate-active-row anomaly; scheduler data-corruption guard.
- **Dashboards:** scheduler + sync health (TODO link).

---

## 8. Compliance / Data Governance

- **PII inventory:** task titles/notes/urls, calendar event data, attendee info, provider OAuth tokens.
- **Retention:** account-lifetime; deleted tasks purged per policy.
- **Deletion / export:** `export_data` MCP tool exists; GDPR erasure cascades to tasks/events/sync rows/provider tokens (revoke OAuth on deletion).
- **Residency:** GCP region per deploy config.
- **Regime:** GDPR-style.

---

## Assumptions & open questions
1. Open sync bugs (multi-provider MISS_THRESHOLD interference #4, concurrent-sync duplicate rows #5, Apple B2/B3/B4/C-section) are tracked and unresolved — availability target assumes these are fixed.
2. DB contention on simultaneous syncs is a known scalability limiter.
3. Owner unassigned; SLO dashboard TODO.

---
_Verified against BASE-NFR-STANDARD §3 and BASE-DOCUMENTATION-RUBRIC §0._
