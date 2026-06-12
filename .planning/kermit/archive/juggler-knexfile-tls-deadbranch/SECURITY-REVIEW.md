# Security Review — juggler-backend/knexfile.js — chore — 2026-06-12

Leg: `juggler-knexfile-tls-deadbranch` (--ops lane, closes security WARN 999.436)
Depth: standard · Mode: chore (security-relevant config chore — full pass run, not skipped)

## Status: DONE

No unresolved BLOCK. 0 BLOCK, 0 WARN, 2 INFO. All four operator claims independently VERIFIED against the deploy manifest, terraform, env-key presence, and a before/after mysql2 behavior analysis. Removal does NOT worsen any live prod security posture.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode chore, --files juggler-backend/knexfile.js present | present |
| Scope detect | git diff main -- knexfile.js | 1 file, 1 hunk (−3/+1 lines) |
| Scanner pre-filter (Step 2.5) | gitleaks / semgrep / eslint OUTCOME | gitleaks=absent; semgrep=absent; eslint=ran(rc=0, only pre-existing `no-undef process` flat-config noise unrelated to diff); absent tools ⇒ A02 secret-grep is sole secret coverage (recorded) |
| Config load guard | `node -e require('./knexfile')` | prod keys [client,connection,pool,migrations]; connection well-formed; dev+test intact |
| Claim 1 — dead branch | Read deploy/juggler-backend.yaml:63-64 | CLOUD_SQL_CONNECTION_NAME set ⇒ prod takes socketPath branch (L45-52); TCP `else` (L53-62, where ssl lived) unreachable in prod. CONFIRMED |
| Claim 2 — DB_SSL never set | grep DB_SSL deploy/ terraform/ + env-key presence | DB_SSL absent everywhere except (a) this leg's own planning docs, (b) OTHER services' knexfiles. Never set for juggler ⇒ ternary always falsy ⇒ ssl was already `undefined`. CONFIRMED |
| Claim 3 — reverse footgun | before/after behavior analysis (mysql2 3.22.5) | Real but bounded — see INFO-1. Ruled INFO (latent operability footgun on a dead branch, not a live exposure) |
| Claim 4 — no worsened prod posture | socketPath branch unchanged in diff; rejectUnauthorized grep | Removed key was on the unreachable TCP branch; prod path (socketPath) byte-identical. `rejectUnauthorized` now 0 occurrences in juggler-backend. CONFIRMED — the unverified-TLS MITM token is the exposure that was closed |
| A01 scan | n/a — config file, no routes/handlers | 0 surface |
| A02 scan | weak hash / hardcoded secrets in knexfile | 0 — all creds via process.env (DB_USER/DB_PASSWORD from secretKeyRef in deploy) |
| A03 scan | injection / eval / concat | 0 — no query construction in this file |
| A04 scan | rate limit / validation | n/a — config file |
| A05 scan | CORS / stack-trace / CSRF | n/a — config file |
| A06 scan | npm audit (deps untouched by diff) | 2 moderate, 0 critical/high — pre-existing, not introduced by this diff |
| A07 scan | jwt / bcrypt / session | n/a — config file |
| A08 scan | deserialize / CI-CD | 0 |
| A09 scan | secrets/PII in logs | 0 — no log sinks in knexfile |
| A10 scan | SSRF (fetch(req.) | 0 |
| Frontend scan | n/a — backend config file | skipped |
| Threat intel | TLS posture reasoned from diff (narrow single-file config chore, no new deps) | WebSearch omitted per standard-depth narrow-scope rule |
| Refer-ins | CODE-REVIEW.md / ARCH-REVIEW.md (from OTHER legs) | scanned; REFER→elmo lines explicitly "none triggered / security none observed" — 0 incorporated |
| Output written | Write SECURITY-REVIEW.md + elmo-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode chore, --files juggler-backend/knexfile.js)
- [x] Scope confirmed — 1 file in scope
- [x] Mode-appropriate checks run: chore (security-relevant config chore) — TLS/MITM posture analysis + dead-branch reachability proof + before/after behavior diff; full OWASP sweep run (config file → most categories no-surface)
- [x] All OWASP A01–A10 categories scanned
- [x] Frontend/React security scan complete (n/a — backend config file)
- [x] Authz checked — n/a, no routes in a knexfile
- [x] BOLA/IDOR ownership-trace — n/a (no object-scoped endpoints)
- [x] BFLA / vertical authz checked — n/a
- [x] Mass-assignment / over-posting checked — n/a
- [x] Cross-product/tenant authz checked — n/a
- [x] CSRF check run — n/a (no routes)
- [x] JWT algorithm pinning verified — n/a (no jwt.verify in scope)
- [x] Prototype-pollution checked — n/a
- [x] Path-traversal/zip-slip + file-upload limits checked — n/a
- [x] Secrets scan complete — 0 hardcoded credentials; all via process.env / secretKeyRef
- [x] Secrets/PII-in-logs scan complete — no log sinks in file
- [x] Supply-chain depth checked — deps untouched by diff; npm audit 0 critical/high (2 moderate pre-existing)
- [x] Threat model — narrow single-file config chore, no new deps; TLS posture reasoned from before/after (WebSearch omitted per narrow-scope standard-depth rule)
- [x] npm audit run — 0 critical/high, 2 moderate (pre-existing)
- [x] Refer-ins from ernie/cookie incorporated (0 — sibling reviews are other legs; their REFER→elmo lines are "none triggered")
- [x] Security-regression tests referred to telly — n/a (0 BLOCK; telly already owns config-load guard per WBS)
- [x] Grep matches triaged, not just counted — every DB_SSL / CLOUD_SQL / rejectUnauthorized hit READ + reasoned (distinguished this-leg planning docs and other-service knexfiles from juggler runtime config)
- [x] Findings carry file:line + severity + risk annotation
- [x] Flag-and-refer lines emitted (1 INFO observation referred to ops/Kermit — see INFO-2)
- [x] Prior knowledge consulted — settled human decision recorded in WBS (2026-06-12: REMOVE the ternary); not relitigated
- [x] Rubric Coverage Map emitted
- [x] Output file written with Proof-of-Work table
- [x] Status line set DONE

