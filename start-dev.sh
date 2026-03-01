#!/bin/bash
#
# Juggler Development Environment Startup Script
# Starts Cloud SQL Proxy, backend, and frontend, then verifies health.
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/juggler-backend"
FRONTEND_DIR="$PROJECT_DIR/juggler-frontend"

# Ports
DB_PORT=3307
BACKEND_PORT=5002
FRONTEND_PORT=3001

# Cloud SQL instance
CLOUD_SQL_INSTANCE="lexical-period-466519-s0:us-central1:resume-optimizer-db"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; }

check_port() {
  lsof -i :"$1" -P -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-30}
  local elapsed=0
  while ! check_port "$port"; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$timeout" ]; then
      fail "$name did not start on port $port within ${timeout}s"
      return 1
    fi
  done
  log "$name is listening on port $port"
}

echo ""
echo "========================================="
echo "  Juggler Dev Environment Startup"
echo "========================================="
echo ""

# --- 1. Cloud SQL Proxy ---
echo "--- Cloud SQL Proxy (port $DB_PORT) ---"
if check_port "$DB_PORT"; then
  log "Cloud SQL Proxy already running on port $DB_PORT"
else
  warn "Starting Cloud SQL Proxy..."
  cloud_sql_proxy -instances="${CLOUD_SQL_INSTANCE}=tcp:0.0.0.0:${DB_PORT}" &
  wait_for_port "$DB_PORT" "Cloud SQL Proxy" 15
fi

# --- 2. Dependencies ---
echo ""
echo "--- Dependencies ---"
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  warn "Installing backend dependencies..."
  (cd "$BACKEND_DIR" && npm install)
else
  log "Backend dependencies installed"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  warn "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
else
  log "Frontend dependencies installed"
fi

# --- 3. Database Migrations ---
echo ""
echo "--- Database Migrations ---"
cd "$BACKEND_DIR"
PENDING=$(npx knex migrate:status 2>&1 | grep "Pending" || true)
if [ -n "$PENDING" ]; then
  warn "Running pending migrations..."
  npx knex migrate:latest
  log "Migrations applied"
else
  log "All migrations up to date"
fi

# --- 4. Backend ---
echo ""
echo "--- Backend (port $BACKEND_PORT) ---"
if check_port "$BACKEND_PORT"; then
  log "Backend already running on port $BACKEND_PORT"
else
  warn "Starting backend..."
  (cd "$BACKEND_DIR" && npm run dev > /tmp/juggler-backend.log 2>&1 &)
  wait_for_port "$BACKEND_PORT" "Backend" 15
fi

# --- 5. Frontend ---
echo ""
echo "--- Frontend (port $FRONTEND_PORT) ---"
if check_port "$FRONTEND_PORT"; then
  log "Frontend already running on port $FRONTEND_PORT"
else
  warn "Starting frontend..."
  (cd "$FRONTEND_DIR" && BROWSER=none npm start > /tmp/juggler-frontend.log 2>&1 &)
  wait_for_port "$FRONTEND_PORT" "Frontend" 30
fi

# --- 6. Health Checks ---
echo ""
echo "--- Health Checks ---"
sleep 2

HEALTH=$(curl -s http://localhost:$BACKEND_PORT/health 2>/dev/null || echo '{"status":"error"}')
DB_STATUS=$(echo "$HEALTH" | grep -o '"db":"[^"]*"' | cut -d'"' -f4)

if [ "$DB_STATUS" = "connected" ]; then
  log "Backend health: OK (DB connected)"
else
  fail "Backend health check failed: $HEALTH"
fi

if check_port "$FRONTEND_PORT"; then
  log "Frontend health: OK"
else
  fail "Frontend is not responding on port $FRONTEND_PORT"
fi

# --- Summary ---
echo ""
echo "========================================="
echo "  Juggler is ready!"
echo "========================================="
echo ""
echo "  Frontend:  http://localhost:$FRONTEND_PORT"
echo "  Backend:   http://localhost:$BACKEND_PORT"
echo "  DB Proxy:  localhost:$DB_PORT"
echo ""
echo "  Logs:"
echo "    Backend:  /tmp/juggler-backend.log"
echo "    Frontend: /tmp/juggler-frontend.log"
echo ""
