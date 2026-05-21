#!/bin/bash

# Validation Agent Script
# Performs: Uninstall (All) -> Install -> Start -> Verify -> Stop

set -e

LOG_FILE="validation_run.log"

echo "=========================================="
echo "Starting Validation Agent..."
echo "=========================================="

# 1. Uninstall Everything
echo "[Step 1] Creating a clean state..."
if [ -f "./uninstall.sh" ]; then
    # Passing -y to skip confirmation
    # Use --soft by default for safety during dev, but user requested FULL validation.
    # To follow rule "Validation process is : fully uninstall, full reinstallation"
    # we MUST use --all.
    # However, to avoid destroying the dev environment if run repeatedly by accident, 
    # we rely on the safelist in uninstall.sh.
    sudo ./uninstall.sh --all -y
else
    echo "Error: uninstall.sh not found."
    exit 1
fi

# 2. Install Everything
echo "[Step 2] Installing application..."
if [ -f "./install.sh" ]; then
    sudo AUTOBOOT=no ./install.sh
else
    echo "Error: install.sh not found."
    exit 1
fi

# 3. Start Server & Client
echo "[Step 3] Starting application for validation..."

# Start in background
# We assume 'npm start' launches both server (3000) and client (5173 or similar)
npm start > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "Process ID: $SERVER_PID"

# 4. Wait for Startup (Robust Wait)
echo "[Step 4] Waiting for server to initialize..."

MAX_RETRIES=30
COUNT=0
URL="http://localhost:3000/ping"

while [ $COUNT -lt $MAX_RETRIES ]; do
    if curl -s "$URL" > /dev/null; then
        echo "Server is up!"
        break
    fi
    echo "Waiting for server... ($COUNT/$MAX_RETRIES)"
    sleep 2
    COUNT=$((COUNT+1))
done

if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Timeout waiting for server to start."
    echo "Last 50 lines of log:"
    tail -n 50 "$LOG_FILE"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# 5. Verify Health
echo "[Step 5] Verify endpoints..."

RESPONSE=$(curl -s "$URL")
echo "Response: $RESPONSE"

if [[ "$RESPONSE" == *"ok"* ]]; then
    echo "✅ Server returned 'ok'"
else
    echo "❌ Server response unexpected: $RESPONSE"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi


# ... (Previous steps)

echo "✅ Direct 'npm start' validation passed."

# 6. Stop Server (First Run)
echo "[Step 6] Stopping server (Run 1)..."
kill $SERVER_PID 2>/dev/null || true
pkill -P $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# 7. Start via Global Command
echo "[Step 7] Testing global 'lzrcnc' command..."
if command -v lzrcnc &> /dev/null; then
    lzrcnc > "$LOG_FILE" 2>&1 &
    GLOBAL_PID=$!
    echo "Global CMD Process ID: $GLOBAL_PID"
else
    echo "❌ 'lzrcnc' command not found in PATH."
    exit 1
fi

# 8. Wait for Startup (Global)
echo "[Step 8] Waiting for server (Run 2)..."
COUNT=0
while [ $COUNT -lt $MAX_RETRIES ]; do
    if curl -s "$URL" > /dev/null; then
        echo "Server is up (Global Command)!"
        break
    fi
    sleep 2
    COUNT=$((COUNT+1))
done

if [ $COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Timeout waiting for global command server."
    echo "Last 50 lines of log:"
    tail -n 50 "$LOG_FILE"
    kill $GLOBAL_PID 2>/dev/null || true
    exit 1
fi

# 9. Final Cleanup
echo "[Step 9] Stopping server (Run 2)..."
kill $GLOBAL_PID 2>/dev/null || true
pkill -P $GLOBAL_PID 2>/dev/null || true
wait $GLOBAL_PID 2>/dev/null || true

echo "=========================================="
echo "Validation Successful! (Both methods)"
echo "=========================================="

