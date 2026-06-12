# Security Review — sibling-knexfile-tls-deadbranch (payment + bug-reporter) — chore — 2026-06-12

## Status: DONE

Scope: removal of the dead `ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined`
key from the **production TCP host/port fallback** branch of two sibling services' `knexfile.js`.
This is the EXACT change ruled PASS on juggler in leg 999.436. Re-verified independently per service.
Closes 999.440. Depth: standard.

Files in scope (2):
- `payment-service/payment-backend/knexfile.js` (production.connection TCP-fallback branch)
- `bug-reporter-service/bug-reporter-backend/knexfile.js` (production.connection TCP-fallback branch)

Out of scope but noted: `bug-reporter-backend/package.json` adds `@raike/lib-db` (`file:../../packages/lib-db`,
local workspace path that exists on disk — not a registry fetch). Not part of the reviewed knexfile change;
INFO only (see Finding 3).

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode chore, --files (2 knexfiles) present | present |
| Scope detect | git diff per submodule | 2 files (knexfile ×2); 1 incidental package.json |
| **Scanner pre-filter (Step 2.5)** | gitleaks / semgrep availability + grep fallback | gitleaks=**absent**, semgrep=**absent**, eslint=not-run (config-only files, no JS/TS logic) → **grep-only coverage** (recorded). Diff is a 3-line deletion of a config key — no SAST surface. |
| Dead-branch verify | Read deploy/payment-backend.yaml + deploy/bug-reporter-backend.yaml | payment L31-32 + bug-reporter L41-42 set `CLOUD_SQL_CONNECTION_NAME`; both L21/L17 carry `run.googleapis.com/cloudsql-instances` annotation → prod takes **socketPath** branch; the edited TCP `else` branch is **unreachable in prod** |
| DB_SSL absence | `grep -rn DB_SSL deploy/ terraform/` + both submodule backends | rc=1 (**zero hits** in any live config) → ternary was always `undefined`; removal is behavior-preserving |
| DB_HOST absence | `grep DB_HOST deploy/{payment,bug-reporter}-backend.yaml` | rc=1 (unset) → even if socketPath weren't taken, TCP branch has no host |
| Config-load integrity | `node -e require('./knexfile')` per service (CLOUD_SQL_CONNECTION_NAME set) | both load; production.connection well-formed; keys = socketPath,user,password,database,charset,timezone,dateStrings; `'ssl' in p` = **false** |
| Diff scope | `git diff -U0` per knexfile | only the `dateStrings,`→`dateStrings` + 3 ssl lines changed; dev/test/socketPath blocks **byte-identical** |
| Residual token | `grep rejectUnauthorized` + `grep ssl` both backends | **0** `rejectUnauthorized`; **0** `ssl:` keys remaining |
| Sibling-convention compare | Read auth + resume-optimizer knexfile ssl blocks | auth = `{rejectUnauthorized:true, ca:DB_SSL_CA}`; resume = `{rejectUnauthorized:true}`; payment/bug-reporter pre-removal = `{rejectUnauthorized:false}` (already the WEAK/unverified variant) — informs Finding 1/2 |
| Payment TLS requirement | grep `rejectUnauthorized\|require.?ssl\|tls\|ssl.required` in payment-backend | none — no payment-specific TLS-required policy in code/docs that the TCP path would satisfy |
| A01–A10 + Frontend | applicability triage on a DB-config-key removal | no code-path/route/handler/auth/injection/SSRF/frontend surface touched — see Coverage Map |
| npm audit | not run | no dependency tree changed by the reviewed knexfile edit (config key removal only). The incidental `@raike/lib-db` add is a local `file:` path (Finding 3) |
| Threat intel | WebSearch | skipped — narrow single-key config removal, no new dependency or network surface (per Step-5 bugfix/refactor narrow-scope rule) |
| Refer-ins | CODE-REVIEW.md / ARCH-REVIEW.md present in dir | none carry `REFER→elmo` for this leg |
| Prior decision | 999.436 ruling (ROADMAP L1847) + 999.440 seed (L1848) | precedent: same change on juggler ruled PASS, reverse-footgun INFO; independently re-confirmed per service here |
| Output written | Write SECURITY-REVIEW.md + elmo-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode chore, 2 files)
- [x] Scope confirmed — 2 knexfiles in scope (+1 incidental package.json noted)
- [x] Mode-appropriate checks run: chore (security-relevant infra/config) — TLS/DB-connection config-removal threat analysis; dead-branch + reverse-footgun ruling per service
- [x] All OWASP A01–A10 categories triaged for applicability (Coverage Map); none have a touched surface
- [x] Frontend/React security scan — N/A (backend DB config only); recorded
- [x] Authz checked — no route/handler/middleware touched; no authz surface in scope
- [x] BOLA/IDOR ownership-trace — N/A (no object-scoped endpoint in scope)
- [x] BFLA / vertical authz — N/A (no handler in scope)
- [x] Mass-assignment — N/A (no req.body sink in scope)
- [x] Cross-product/tenant authz — N/A (no entitlement logic in scope)
- [x] CSRF check — N/A (no cookie-auth mutating route in scope)
- [x] JWT algorithm pinning — N/A (no jwt.verify in scope)
- [x] Prototype-pollution — N/A (no merge of user input in scope)
- [x] Path-traversal/zip-slip + file-upload — N/A (no fs/upload in scope)
- [x] Secrets scan — knexfile reads `DB_PASSWORD`/`DB_USER` from env + GCP secretKeyRef (deploy yaml); **no hardcoded credential** introduced or present
- [x] Secrets/PII-in-logs — N/A (no log sink in scope)
- [x] Supply-chain depth — knexfile edit changes no dependency tree; incidental `@raike/lib-db` is a local `file:` workspace path that exists on disk (INFO Finding 3)
- [x] Threat model — chore TLS-config removal modeled: dead-branch confirmed + reverse-footgun ruled per service; threat-intel WebSearch skipped (narrow no-new-dependency scope)
- [x] npm audit — N/A for the reviewed knexfile edit (no dep change); recorded
- [x] Refer-ins from ernie/cookie — none for this leg
- [x] Grep matches triaged, not just counted — each DB_SSL/rejectUnauthorized/cloudsql hit READ and traced to the deploy config that proves the branch dead
- [x] Findings carry file:line + severity + risk annotation
- [x] Flag-and-refer lines emitted where applicable
- [x] Prior knowledge consulted — 999.436 precedent + 999.440 backlog seed read; no relitigation
- [x] Rubric Coverage Map emitted — every dimension marked with evidence
- [x] Output file written with Proof-of-Work table
- [x] Status line set DONE

