# JUGGLER: Code Review Phase A - Tooling Baseline

**Phase:** A (Tooling Baseline)
**Status:** PLANNING
**Generated:** 2026-06-02
**Scope:** juggler-backend, juggler-mcp, juggler-frontend

## Overview

This plan establishes the tooling baseline for the Juggler code audit. It covers installation and configuration of three key analysis tools across all three Juggler packages, captures pre-audit scan outputs in standardized JSON format, and establishes Jest test baselines.

## Packages to Audit

Three packages comprise the Juggler monorepo:

1. **juggler-backend** (`juggler/juggler-backend/`)
   - Node.js/Express backend service (port 5002)
   - MySQL + Knex.js data layer
   - MCP server integration
   - Task scheduling engine

2. **juggler-mcp** (`juggler/juggler-mcp/`)
   - MCP (Model Context Protocol) server
   - Exposes Juggler tasks to external MCP clients (e.g., ClimbRS)
   - Lightweight Node.js service

3. **juggler-frontend** (`juggler/juggler-frontend/`)
   - React frontend (port 3003)
   - Task management UI
   - Calendar views and scheduling interface

## Tooling Installation

### Required Tools

All three packages require the following tools installed as devDependencies:

| Tool | Purpose | Version Range |
|------|---------|---------------|
| **knip** | Find unused files, dependencies, and exports | `^5.88.1` |
| **depcheck** | Check for unused dependencies and missing dependencies | `^1.4.7` |
| **eslint-plugin-unused-imports** | Detect unused ES6 imports | `^3.2.0` - `^4.4.1` |

### Installation Steps

#### 1. Install in juggler-backend

```bash
cd juggler/juggler-backend
npm install --save-dev knip@^5.88.1 depcheck@^1.4.7 eslint-plugin-unused-imports@^4.4.1
```

Verify in `package.json`:
```json
{
  "devDependencies": {
    "knip": "^5.88.1",
    "depcheck": "^1.4.7",
    "eslint-plugin-unused-imports": "^4.4.1"
  }
}
```

#### 2. Install in juggler-mcp

```bash
cd juggler/juggler-mcp
npm install --save-dev knip@^5.88.1 depcheck@^1.4.7 eslint-plugin-unused-imports@^4.4.1
```

Verify in `package.json`:
```json
{
  "devDependencies": {
    "knip": "^5.88.1",
    "depcheck": "^1.4.7",
    "eslint-plugin-unused-imports": "^4.4.1"
  }
}
```

#### 3. Install in juggler-frontend

```bash
cd juggler/juggler-frontend
npm install --save-dev knip@^5.88.1 depcheck@^1.4.7 eslint-plugin-unused-imports@^3.2.0
```

Verify in `package.json`:
```json
{
  "devDependencies": {
    "knip": "^5.88.1",
    "depcheck": "^1.4.7",
    "eslint-plugin-unused-imports": "^3.2.0"
  }
}
```

### ESLint Configuration

Ensure `eslint-plugin-unused-imports` is enabled in each package's ESLint config:

```javascript
// .eslintrc.js or eslint.config.js
module.exports = {
  plugins: ['unused-imports'],
  rules: {
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_'
      }
    ]
  }
};
```

## Pre-Audit Scan Process

### Scan Commands

Run the following commands from each package directory to generate JSON baseline scans:

#### Knip Scan

```bash
# From package root (juggler-backend, juggler-mcp, or juggler-frontend)
npx knip --reporter json
```

**Output format:** JSON array of issues with the following structure:

```json
{
  "issues": {
    "files": [
      {
        "file": "path/to/file.js",
        "unusedFiles": ["path/to/unused.js"],
        "unusedExports": ["exportName"],
        "unusedDependencies": ["package-name"]
      }
    ],
    "dependencies": {
      "missing": ["package-name"],
      "unused": ["package-name"]
    }
  },
  "stats": {
    "files": 123,
    "unusedFiles": 5,
    "unusedExports": 10,
    "unusedDependencies": 3
  }
}
```

#### Depcheck Scan

```bash
# From package root
npx depcheck --json
```

**Output format:** JSON object with dependency analysis:

```json
{
  "dependencies": ["used-package"],
  "devDependencies": ["used-dev-package"],
  "missing": ["missing-package"],
  "unused": {
    "dependencies": ["unused-package"],
    "devDependencies": ["unused-dev-package"]
  },
  "invalidFiles": {
    "file": "reason"
  },
  "invalidDirs": ["directory"]
}
```

#### ESLint Unused Imports Scan

```bash
# From package root
npx eslint --format json . | jq '.[] | select(.messages[]?.rule == "unused-imports/no-unused-imports")'
```

**Output format:** JSON array of linting issues:

```json
[
  {
    "filePath": "src/file.js",
    "messages": [
      {
        "ruleId": "unused-imports/no-unused-imports",
        "severity": 2,
        "message": "'unusedImport' is defined but never used.",
        "line": 42,
        "column": 1,
        "nodeType": "ImportDeclaration",
        "messageId": "unusedImport",
        "endLine": 42,
        "endColumn": 25
      }
    ],
    "errorCount": 1,
    "warningCount": 0,
    "fixableErrorCount": 1,
    "fixableWarningCount": 0,
    "source": "import { unusedImport } from 'package';..."
  }
]
```

### Output File Naming Convention

Store all scan outputs in `.planning/phases/juggler-code-review/baseline/` with the following naming:

- `knip-{package}.json` (e.g., `knip-backend.json`)
- `depcheck-{package}.json` (e.g., `depcheck-backend.json`)
- `eslint-unused-{package}.json` (e.g., `eslint-unused-backend.json`)

### Baseline Capture Script

