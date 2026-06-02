# SQL Injection Scanning Tooling

This directory contains tools for detecting and preventing SQL injection vulnerabilities in the Juggler backend.

## Tools Included

### 1. SQL Injection Scanner (`scripts/sql-injection-scanner.js`)

A comprehensive scanner that:
- Detects raw SQL calls using Knex
- Identifies parameterized vs. non-parameterized queries
- Flags template string SQL injection patterns
- Checks for string concatenation in SQL queries
- Provides detailed reports with severity levels

**Usage:**
```bash
node scripts/sql-injection-scanner.js
```

### 2. ESLint SQL Injection Rules (`eslint-sql-injection-rules.js`)

Custom ESLint rules that:
- Prevent template literals with variables in raw SQL
- Block string concatenation in SQL queries
- Enforce parameterized query patterns

**Usage:**
```bash
npx eslint 'src/**/*.js' --rule '{"sql-injection/no-unsafe-sql":"error"}' --config eslint-sql-injection-rules.js
```

### 3. GitHub Actions Workflow (`.github/workflows/sql-injection-scan.yml`)

Automated scanning that runs on:
- Every push to main/dev branches
- Every pull request
- Weekly scheduled scans (Sunday at midnight)

## Security Patterns Detected

### ✅ SAFE Patterns
- Parameterized queries: `.raw('SELECT * FROM users WHERE id = ?', [userId])`
- Constants only: `.raw('DROP TABLE IF EXISTS temp_table')`
- Knex builder methods: `.where('id', userId)`

### ❌ UNSAFE Patterns
- Template literals: `.raw(`SELECT * FROM users WHERE id = ${userId}`)`
- String concatenation: `.raw('SELECT * FROM users WHERE id = ' + userId)`
- Direct variable interpolation in raw SQL

## Integration

### Pre-commit Hook

Add to `.husky/pre-commit`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run SQL injection scan
node scripts/sql-injection-scanner.js
if [ $? -ne 0 ]; then
  echo "SQL injection vulnerabilities detected!"
  exit 1
fi
```

### CI/CD Pipeline

The GitHub Actions workflow is already configured to:
1. Run on every push/PR
2. Upload detailed scan results as artifacts
3. Fail the build if vulnerabilities are found

## Best Practices

1. **Always use parameterized queries:**
   ```javascript
   // ✅ GOOD
   knex.raw('SELECT * FROM users WHERE id = ?', [userId])
   
   // ❌ BAD
   knex.raw(`SELECT * FROM users WHERE id = ${userId}`)
   ```

2. **Use Knex query builder methods:**
   ```javascript
   // ✅ GOOD
   knex('users').where('id', userId)
   
   // ❌ BAD
   knex.raw('SELECT * FROM users WHERE id = ' + userId)
   ```

3. **For migrations, use constants only:**
   ```javascript
   // ✅ GOOD
   await knex.raw('DROP TABLE IF EXISTS temp_table')
   
   // ❌ BAD
   await knex.raw(`DROP TABLE IF EXISTS ${tableName}`)
   ```

## Reporting

The scanner produces detailed reports with:
- File paths and line numbers
- Code snippets
- Severity levels (SAFE/UNSAFE)
- Statistics and summaries

Example output:
```
SQL INJECTION SCAN REPORT
================================================================================
Statistics:
  Files scanned: 45
  Total lines: 12456
  Raw SQL calls: 8
  Parameterized calls: 6
  Safe calls: 7
  Unsafe calls: 1

Findings Summary:
  SAFE: 7
  UNSAFE: 1

❌ UNSAFE FINDINGS (require attention):
--------------------------------------------------------------------------------
File: src/controllers/task.controller.js:150
Code: knex.raw(`SELECT * FROM tasks WHERE user_id = ${userId}`)
Issue: Template string SQL injection
```

## Maintenance

- Update `CONFIG.dangerousFunctions` in the scanner when new Knex methods are used
- Add new patterns to `CONFIG.safePatterns` as parameterization styles evolve
- Review and update ESLint rules regularly

## References

- [Knex.js Query Builder Documentation](https://knexjs.org/)
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [Node.js Security Best Practices](https://github.com/goldbergyoni/nodebestpractices#1-security-best-practices)