## Findings
| # | Severity | OWASP | File:Line | Description | Required Fix |
|---|----------|-------|-----------|-------------|--------------|
| 1 | INFO | A02 | juggler-backend/knexfile.js:53-62 | **Reverse footgun (latent, dead branch):** after removal, the production TCP-fallback branch has NO `ssl` key. A future operator who sets `DB_SSL=true` expecting TLS gets plaintext silently (the var is now inert). This is strictly an operability/expectations footgun, NOT a live exposure: (a) the TCP branch is unreachable in prod (socketPath via CLOUD_SQL_CONNECTION_NAME); (b) the prior `DB_SSL=true` path gave only `rejectUnauthorized:false` = encryption-without-server-authentication = MITM-able, so it was never a real control. Removal does not delete a meaningful protection. risk: low (dead branch + unset/undocumented var). | Acceptable as-is for the WARN closure. RECOMMENDED (not required): a one-line comment on the TCP branch, e.g. `// Cloud SQL prod uses socketPath; this TCP branch is local/non-GCP only and does NOT configure TLS — set ssl: { rejectUnauthorized: true, ca: … } if ever used over an untrusted network`. The correct pattern already exists in auth-service/auth-backend/knexfile.js:80 (`rejectUnauthorized: true` + `DB_SSL_CA`) and can be copied if the TCP path ever becomes load-bearing. |
| 2 | INFO | A02 | (other services) | **Cross-service observation (refer→ops/Kermit, out of this leg's scope):** payment-backend/knexfile.js:79, bug-reporter-backend/knexfile.js:79, and resume-optimizer-backend/knexfile.js:89 STILL carry the original insecure `ssl: DB_SSL==='true' ? { rejectUnauthorized:false } : undefined` pattern. auth-backend:80 already uses the secure `rejectUnauthorized:true`+CA pattern. The same MITM-exposure rationale behind WARN 999.436 likely applies to those three services. | Out of scope for this juggler-only leg. Recommend a follow-up backlog item to apply the same removal/hardening to payment, bug-reporter, and resume-optimizer knexfiles. REFER→ops / Kermit. |

### Verdict on the four operator claims
1. **DEAD-BRANCH** — CONFIRMED. `deploy/juggler-backend.yaml:63` sets `CLOUD_SQL_CONNECTION_NAME`; prod evaluates the socketPath branch (knexfile.js:45-52). The TCP `else` (L53-62) where `ssl` lived is never reached in prod.
2. **DB_SSL never set** — CONFIRMED. Absent from deploy/, terraform/, and the juggler env-key set. The only `DB_SSL` hits for juggler are this leg's own planning docs; other hits are unrelated sibling services. Ternary was always falsy → `ssl` was already `undefined` even on the TCP path.
3. **REVERSE FOOTGUN** — REAL but INFO (not BLOCK/WARN). A latent operability footgun on an unreachable branch with an unset/undocumented var, and the "protection" it removes (`rejectUnauthorized:false`) was never a real security control. Acceptable for the removal; a clarifying comment is recommended, not required.
4. **Original `rejectUnauthorized:false` was the MITM exposure** — CONFIRMED, and removal does NOT worsen live prod posture: the prod path is socketPath (unaffected, byte-identical in the diff), and `rejectUnauthorized` now appears 0 times in juggler-backend.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Input Validation | covered | No user input handled in a knexfile | n/a surface |
| Authentication | covered | No auth logic in scope; DB creds via process.env/secretKeyRef | n/a surface |
| Authorization | covered | No routes/handlers in a config file | n/a surface |
| Data Protection | covered | DB-in-transit posture is the whole subject — prod uses Cloud SQL socketPath (Unix socket, GCP-internal); removed branch was unreachable & gave only unverified TLS | INFO-1 |
| Dependencies | covered | npm audit 0 critical/high (2 moderate pre-existing); deps untouched by diff | A06 |
| Exposure Surface | covered | Single-line removal narrows surface (drops the unverified-TLS code path) | — |
| Session Security | covered | n/a — no sessions/cookies in scope | n/a surface |
| Audit Trail | covered | n/a — no log sinks in knexfile | n/a surface |
| Infrastructure Security | partial | prod DB via Cloud SQL socketPath confirmed from deploy manifest + terraform DB_HOST=/cloudsql/…; full Cloud SQL TLS-at-rest config not in scope of this file | acceptable for chore |
| Secrets Management | covered | 0 hardcoded secrets; DB_USER/DB_PASSWORD from secretKeyRef (deploy/juggler-backend.yaml:67-76); grey-box boundary respected (env-key presence only, no real values read) | A02 |

## Sign-off
Signed: Elmo — 2026-06-12T00:00:00Z
