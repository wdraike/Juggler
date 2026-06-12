# WBS — bugreporter-libdb-vendor — bugfix — 2026-06-12

## Intent
Fix the broken bug-reporter-backend deploy image (closes 999.441). Mirrors juggler 999.407.

**Repro (verified inline):**
- Committed `src/db.js:8` does `const { createKnex } = require('@raike/lib-db')`.
- Committed `package.json` does NOT declare `@raike/lib-db` (`git show HEAD:…/package.json | grep` → absent).
- An uncommitted working-tree edit adds `"@raike/lib-db": "file:../../packages/lib-db"` — but that
  path is OUTSIDE the Docker build context (Dockerfile `COPY package*.json` + `COPY vendor/` only;
  build root = bug-reporter-backend/). And it is not in package-lock.json.
- Dockerfile runs `npm ci --omit=dev` → a fresh build cannot install `@raike/lib-db` → boot throws
  `Cannot find module '@raike/lib-db'`. **Deploy image broken** (same class as 999.407 / 999.387).

**Root cause:** the lib-db migration (src/db.js → unified `@raike/lib-db`) was landed in code but the
dependency was never vendored into the service's Docker build context nor pinned/locked.

**Fix (mirror juggler 999.407 vendor pattern):** vendor `packages/lib-db` source into
`bug-reporter-backend/vendor/lib-db/`, repoint `package.json` → `file:./vendor/lib-db`, ensure
lib-db's runtime deps (`knex`, and the `mysql2` driver) are present in the service manifest, regen
`package-lock.json` ONLINE (SRI intact per 999.438), guard-test the resolution, and VERIFY via a
real Docker build + container boot.

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | Vendor `packages/lib-db` (package.json + src, NOT node_modules) into `bug-reporter-backend/vendor/lib-db/`; repoint `package.json` `@raike/lib-db` → `file:./vendor/lib-db`; ensure `knex` + `mysql2` present in the service manifest (lib-db's createKnex needs them); regen `package-lock.json` online. | bugfix | bug-reporter-service | repro above; juggler 999.407 template (`juggler-backend/vendor/lib-db`, `tests/unit/vendor-deps.test.js`) | — | (1) telly guard test (path-scoped `require.resolve(...,{paths:[backendDir]})`) RED on pre-fix, GREEN post-fix. (2) `@raike/lib-db` resolves WITHIN bug-reporter-backend/ (vendor), not DEV/packages or hoisted. (3) `package.json` pins `@raike/lib-db` to `file:./vendor/lib-db`; knex+mysql2 present. (4) `package-lock.json` regenerated, in sync (`npm ci` succeeds), SRI integrity retained (999.438). | telly (RED→GREEN guard), cookie (build/infra), elmo (vendored-dep supply-chain) | 1 |
| W2 | Verify the deployable image: real `docker build` of bug-reporter-backend + container boot; confirm `require('@raike/lib-db')` + createKnex resolve (no Cannot-find-module), service starts. | bugfix | bug-reporter-service | W1 complete; Dockerfile | W1 | (5) `docker build` succeeds. (6) container boots; lib-db + knex resolve at runtime; no Cannot-find-module. Evidence (build log + boot) recorded in OSCAR-REVIEW. | telly/cookie (Docker verify) | 2 |

## Dependency Graph
W2 ← W1 (build-order: can't Docker-verify until vendored + locked). Serial chain.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| W2←W1 | build-order | Docker build needs the vendored package + synced lockfile first |

## Waves
Wave 1: W1
Wave 2: W2

## Routing decision (Step 3.7)
Classifier full/standard (risky: infra/deploy-build). Snuffy SKIPPED (recorded): unambiguously
full-lane — 6 acceptance criteria + mandatory Docker build+boot verification, cannot under/over-scope;
mirrors the established 999.407 full bugfix leg. cookie (infra/build owner) + elmo (vendored-dep
supply-chain) + telly (RED-first guard + Docker verify) + zoe.

## Env prerequisites (surface if blocked)
- Lockfile regen needs **network** (`npm install`) — sandbox may block (CLAUDE.md sandbox note).
- Docker build+boot needs the **Docker daemon**.
A blocked prerequisite is an INFRA-ERROR hold (non-terminal), not a content PASS — surface it.
