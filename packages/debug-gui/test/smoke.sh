#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BIN="$REPO_ROOT/packages/debug-gui/bin/debug-gui.js"

# ── Test 1: boot against the repo root, confirm /api/init returns suites ──
PORT=5556
PORT=$PORT DEBUG_GUI_NO_OPEN=1 node "$BIN" &
PID=$!
trap "kill $PID 2>/dev/null || true" EXIT
sleep 3

RESP=$(curl -sf "http://localhost:$PORT/api/init")
echo "$RESP" | grep -q '"suites"' || { echo "FAIL: no suites in response"; echo "$RESP"; exit 1; }
echo "SMOKE OK: /api/init returned suites"

echo "$RESP" | grep -q '"mode":"auto"' \
    || { echo "FAIL: expected agent.mode=auto default in /api/init"; echo "$RESP"; exit 1; }
echo "SMOKE OK: /api/init defaults agent.mode to auto"

kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
trap - EXIT

# ── Test 2: preRun surfaces via /api/init when configured in package.json ──
TMP_PROJECT=$(mktemp -d -t dbg-smoke-XXXXXX)
trap "kill \$PID2 2>/dev/null || true; rm -rf '$TMP_PROJECT'" EXIT

cat > "$TMP_PROJECT/package.json" <<'PKG'
{
  "debug-gui": { "preRun": "echo pre-run-ok" }
}
PKG

PORT2=5557
(cd "$TMP_PROJECT" && PORT=$PORT2 DEBUG_GUI_NO_OPEN=1 node "$BIN") &
PID2=$!
sleep 3

RESP2=$(curl -sf "http://localhost:$PORT2/api/init")
echo "$RESP2" | grep -q '"preRun":"echo pre-run-ok"' \
    || { echo "FAIL: preRun not surfaced via /api/init"; echo "$RESP2"; exit 1; }
echo "SMOKE OK: /api/init surfaces configured preRun"

kill $PID2 2>/dev/null || true
wait $PID2 2>/dev/null || true
