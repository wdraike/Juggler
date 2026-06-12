# WBS — sibling-knexfile-tls-deadbranch — chore — 2026-06-12

## Intent
Remove the dead `ssl: { rejectUnauthorized: false }` TCP-fallback branch from the production
knexfile config of **payment-backend** and **bug-reporter-backend** (closes 999.440). Repeat of
999.436 (juggler), same footgun, evidence-verified identical per service.

**Evidence (intake, inline — per service):**
- Both `knexfile.js` use `connection: CLOUD_SQL_CONNECTION_NAME ? { socketPath… } : { host/port…
  ssl: DB_SSL==='true' ? {rejectUnauthorized:false} : undefined }` (payment L62-82, bug-reporter
  L62-82).
- Prod deploy sets `CLOUD_SQL_CONNECTION_NAME` (payment `deploy/payment-backend.yaml:31`,
  bug-reporter `deploy/bug-reporter-backend.yaml:41`) + the cloudsql-instances annotation → prod
  takes the **socketPath** branch (Unix socket via Cloud SQL Proxy sidecar). The ssl block lives
  only on the unreachable TCP `else`.
- `DB_SSL` set **nowhere** (deploy/, terraform/) → even on the TCP path the ternary is false →
  `ssl` already `undefined`. Doubly unreachable.
- Live prod MITM exposure = nil (socketPath = local Unix socket; proxy owns TLS to Cloud SQL).

**Decision:** REMOVE the dead `DB_SSL` ternary from each service's production TCP-fallback object
(same as 999.436 — not "harden to CA"; the TCP path is unused).

**Routing:** classifier `full/standard` (risky: security). **Downgraded to `--ops`** — exact repeat
of 999.436, which Snuffy already adjudicated OVER_SCOPED → `--ops` (elmo spot-check, no heavy
pipeline). Snuffy re-run SKIPPED (recorded): identical verified pattern, same adjudication applies.
elmo MANDATORY (security surface).

**Business acceptance:** the unverified-TLS branch no longer exists in either service; no live
config changes behavior; elmo confirms dead-branch + reverse-footgun (post-removal `DB_SSL=true`→
plaintext) acceptable per service.

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | Remove the `ssl: DB_SSL==='true' ? {rejectUnauthorized:false} : undefined` key from the production TCP-fallback connection object in `payment-backend/knexfile.js` (L79-81). socketPath branch + dev/test untouched. | chore | payment-service | payment knexfile L62-82; evidence above | — | (1) `grep rejectUnauthorized payment-backend`→0. (2) `require('./knexfile')` loads; production well-formed; socketPath branch unchanged. (3) elmo confirms dead-branch + reverse-footgun acceptable. (4) dev/test byte-identical. | elmo (security verify) | 1 |
| W2 | Same removal in `bug-reporter-backend/knexfile.js` (L79-81). | chore | bug-reporter-service | bug-reporter knexfile L62-82; evidence above | — | (1) `grep rejectUnauthorized bug-reporter-backend`→0. (2) require loads; production well-formed; socketPath unchanged. (3) elmo confirms. (4) dev/test byte-identical. | elmo (security verify) | 1 |

## Dependency Graph
W1, W2 independent — no deps (different services). Same wave.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| — | — | two independent single-file removals in separate services; no ordering |

## Waves
Wave 1: W1 + W2 (parallel — independent services)

## Snuffy / routing decision (Step 3.7)
SKIPPED (recorded) — exact repeat of 999.436; Snuffy already ruled that pattern OVER_SCOPED →
`--ops`. Same routing adopted: lane `--ops`, depth `standard`, elmo mandatory.
