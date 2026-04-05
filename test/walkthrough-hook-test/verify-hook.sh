#!/usr/bin/env bash
# Verifies the walkthrough hook pauses on failure and resumes on continue signal.

set -e

HOOK_PATH="$(cd "$(dirname "$0")/../../.claude/skills/walkthrough" && pwd)/walkthrough-hooks.js"
SPEC_PATH="$(dirname "$0")/sample-failing.spec.js"
SIGNAL_DIR="$(pwd)/.walkthrough"

echo "=== Walkthrough Hook Verification ==="
echo "Hook: $HOOK_PATH"
echo "Spec: $SPEC_PATH"

# Clean up from previous runs
rm -rf "$SIGNAL_DIR"

# Run mocha in background with the hook
npx mocha "$SPEC_PATH" --require "$HOOK_PATH" --timeout 30000 &
MOCHA_PID=$!

echo "Mocha running (PID: $MOCHA_PID)"

# Wait for pause signal (poll every 1s, timeout after 15s)
WAITED=0
while [ ! -f "$SIGNAL_DIR/paused.json" ] && [ $WAITED -lt 15 ]; do
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ ! -f "$SIGNAL_DIR/paused.json" ]; then
    echo "FAIL: paused.json was not created within 15s"
    kill $MOCHA_PID 2>/dev/null
    exit 1
fi

echo "PASS: paused.json created"
cat "$SIGNAL_DIR/paused.json"

# Verify status is paused
if grep -q '"state":"paused"' "$SIGNAL_DIR/status.json" 2>/dev/null || \
   grep -q '"state": "paused"' "$SIGNAL_DIR/status.json" 2>/dev/null; then
    echo "PASS: status.json shows paused"
else
    echo "FAIL: status.json does not show paused state"
    kill $MOCHA_PID 2>/dev/null
    exit 1
fi

# Signal continue
touch "$SIGNAL_DIR/continue"
echo "Signaled continue"

# Wait for mocha to finish (non-zero expected — one test deliberately fails)
wait $MOCHA_PID || true

# Mocha exits non-zero because one test failed — that's expected
if [ -f "$SIGNAL_DIR/status.json" ]; then
    if grep -q '"done"' "$SIGNAL_DIR/status.json"; then
        echo "PASS: status.json shows done"
    fi
fi

echo ""
echo "=== All hook verifications passed ==="

# Cleanup
rm -rf "$SIGNAL_DIR"
