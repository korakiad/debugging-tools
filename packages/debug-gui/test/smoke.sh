#!/usr/bin/env bash
set -euo pipefail

# Start server in background (assumes builds done)
PORT=5556
PORT=$PORT DEBUG_GUI_NO_OPEN=1 node packages/debug-gui/bin/debug-gui.js &
PID=$!
trap "kill $PID 2>/dev/null || true" EXIT
sleep 3

# Hit /api/init
RESP=$(curl -sf "http://localhost:$PORT/api/init")
echo "$RESP" | grep -q '"suites"' || { echo "FAIL: no suites in response"; echo "$RESP"; exit 1; }
echo "SMOKE OK: /api/init returned suites"

kill $PID 2>/dev/null || true
