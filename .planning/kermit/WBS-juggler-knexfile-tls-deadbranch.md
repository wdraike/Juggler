# WBS — juggler-knexfile-tls-deadbranch — chore — 2026-06-12

## Intent
Remove the dead `ssl: { rejectUnauthorized: false }` TCP-fallback branch from `knexfile.js`
production config (closes security WARN 999.436). **Evidence (intake, inline):**
- Prod deploy sets `CLOUD_SQL_CONNECTION_NAME` (`deploy/juggler-backend.yaml:63`) → knexfile takes
  the **socketPath** branch (Unix socket via Cloud SQL Proxy sidecar). The `ssl:{}` block lives only
  on the `else` TCP-host/port fallback (line 53-65), never reached in prod.
- `DB_SSL` is set **nowhere** (deploy/, terraform/, .env) → even on the TCP path `DB_SSL==='true'`
  is false → `ssl: undefined`. Doubly unreachable.
- Single occurrence in codebase (`knexfile.js:63`).
Live prod MITM exposure = nil (app→proxy is a local Unix socket; proxy owns TLS to Cloud SQL).
The WARN is a latent footgun, not a live vuln.

**Decision (human, 2026-06-12):** REMOVE the dead `DB_SSL` ternary entirely from the production
TCP-fallback connection object. Not "harden to verify CA" — the TCP path is unused; dropping the
footgun is simpler + safer.

**Business acceptance:** the unverified-TLS branch no longer exists; no live config changes behavior;
elmo confirms the dead-branch analysis + the reverse footgun (post-removal a future `DB_SSL=true`
silently yields plaintext, not unverified-TLS) is acceptable or guarded.

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | Remove the `ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined` key from the production TCP-fallback connection object in `knexfile.js` (lines 62-64). Leave the socketPath branch + dev/test configs untouched. | chore | juggler | knexfile.js:43-65; evidence above | — | (1) No `rejectUnauthorized` token remains in juggler-backend (`grep rejectUnauthorized` → 0). (2) `require('./knexfile')` still loads; `production` config object is well-formed; socketPath branch unchanged. (3) elmo confirms branch was dead in all live configs AND the reverse-footgun (DB_SSL=true→plaintext) is acceptable or explicitly guarded. (4) dev + test config objects byte-identical to before. | bert (edit), elmo (security verify), telly (config-load guard test) | 1 |

## Dependency Graph
single item — no deps.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| — | — | single-file 3-line removal; no ordering |

## Waves
Wave 1: W1

## Snuffy / routing decision (Step 3.7)
- Classifier recommended `full / standard` (risky=true: security + cross-service).
- **Snuffy verdict: OVER_SCOPED** — 3-line dead-code removal over-fits the full 5-agent serial
  pipeline; elmo's verify-scope is a narrow dead-branch + reverse-footgun spot-check, not an audit.
  Snuffy proposed `hotfix`/inline.
- **Kermit decision (overrule Snuffy specifics, adopt LOWER direction): lane `--ops`, depth `standard`.**
  Reasons: (a) `hotfix` is for prod-down emergencies — not applicable. (b) Inline/`--trivial`
  self-clearing on a DB/TLS security surface is the exact failure the 2026-06-12 ops-lane retro
  flagged (`RETRO-PROPOSAL-ops-lane-2026-06-12.md`); a security-surface leg MUST reach Oscar with
  ≥`--ops` so elmo + the metrics row are guaranteed. (c) `--ops` gives elmo's narrow spot-check +
  telly guard test without the heavy full pipeline → matches Snuffy's intent while keeping the
  security floor. Snuffy overrule recorded per Step 3.7.
