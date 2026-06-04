# Security Review — jwt-auth.js first-login provisioning — 2026-06-02

## Executive Summary

The first-login provisioning change is architecturally sound. The user data written to the local DB comes exclusively from a cryptographically verified RS256 JWT (auth-service JWKS-signed), not from request body or query params. Two low-severity hardening items noted; no Critical or High findings.

## Critical Findings (exploitable now)

_None._

## High Findings (exploitable with effort)

_None._

## Medium Findings (defense in depth)

| # | OWASP | Finding | File:Line | Remediation |
|---|-------|---------|-----------|-------------|
| M1 | A07 | `provisioned` row could be `undefined` if the insert raced and the follow-up fetch by `id` returns no row (e.g., the winning concurrent insert used a different auth-service ID for the same email). The code then spreads `undefined` into `req.user`, silently stripping all user context and letting the request continue as a phantom user. | jwt-auth.js:44–45 | After the fetch, assert `provisioned` is truthy; if null, return `next(new Error('User provision failed'))` rather than spreading `undefined`. |

## Low Findings (hardening)

| # | OWASP | Finding | File:Line | Remediation |
|---|-------|---------|-----------|-------------|
| L1 | A03 | `req.user.name` and `req.user.picture` come from JWT claims, which are auth-service-validated. However, `name` is inserted directly into varchar(255) with no length guard. An auth-service bug or compromised issuer could produce an oversized name claim that truncates silently on MySQL (strict mode off) or throws on strict mode. | jwt-auth.js:36 | Slice `name` to 255 chars and `picture` to 500 chars before insert, matching column definitions. |
| L2 | A09 | On successful first-login provisioning, no info-level log is emitted. Audit trail for new-user creation is missing; only the race-condition WARN path is logged. | jwt-auth.js:30–45 | Add `logger.info('jwt-auth: provisioned new user on first login', { id: newId, email: req.user.email })` after the insert succeeds. |

## Status: PASS

All trust boundaries are correct — data origin is the auth-service RS256 JWT, not user-supplied input. M1 is a correctness concern (undefined spread) that the caller (Oscar) should evaluate for promotion to a blocking finding. L1 and L2 are hardening items.

_Signed: Elmo — 2026-06-02T00:00:00Z_
