#!/usr/bin/env bash
# ─── setup-test-db.sh ───────────────────────────────────────────────────────
# Boots the test DB container, runs all migrations, and seeds base data.
# Safe to re-run: migrations are idempotent; seed is upsert-based.
#
# Usage:
#   ./scripts/setup-test-db.sh           # full setup
#   ./scripts/setup-test-db.sh --migrate # migrate only (container must be up)
#   ./scripts/setup-test-db.sh --seed    # seed only   (container must be up)
#   ./scripts/setup-test-db.sh --reset   # truncate all user data, re-seed
#   ./scripts/setup-test-db.sh --down    # stop and remove container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.test.yml"

DB_HOST=127.0.0.1
DB_PORT=3308
DB_NAME=juggler_test

MODE="${1:-}"

_wait_for_db() {
  echo "⏳  Waiting for test DB on port $DB_PORT..."
  local retries=30
  while ! mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" --silent 2>/dev/null; do
    retries=$((retries - 1))
    if [ "$retries" -eq 0 ]; then
      echo "✗  Test DB did not become ready in time" >&2
      exit 1
    fi
    sleep 1
  done
  echo "✓  Test DB ready"
}

_migrate() {
  echo "⏳  Running migrations..."
  cd "$BACKEND_DIR"
  NODE_ENV=test npx knex migrate:latest --env test
  echo "✓  Migrations complete"
}

_seed() {
  echo "⏳  Seeding base data..."
  cd "$BACKEND_DIR"
  NODE_ENV=test node scripts/seed-test-base.js
  echo "✓  Base seed complete"
}

_reset() {
  echo "⏳  Resetting test data..."
  cd "$BACKEND_DIR"
  NODE_ENV=test node -e "
    const db = require('./tests/helpers/test-db');
    db.clearAll().then(() => { console.log('cleared'); return db.destroy(); }).catch(e => { console.error(e); process.exit(1); });
  "
  _seed
}

case "$MODE" in
  --down)
    echo "⏳  Stopping test DB container..."
    docker compose -f "$COMPOSE_FILE" down
    echo "✓  Container stopped"
    ;;
  --migrate)
    _wait_for_db
    _migrate
    ;;
  --seed)
    _wait_for_db
    _seed
    ;;
  --reset)
    _wait_for_db
    _reset
    ;;
  *)
    echo "⏳  Starting test DB container..."
    docker compose -f "$COMPOSE_FILE" up -d
    _wait_for_db
    _migrate
    _seed
    echo ""
    echo "✓  Test DB ready at $DB_HOST:$DB_PORT/$DB_NAME"
    echo "   Run tests: cd juggler-backend && npm test"
    ;;
esac
