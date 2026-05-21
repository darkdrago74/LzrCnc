#!/bin/bash
# LzrCnc Smart Startup Script

# Hardcoded Project Path
PROJECT_DIR="/home/roro/Documents/LzrCnc"
PORT=3001
HEALTH_URL="http://localhost:$PORT/ping"

# Ensure tools are available
if ! command -v curl &> /dev/null || ! command -v lsof &> /dev/null; then
    echo "Error: Required tools 'curl' or 'lsof' not found."
    exit 1
fi

cd "$PROJECT_DIR" || { echo "Error: Project directory not found."; exit 1; }

# Function to check and free a port
check_and_free_port() {
    local target_port=$1
    local pid=$(lsof -t -i:$target_port -sTCP:LISTEN)

    if [ -n "$pid" ]; then
        echo "Port $target_port is in use by PID $pid."
        # Auto-kill for consistency with Windows "Smart Start"
        echo "Auto-killing blocking process (PID $pid)..."
        kill -9 "$pid"
        sleep 1
    fi
}

echo "Checking ports..."
check_and_free_port 3000
check_and_free_port 3001

echo "Starting LzrCnc Server..."
cd soft || { echo "Error: soft directory not found."; exit 1; }
npm run dev
