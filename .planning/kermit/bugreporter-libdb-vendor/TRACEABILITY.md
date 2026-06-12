# Traceability — bugreporter-libdb-vendor — bugfix

| ID | Description (bug → root cause → fix → regression test) | Design element | Code (file:sym) | Test(s) | Status |
|----|--------------------------------------------------------|----------------|-----------------|---------|--------|
| 999.441 | BUG: fresh Docker build/`npm ci` of bug-reporter-backend → `Cannot find module '@raike/lib-db'` at boot (committed src/db.js requires it; manifest omits/uses out-of-context `file:../../packages`). ROOT CAUSE: lib-db migration landed in code but never vendored into the Docker build context nor locked. FIX: vendor lib-db → `file:./vendor/lib-db`, ensure knex+mysql2, regen lock, Docker-verify. | vendor-pattern dependency resolution (build-context-local) | bug-reporter-backend/vendor/lib-db/*, package.json (@raike/lib-db→file:./vendor/lib-db), package-lock.json | tests/unit/vendor-deps.test.js (path-scoped resolve, RED pre-fix) + Docker build+boot verification | seeded |
