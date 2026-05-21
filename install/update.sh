#!/bin/bash

# LzrCnc Update Script
# Usage: ./update.sh

LOG_FILE="$(pwd)/update.log"
echo "==========================================" > "$LOG_FILE"
echo "LzrCnc Update Process: $(date)" >> "$LOG_FILE"
echo "==========================================" >> "$LOG_FILE"

log() {
    local level=$1
    local msg=$2
    echo "[$level] $msg"
    echo "[$level] $msg" >> "$LOG_FILE"
}

# Ensure we are in the project root
cd "$(dirname "$0")"

# 1. Git Pull
log "INFO" "Pulling changes from origin..."
# Fetch first to ensure we know about upstream
if git fetch; then
    if git pull; then
        log "INFO" "Git pull successful."
    else
        log "ERROR" "Git pull failed. You may have local changes that conflict."
        exit 1
    fi
else
    log "ERROR" "Git fetch failed. Check internet connection."
    exit 1
fi

# 2. Install Dependencies (Root)
log "INFO" "Installing dependencies..."
if npm install; then
    log "INFO" "Dependencies installed."
else
    log "ERROR" "npm install failed."
    exit 1
fi

# 3. Build Project
log "INFO" "Building project..."
if npm run build; then
    log "INFO" "Build successful."
else
    log "ERROR" "Build failed."
    exit 1
fi

log "SUCCESS" "Update complete."
