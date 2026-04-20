#!/usr/bin/env bash
# Verify walkthrough hook works with WDIO tests against saucedemo.com.
# Expects 3 pause cycles (one per wrong selector).

HOOK_PATH=".claude/skills/walkthrough/walkthrough-hooks.js"
WDIO_SETUP="test/walkthrough-e2e-wdio/wdio-setup.js"
SPEC_PATH="test/walkthrough-e2e-wdio/login.spec.js"
SIGNAL_DIR=".walkthrough"

echo "=== WDIO Walkthrough Hook Verification ==="

rm -rf "$SIGNAL_DIR"

# Run mocha in background
npx mocha "$SPEC_PATH" --require "$HOOK_PATH" --require "$WDIO_SETUP" --timeout 60000 &
MOCHA_PID=$!
echo "Mocha PID: $MOCHA_PID"

FAILURES_CAUGHT=0

for i in 1 2 3; do
    # Wait for paused.json to appear (up to 30s per pause)
    WAITED=0
    while [ ! -f "$SIGNAL_DIR/paused.json" ] && [ $WAITED -lt 30 ]; do
        sleep 1
        WAITED=$((WAITED + 1))
    done

    if [ -f "$SIGNAL_DIR/paused.json" ]; then
        FAILURES_CAUGHT=$((FAILURES_CAUGHT + 1))
        echo ""
        echo "=== PAUSE $i ==="
        node -e "const p=require('./$SIGNAL_DIR/paused.json'); console.log('Test:', p.test); console.log('Error:', p.error.substring(0, 100))"
        touch "$SIGNAL_DIR/continue"
        echo "Signaled continue"
        # Let hook process the continue signal before polling again
        sleep 2
    else
        echo "WARN: pause $i not detected within 30s"
        break
    fi
done

# Wait for mocha to finish (non-zero expected — tests deliberately fail)
wait $MOCHA_PID || true

echo ""
echo "=== RESULT ==="
echo "Caught $FAILURES_CAUGHT/3 failures"

if [ -f "$SIGNAL_DIR/status.json" ]; then
    echo "Final status: $(cat "$SIGNAL_DIR/status.json")"
fi

if [ $FAILURES_CAUGHT -eq 3 ]; then
    echo ""
    echo "=== All WDIO verifications passed ==="
fi

rm -rf "$SIGNAL_DIR"

echo ""
echo "=== Smoke testing debug-gui ==="
bash packages/debug-gui/test/smoke.sh
