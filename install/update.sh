#!/usr/bin/env bash
# LzrCnc update: pull the latest code (git checkouts), refresh packages, rebuild the UI.
# Usage: bash install/update.sh      (also called by Settings -> System Updates)
# User data in soft/server/data is never touched.

set -u
INSTALL_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
SOFT="$ROOT/soft"
LOG_FILE="$INSTALL_DIR/update.log"
: > "$LOG_FILE"

log() { echo "[$1] $2"; echo "[$(date '+%F %T')] [$1] $2" >> "$LOG_FILE"; }

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    log "ERROR" "Run update.sh as your normal user (not with sudo), so files keep the right owner."
    exit 1
fi

cd "$ROOT" || exit 1
if [ -d .git ]; then
    log "INFO" "Pulling changes..."
    git pull --ff-only >> "$LOG_FILE" 2>&1 || { log "ERROR" "git pull failed (local changes?). See $LOG_FILE"; exit 1; }
    log "INFO" "Now at $(git rev-parse --short HEAD)"
else
    log "INFO" "Not a git checkout - skipping download (copy the new files over this folder, then re-run)."
fi

cd "$SOFT" || exit 1
log "INFO" "Installing packages..."
npm install --no-audit --no-fund >> "$LOG_FILE" 2>&1 || { log "ERROR" "npm install failed. See $LOG_FILE"; exit 1; }
log "INFO" "Building the web UI..."
npm run build:fast --workspace=client >> "$LOG_FILE" 2>&1 || { log "ERROR" "Build failed. See $LOG_FILE"; exit 1; }

log "SUCCESS" "Update complete. Restart LzrCnc (lzrcnc, or: sudo systemctl restart lzrcnc)."