## Findings
| # | Severity | OWASP | File:Line | Description | Required Fix |
|---|----------|-------|-----------|-------------|--------------|
| 1 | INFO | A02 / A05 | payment-service/payment-backend/knexfile.js:70-79 | **Reverse footgun (payment).** Removing the ssl ternary means a *future* `DB_SSL=true` on the TCP-host path would connect in **plaintext** rather than the prior unverified-TLS. BUT: (a) the TCP `else` branch is **dead in prod** — deploy sets `CLOUD_SQL_CONNECTION_NAME` (yaml L31-32) so knexfile takes the socketPath/Cloud-SQL-proxy branch (app→proxy is a local Unix socket, no network TLS needed); (b) `DB_SSL` is set **nowhere** (deploy/terraform), so the removed code was already inert; (c) the removed variant was `rejectUnauthorized:false` — *encrypted-but-unauthenticated*, itself MITM-vulnerable, so removal does not drop a meaningful protection. **Payment-specific scrutiny:** no payment/PCI policy in code or docs requires TLS on this path, and the path cannot be reached in the live billing deployment. No real prod path is worsened. | No change required. If the TCP-host branch is ever made a *real* prod path (DB_HOST set, no socketPath), it MUST adopt the auth-service pattern `{ rejectUnauthorized: true, ca: DB_SSL_CA }` — NOT plaintext and NOT `rejectUnauthorized:false`. Tracked as a precondition, not a fix for this leg. |
| 2 | INFO | A02 / A05 | bug-reporter-service/bug-reporter-backend/knexfile.js:70-79 | **Reverse footgun (bug-reporter).** Identical to Finding 1: TCP branch dead in prod (yaml L41-42 sets `CLOUD_SQL_CONNECTION_NAME` + L17 cloudsql annotation → socketPath), `DB_SSL` unset everywhere, removed code was the weak `rejectUnauthorized:false`. bug-reporter is an internal error-reporting widget — lower data sensitivity than payment; no TLS-required policy. No live prod path worsened. | Same as Finding 1 — adopt verified-TLS-with-CA only if the TCP branch ever becomes a real prod path. No change required for this leg. |
| 3 | INFO | A06 | bug-reporter-service/bug-reporter-backend/package.json:17 | Incidental (not part of the reviewed knexfile change): adds `@raike/lib-db` as `file:../../packages/lib-db`. Target dir exists on disk; a local workspace path, not a registry/network fetch, so no supply-chain CVE/install-script exposure from a remote source. Out of this leg's stated scope. | None for this leg. If this package.json edit belongs to a different leg, route it there; a `file:` workspace dep needs no registry-audit. |

No BLOCK findings. No WARN findings.

**Reverse-footgun ruling = INFO per service** (matches the 999.436 precedent), independently re-derived:
the worsened path (plaintext on TCP) is **unreachable in both live deployments** (socketPath via Cloud SQL
Proxy), `DB_SSL` is unset in all live config, and the removed code was already the weak unverified-TLS
variant. Payment's billing/PCI sensitivity does **not** elevate this: the TCP+TLS fallback is not, and
cannot become without a config change, a real prod path for payment.

No `REFER→telly` lines — INFO-only config removal needs no security-regression test. (The leg's own
config-load guard / `grep rejectUnauthorized→0` checks, owned by Oscar completeness, already cover regression.)

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Input Validation | covered | No user-input sink in scope; config-key removal only | N/A surface |
| Authentication | covered | No auth/jwt code touched; DB creds via env + GCP secretKeyRef unchanged | — |
| Authorization | covered | No route/handler/middleware in scope | — |
| Data Protection | covered | DB-connection TLS analyzed: TCP-TLS branch dead in prod; live path = Cloud SQL Proxy Unix socket; removal does not expose live data-in-transit (Findings 1-2) | reverse-footgun ruled INFO |
| Dependencies | covered | knexfile edit changes no dep tree; incidental local `file:` dep noted (Finding 3); no registry/CVE surface | npm audit N/A for this edit |
| Exposure Surface | covered | No new endpoint/port/route; deploy ingress/CORS unchanged | — |
| Session Security | covered | No cookie/session code in scope | — |
| Audit Trail | covered | No log sink in scope; no secrets/PII logging path touched | — |
| Infrastructure Security | covered | Read both deploy yamls: CLOUD_SQL_CONNECTION_NAME + cloudsql-instances annotation set → socketPath; confirms prod connection topology unaffected | core of dead-branch proof |
| Secrets Management | covered | No hardcoded secret introduced/present; DB_PASSWORD/DB_USER from env + GCP Secret Manager (deploy yaml secretKeyRef); gitleaks absent → grep-only secret coverage, recorded | grep-only |

## Sign-off
Signed: Elmo — 2026-06-12T22:59:48Z
