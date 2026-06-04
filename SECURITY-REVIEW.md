# Security Review — juggler-backend/src/middleware/jwt-auth.js — 2026-06-02

## Executive Summary

The jwt-auth middleware correctly delegates signature verification to `auth-client` (RS256 via JWKS), performs a Redis session-active check, and provisions local users on first login. No exploitable vulnerabilities found. Two low-severity hardening observations noted.

## Critical Findings (exploitable now)

_None._

## High Findings (exploitable with effort)

_None._

## Medium Findings (defense in depth)

_None._

## Low Findings (hardening)

| # | OWASP | Finding | File:Line | Remediation |
|---|-------|---------|-----------|-------------|
| L1 | A05 | `req.user.picture` is never set by auth-client (`req.user = { id, email, name }`), so `picture_url` is always written as `null` on first-login provisioning. Not a security issue, but silent data loss if a `picture` claim is ever added to the JWT. | jwt-auth.js:37 | Source `picture` from `req.auth` payload fields if/when auth-service emits it, or remove the field from the insert until it is supported. |
| L2 | A09 | The `User provision failed` error passed to `next()` (line 45) is a plain `new Error(...)` with no error code. If the Express error handler forwards it to the client it may leak internal state terminology. | jwt-auth.js:45 | Assign a stable error code (`err.code = 'USER_PROVISION_FAILED'; err.status = 500;`) so the global handler can sanitize response body. |

## Status: PASS

_Signed: Elmo — 2026-06-02T00:00:00Z_
