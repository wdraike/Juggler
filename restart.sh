#!/bin/bash
# Kill existing servers and restart in daemon mode
# Usage: ./restart.sh [backend|frontend|both]

DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-both}"

kill_port() {
  local port=$1
  local pids=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Killing processes on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null
    sleep 1
  fi
}

if [ "$TARGET" = "backend" ] || [ "$TARGET" = "both" ]; then
  kill_port 5002
  echo "Starting backend on port 5002..."
  cd "$DIR/juggler-backend"
  nohup node src/server.js > /tmp/juggler-backend.log 2>&1 &
  echo "  PID: $! — log: /tmp/juggler-backend.log"
fi

if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "both" ]; then
  kill_port 3001
  echo "Starting frontend on port 3001..."
  cd "$DIR/juggler-frontend"
  nohup npx react-scripts start > /tmp/juggler-frontend.log 2>&1 &
  echo "  PID: $! — log: /tmp/juggler-frontend.log"
fi

sleep 2
echo ""
echo "Status:"
lsof -i :5002 -i :3001 2>/dev/null | grep LISTEN
