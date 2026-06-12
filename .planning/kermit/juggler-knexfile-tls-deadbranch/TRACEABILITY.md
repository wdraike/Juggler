# Traceability — juggler-knexfile-tls-deadbranch — chore

| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| 999.436 | Dead `ssl:{rejectUnauthorized:false}` TCP-fallback branch removed from knexfile prod config; no live behavior change (prod uses socketPath; DB_SSL never set) | knexfile production connection object — drop the DB_SSL ternary | juggler-backend/knexfile.js (production.connection, L58-60 post-edit) | Oscar completeness verification: `grep rejectUnauthorized juggler-backend`→0 + `node -e require('./knexfile')` loads + diff scope (dev/test untouched); elmo SECURITY-REVIEW DONE | verified |
