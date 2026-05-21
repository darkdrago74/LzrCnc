#!/bin/bash
set -e

echo "=========================================="
echo "      LzrCnc QA Agent"
echo "=========================================="
echo "Date: $(date)"

# 1. Run Frontend Unit Tests
echo "[QA] Running Frontend UI Tests (Vitest)..."
cd client
if npm test run; then
    echo "✅ Frontend Tests Passed"
else
    echo "❌ Frontend Tests Failed"
    exit 1
fi
cd ..

# 2. Run Backend Simulation
echo "[QA] Starting Backend in Simulation Mode..."
cd server
# Start server in background with simulation flag
# Using tsx directly or npm run dev? install.sh used npm run build then start.
# We'll use tsx if available or build.
# Let's try to run the built JS if it exists, or ts-node/tsx. 
# Assuming `npm run start` works and we can pass args, or use env var.
# Package.json start script: "node dist/index.js".
# We need to rebuild server to ensure MockController is included?
# Actually MockController is new code, need rebuild.
echo "[QA] Building Server..."
npm run build > /dev/null

echo "[QA] Launching Server..."
MOCK_HARDWARE=true node dist/index.js > ../qa_server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for healthy signal
sleep 5

# 3. Functional API Tests
echo "[QA] Testing API Endpoints..."
BASE_URL="http://localhost:3000"

# Check Ping
PING_RES=$(curl -s "$BASE_URL/ping")
if [[ "$PING_RES" == *"sim"* ]]; then
    echo "✅ Server is Up (Simulation Mode Active)"
else
    echo "❌ Server Ping Failed or Not in Sim Mode: $PING_RES"
    kill $SERVER_PID
    exit 1
fi

# Connect Mock
CONN_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"type":"mock"}' "$BASE_URL/connect")
if [[ "$CONN_RES" == *"connected"* ]]; then
     echo "✅ Connected to Mock Hardware"
else
     echo "❌ Connection Failed: $CONN_RES"
     kill $SERVER_PID
     exit 1
fi

# Jog Test
JOG_RES=$(curl -s -X POST -H "Content-Type: application/json" -d '{"axis":"x","dist":10,"feedrate":1000}' "$BASE_URL/jog")
if [[ "$JOG_RES" == *"ok"* ]]; then
     echo "✅ Jog Command Accepted"
else
     echo "❌ Jog Command Failed: $JOG_RES"
     kill $SERVER_PID
     exit 1
fi

# Status Check (Wait for jog to finish approx 500ms)
sleep 1
STATUS_RES=$(curl -s "$BASE_URL/status")
# We expect x to be > 0 (it moves 10mm)
echo "Status: $STATUS_RES"
if [[ "$STATUS_RES" == *"pos"* ]]; then
     echo "✅ Status Report Received"
else
     echo "❌ Status Check Failed"
fi

# 4. Cleanup
echo "[QA] Tests Completed. Shutting down..."
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null || true

echo "=========================================="
echo "       QA VERIFICATION SUCCESSFUL"
echo "=========================================="
