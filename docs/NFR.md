# NFR — Juggler — Non-Functional Requirements

> **PROPOSED (2026-06-08)** — launch-readiness defaults, not yet serving real users. Review and adjust. Consumed by cookie / elmo / telly / bird per leg.
> NOTE: juggler is a git submodule — this file lives in the submodule repo.

**Service:** juggler · **Owner:** TODO · **Last updated:** 2026-06-08 (proposed)
**Context:** Task & calendar management. Exposes an MCP server (juggler-mcp → external ClimbRS client). Scheduling engine + calendar sync.

## Performance targets
- Schedule run: < 10 s p95
- Calendar sync: < 30 s p95
- MCP tool-call p95: < 500 ms
- Frontend: LCP < 2.5 s · INP < 200 ms

## Security requirements
- AuthN/AuthZ: validate JWT on every route
- MCP: client tokens scoped to least privilege; per-client authorization
- PII: calendar + task data encrypted at rest
- Secrets: in GCP Secret Manager
- Transport: TLS 1.2+
- Fallbacks: none unapproved — sync conflicts fail loud, no silent overwrite

## Accessibility targets
- WCAG 2.1 AA
- Keyboard navigation + screen-reader support for calendar + task UI
- Branding conformance: brand guide + design system

## Scale / capacity targets
- Tasks/events per user: up to ~10,000
- Concurrent schedule runs: 100

## Availability / SLO
- Uptime SLO: 99.5%
- External calendar unavailable: serve from local cache, queue sync, retry with backoff
- RPO 24 h · RTO 4 h

---
_Verified against BASE-DOCUMENTATION-RUBRIC §0 (NFR.md required sections)._
