#!/usr/bin/env bash
# End-to-end check of the Linux scripts:
#   install (no service) -> lzrcnc sim -> /ping + web UI -> lzrcnc stop
# Usage: sudo bash install/validate.sh

set -eu
INSTALL_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
PORT=3001
USER_NAME="${SUDO_USER:-root}"
LOG="$INSTALL_DIR/validation_run.log"

run_user() {
    if [ "$USER_NAME" = root ]; then "$@"; else runuser -u "$USER_NAME" -- "$@"; fi
}

SERVICE_WAS_ACTIVE=false
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet lzrcnc 2>/dev/null; then
    echo "Pausing the lzrcnc service during the test..."
    systemctl stop lzrcnc; SERVICE_WAS_ACTIVE=true
fi
restore_service() { if $SERVICE_WAS_ACTIVE; then systemctl start lzrcnc; fi; }
trap restore_service EXIT

echo "[1/4] Installing..."
bash "$INSTALL_DIR/install.sh" --no-service

echo "[2/4] Starting 'lzrcnc sim'..."
run_user bash "$ROOT/lzrcnc.sh" sim > "$LOG" 2>&1 &

echo "[3/4] Waiting for the server..."
ok=false
for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:$PORT/ping" 2>/dev/null | grep -q '"sim":true'; then ok=true; break; fi
    sleep 2
done
if ! $ok; then
    echo "FAILED: server did not answer on :$PORT"; tail -n 40 "$LOG"
    run_user bash "$ROOT/lzrcnc.sh" stop || true
    exit 1
fi
curl -fsS "http://localhost:$PORT/" | grep -qi '<!doctype html' || { echo "FAILED: web UI not served"; exit 1; }
echo "  /ping OK, web UI OK"

echo "[4/4] Stopping..."
run_user bash "$ROOT/lzrcnc.sh" stop
echo "Validation successful."
