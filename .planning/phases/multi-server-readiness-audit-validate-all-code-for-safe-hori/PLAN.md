---
phase: multi-server-readiness-audit-validate-all-code-for-safe-hori
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: false
requirements: [multi-server-readiness-audit-validate-all-code-for-safe-hori]
must_haves:
  truths:
    - "TODO: Define acceptance criteria"
  artifacts: []
key_links:
  - from: "ROADMAP.md ## Backlog"
    to: "JUG-HIGH-04 <a id="multi-server-config-audit"></a>"
    why: "Source backlog item"
---

# Multi-server readiness audit — validate all code for safe horizontal scaling

**Goal:** Multi-server readiness audit — validate all code for safe horizontal scaling

**Source:** JUG-HIGH-04 (origin: removed per-service BACKLOG.md; backlog now in .planning/ROADMAP.md ## Backlog) <a id="multi-server-config-audit"></a>

**Last-touched:** 2026-05-12

**Blocker:** Audit entire backend for patterns that break under multiple Cloud Run instances. Full audit scope: (1) SSE/real-time — identify all SSE or WebSocket fan-out; confirm no in-process-only subscriber maps (same issue pattern as resume-optimizer); design Pub/Sub or sticky-session path if found. (2) Scheduler state — `unifiedScheduleV2.js` and `scheduleQueue.js`; confirm event queue deduplication is DB-backed not in-memory; no in-process timers driving schedule runs. (3) Calendar sync — concurrent-sync duplicate-active-row bug (Apple, known) may worsen under multi-instance; audit lock strategy for sync ingest across all providers (GCal, MSFT, Apple). (4) In-memory caches/singletons — AI enrichment cache, rate limiters, MCP connection state; identify what must be shared. (5) Job queues — confirm `QUEUE_DRIVER` routes all async work through Cloud Tasks; no in-process fallback queues. (6) Filesystem — temp file writes, attachment staging; Cloud Run containers don't share disk. (7) Process-level locks — `setInterval`, `setTimeout`, in-memory mutex patterns that assume single process. Output: findings doc listing each risk with severity (breaks silently / breaks loudly / safe) + recommended fix per item before any scale-out.

---

## Tasks

### Task 1: Investigate scope
- Review source file: (user-reported 2026-05-12)
- Define detailed requirements
- Output: scope document

---

## Acceptance Criteria

TODO: Define acceptance criteria
