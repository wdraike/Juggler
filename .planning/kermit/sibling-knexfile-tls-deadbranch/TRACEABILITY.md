# Traceability — sibling-knexfile-tls-deadbranch — chore

| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| 999.440-W1 | Dead ssl ternary removed from payment prod knexfile (socketPath used; DB_SSL unset) | payment production connection object — drop DB_SSL ternary | payment-service/payment-backend/knexfile.js (production.connection, L79-81) | Oscar completeness: grep rejectUnauthorized→0 + require loads + diff scope; elmo SECURITY-REVIEW | verified |
| 999.440-W2 | Dead ssl ternary removed from bug-reporter prod knexfile (socketPath used; DB_SSL unset) | bug-reporter production connection object — drop DB_SSL ternary | bug-reporter-service/bug-reporter-backend/knexfile.js (production.connection, L79-81) | Oscar completeness: grep rejectUnauthorized→0 + require loads + diff scope; elmo SECURITY-REVIEW | verified |
