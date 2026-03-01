#!/bin/bash
#
# Juggler Development Environment Shutdown Script
# Stops frontend and backend processes (leaves Cloud SQL Proxy running).
#

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

echo ""
echo "Stopping Juggler dev environment..."
echo ""

# Stop frontend (port 3001)
FRONTEND_PID=$(lsof -ti :3001 -sTCP:LISTEN 2>/dev/null)
if [ -n "$FRONTEND_PID" ]; then
  kill $FRONTEND_PID 2>/dev/null
  log "Frontend stopped (PID $FRONTEND_PID)"
else
  warn "Frontend was not running"
fi

# Stop backend (port 5002)
BACKEND_PID=$(lsof -ti :5002 -sTCP:LISTEN 2>/dev/null)
if [ -n "$BACKEND_PID" ]; then
  kill $BACKEND_PID 2>/dev/null
  log "Backend stopped (PID $BACKEND_PID)"
else
  warn "Backend was not running"
fi

echo ""
echo "Juggler stopped. (Cloud SQL Proxy left running on port 3307)"
echo ""
