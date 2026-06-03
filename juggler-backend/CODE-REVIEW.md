# Code Review — jwt-auth.js first-login provisioning — 2026-06-02

## Summary

Three issues before merge: one correctness bug (undefined spread after a concurrent-insert race), one unapproved fallback (CLAUDE.md policy violation), and missing regression test for the provisioning path. The fix itself is architecturally correct — the rest of the file is clean.

## Critical Findings (must fix before merge)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| C1 | **Undefined spread after race**: If `db('users').where('id', newId).first()` on line 44 returns `undefined` (possible if two auth-service IDs exist for the same email and the winning insert used a different id), `req.user` becomes `{ authServiceId: newId }` with all fields stripped — no `id`, no `email`. Every downstream `req.user.id` reference gets `undefined`, silently corrupting task ownership, rate-key generation, and SSE registration. | jwt-auth.js:44–45 | Assert `provisioned` is truthy. If null/undefined, call `next(new Error('User provision failed — row missing after insert'))` instead of spreading. |
| C2 | **Unapproved fallback — CLAUDE.md violation**: `name: req.user.name \|\| req.user.email` (line 36) silently substitutes a fallback when `name` is absent. Per CLAUDE.md "No Unapproved Fallbacks", every `\|\|`/`??` fallback must be listed in CLAUDE.md Approved Fallbacks with reason and approval. This one is absent from that table. | jwt-auth.js:36 | Either (a) get approval and add entry to CLAUDE.md Approved Fallbacks, or (b) insert `null` for a missing name (column allows null per migration). |

## Warning Findings (fix this sprint)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| W1 | **No regression test for first-login provisioning**: The E2E cross-user isolation tests incidentally exercise "User B has no local DB row", but assert only task 404s — not that User B is provisioned or that `/api/auth/me` returns 200 for a brand-new user. Without this test, the fixed bug could silently regress. | tests/api-e2e/auth-and-validation-e2e.test.js | Add a test: mint a JWT with a novel email, call `GET /api/auth/me`, assert 200 + user row in DB, call again and assert idempotency. |
| W2 | **No audit log on successful provision**: The race-condition WARN path is logged (line 42) but successful first-login provision emits nothing. Auth user-creation is a security-relevant event that should be observable. | jwt-auth.js:30–45 | Add `logger.info('jwt-auth: provisioned new local user on first login', { id: newId, email: req.user.email })` after successful insert. |

## Info / Suggestions

| # | Finding | File:Line | Suggestion |
|---|---------|-----------|------------|
| I1 | The inner `try/catch` for the duplicate-key guard (lines 32–43) inside the outer `try/catch` (line 25) creates two levels of catch for a single operation. Correctness is fine, but extracting a `provisionUser(id, email, name, picture)` helper would flatten the nesting and make the flow easier to follow. | jwt-auth.js:29–46 | Low priority. |

## Checklist Status

- [x] Complexity — PASS (99 lines, nesting acceptable)
- [ ] Error handling — FAIL (C1: undefined spread on race)
- [ ] Test coverage — WARN (W1: no regression test for new path)
- [x] Observability — PASS (error logged; W2 is minor audit gap)
- [x] Scalability — PASS (no N+1, no loops)
- [x] API design — PASS (middleware only, no route changes)
- [ ] Fallback policy — FAIL (C2: unapproved || fallback)

## Status: ISSUES

_Signed: Ernie — 2026-06-02T00:00:00Z_