Create a capture script at `juggler/scripts/capture-baseline.sh`:

```bash
#!/bin/bash
set -e

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASELINE_DIR="$REPO_ROOT/.planning/phases/juggler-code-review/baseline"

mkdir -p "$BASELINE_DIR"

echo "📊 Capturing tooling baseline..."

# juggler-backend
cd "$REPO_ROOT/juggler-backend"
echo "🔍 Scanning juggler-backend..."
npx knip --reporter json > "$BASELINE_DIR/knip-backend.json"
npx depcheck --json > "$BASELINE_DIR/depcheck-backend.json"
npx eslint --format json . | jq '.[] | select(.messages[]?.rule == "unused-imports/no-unused-imports")' > "$BASELINE_DIR/eslint-unused-backend.json"

# juggler-mcp
cd "$REPO_ROOT/juggler-mcp"
echo "🔍 Scanning juggler-mcp..."
npx knip --reporter json > "$BASELINE_DIR/knip-mcp.json"
npx depcheck --json > "$BASELINE_DIR/depcheck-mcp.json"
npx eslint --format json . | jq '.[] | select(.messages[]?.rule == "unused-imports/no-unused-imports")' > "$BASELINE_DIR/eslint-unused-mcp.json"

# juggler-frontend
cd "$REPO_ROOT/juggler-frontend"
echo "🔍 Scanning juggler-frontend..."
npx knip --reporter json > "$BASELINE_DIR/knip-frontend.json"
npx depcheck --json > "$BASELINE_DIR/depcheck-frontend.json"
npx eslint --format json . | jq '.[] | select(.messages[]?.rule == "unused-imports/no-unused-imports")' > "$BASELINE_DIR/eslint-unused-frontend.json"

echo "✅ Baseline capture complete!"
echo "📁 Outputs saved to: $BASELINE_DIR"
```

Make it executable:
```bash
chmod +x juggler/scripts/capture-baseline.sh
```

## Jest Baseline Process

### Test Configuration

Each package has its own Jest configuration:

- **juggler-backend**: `juggler/juggler-backend/jest.config.js`
- **juggler-mcp**: Uses default Jest config or inherits from backend
- **juggler-frontend**: `juggler/juggler-frontend/jest.config.js` (React Testing Library)

### Running Tests

Capture test baselines with the following commands:

#### juggler-backend Tests

```bash
cd juggler/juggler-backend
npm test -- --json --outputFile=../../.planning/phases/juggler-code-review/baseline/jest-backend.json
```

**Expected output format:**
```json
{
  "success": true,
  "startTime": 1780418516,
  "numTotalTestSuites": 25,
  "numPassedTestSuites": 25,
  "numFailedTestSuites": 0,
  "numTotalTests": 187,
  "numPassedTests": 187,
  "numFailedTests": 0,
  "testResults": [
    {
      "name": "src/services/task.service.test.js",
      "status": "passed",
      "message": "",
      "startTime": 1780418517,
      "endTime": 1780418518,
      "duration": 0.123
    }
  ]
}
```

#### juggler-mcp Tests

```bash
cd juggler/juggler-mcp
npm test -- --json --outputFile=../../.planning/phases/juggler-code-review/baseline/jest-mcp.json
```

#### juggler-frontend Tests

```bash
cd juggler/juggler-frontend
npm test -- --json --outputFile=../../.planning/phases/juggler-code-review/baseline/jest-frontend.json
```

### Jest Baseline Script

Add to the capture script:

```bash
# Add to capture-baseline.sh after eslint scans

# Jest baselines
echo "🧪 Capturing Jest baselines..."

cd "$REPO_ROOT/juggler-backend"
npx jest --json --outputFile="$BASELINE_DIR/jest-backend.json" || echo "{"success":false,"error":"backend tests failed"}" > "$BASELINE_DIR/jest-backend.json"

cd "$REPO_ROOT/juggler-mcp"
npx jest --json --outputFile="$BASELINE_DIR/jest-mcp.json" || echo "{"success":false,"error":"mcp tests failed"}" > "$BASELINE_DIR/jest-mcp.json"

cd "$REPO_ROOT/juggler-frontend"
npx jest --json --outputFile="$BASELINE_DIR/jest-frontend.json" || echo "{"success":false,"error":"frontend tests failed"}" > "$BASELINE_DIR/jest-frontend.json"
```

## Validation Checklist

- [ ] All three packages have knip, depcheck, and eslint-plugin-unused-imports installed
- [ ] Package.json files are committed to git
- [ ] Baseline scans are captured and saved to `.planning/phases/juggler-code-review/baseline/`
- [ ] JSON output files follow the naming convention
- [ ] Jest test baselines are captured for all packages
- [ ] No critical errors in baseline scans (investigate any failed tests)

## Success Criteria

✅ **Phase A is complete when:**
1. All tooling is installed across all 3 packages
2. Pre-audit JSON scans are captured and stored
3. Jest baselines are established
4. No blocking issues are found in the baseline scans

## Next Steps

After completing Phase A:
- **Phase B**: DB schema + collation + FK + index audit (read-only analysis)
- **Phase C**: SQL injection sweep across backend + MCP
- **Phase D**: Security vulnerability scan

## References

- **ROADMAP**: `.planning/ROADMAP.md` line 300
- **Baseline Directory**: `.planning/phases/juggler-code-review/baseline/`
- **Tool Documentation**:
  - [knip](https://github.com/webpro/knip)
  - [depcheck](https://github.com/depcheck/depcheck)
  - [eslint-plugin-unused-imports](https://github.com/sweepline/eslint-plugin-unused-imports)
- **Jest CLI Docs**: [https://jestjs.io/docs/cli](https://jestjs.io/docs/cli)