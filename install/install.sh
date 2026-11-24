#!/usr/bin/env bash
# LzrCnc installer for Linux
#   Debian / Ubuntu / Raspberry Pi OS (apt) and Fedora / RHEL-like (dnf).
#
# Usage:  sudo bash install/install.sh [--service | --no-service]
#   --service     start LzrCnc automatically at boot (systemd)
#   --no-service  do not ask about the boot service
# (AUTOBOOT=y|n is also accepted for backwards compatibility.)

set -u

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
INSTALL_DIR="$(dirname "$SELF")"
ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
SOFT="$ROOT/soft"
PORT=3001
LOG_FILE="$INSTALL_DIR/install_report.log"
NODE_MAJOR=22          # LTS line installed when Node is missing / too old

SERVICE_CHOICE="${AUTOBOOT:-}"
for arg in "$@"; do
    case "$arg" in
        --service) SERVICE_CHOICE=y ;;
        --no-service) SERVICE_CHOICE=n ;;
        -h|--help) sed -n '2,9p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root:  sudo bash $SELF"
    exit 1
fi

TARGET_USER="${SUDO_USER:-root}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
TARGET_GROUP="$(id -gn "$TARGET_USER")"

: > "$LOG_FILE"
log() {
    echo "[$1] $2"
    echo "[$(date '+%F %T')] [$1] $2" >> "$LOG_FILE"
}
fail() { log "FAILED" "$1"; echo "See $LOG_FILE"; exit 1; }

# Run a command as the real (non-root) user so node_modules are not owned by root
as_user() {
    if [ "$TARGET_USER" = "root" ]; then
        "$@"
    else
        runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" PATH="$PATH" "$@"
    fi
}

log "INFO" "LzrCnc install - project: $ROOT - user: $TARGET_USER"

# ---------------------------------------------------------------- 1. system packages
if command -v apt-get >/dev/null 2>&1; then
    PKG=apt
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >> "$LOG_FILE" 2>&1 || log "WARNING" "apt-get update failed"
    PACKAGES="ca-certificates curl git xz-utils build-essential python3 iproute2 lsof"
    # shellcheck disable=SC2086
    apt-get install -y $PACKAGES >> "$LOG_FILE" 2>&1 || fail "apt-get install $PACKAGES"
elif command -v dnf >/dev/null 2>&1; then
    PKG=dnf
    PACKAGES="ca-certificates curl git xz gcc-c++ make python3 iproute lsof findutils procps-ng"
    # shellcheck disable=SC2086
    dnf install -y $PACKAGES >> "$LOG_FILE" 2>&1 || fail "dnf install $PACKAGES"
else
    PKG=none
    log "WARNING" "No apt-get or dnf found: install curl, git, a C++ compiler and Node.js 22 yourself."
fi
log "INSTALLED" "system packages ($PKG)"

# ---------------------------------------------------------------- 2. Node.js
node_ok() {
    command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
    local v major minor
    v="$(node -v | sed 's/^v//')"; major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
    [ "$major" -ge 23 ] && return 0
    [ "$major" -eq 22 ] && [ "$minor" -ge 12 ] && return 0
    [ "$major" -eq 20 ] && [ "$minor" -ge 19 ] && return 0
    return 1
}

# Official nodejs.org binaries: works on any distro (x64, arm64, armv7l)
install_node_tarball() {
    local arch file url
    case "$(uname -m)" in
        x86_64)  arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        armv7l)  arch=armv7l ;;
        armv6l)  fail "ARMv6 (Raspberry Pi Zero / 1) is not supported by Node.js 20+. Use a Pi 3/4/5 or Zero 2 with a 64-bit OS." ;;
        *)       fail "Unsupported CPU $(uname -m) for Node.js binaries" ;;
    esac
    url="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
    file="$(curl -fsSL "$url/SHASUMS256.txt" | sed 's/^[0-9a-f]* *//' | grep -E "^node-v[0-9.]+-linux-${arch}\.tar\.xz$" | head -1)"
    [ -n "$file" ] || fail "Could not find a Node.js $NODE_MAJOR download for linux-$arch"
    log "INFO" "Downloading $file"
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL "$url/$file" -o "$tmp/$file" || fail "download $file"
    (cd "$tmp" && curl -fsSL "$url/SHASUMS256.txt" | grep " $file\$" | sha256sum -c -) >> "$LOG_FILE" 2>&1 || fail "checksum of $file"
    tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --no-same-owner || fail "extract $file"
    rm -rf "$tmp"
    hash -r
}

if node_ok; then
    log "CHECK" "Node.js $(node -v) is OK"
else
    log "INFO" "Node.js missing or older than 20.19 - installing Node.js $NODE_MAJOR"
    [ "${LZRCNC_NODE_TARBALL:-}" = "1" ] && PKG_NODE=none || PKG_NODE="$PKG"
    case "$PKG_NODE" in
        apt)
            if [ "$(uname -m)" = "x86_64" ] || [ "$(uname -m)" = "aarch64" ]; then
                if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >> "$LOG_FILE" 2>&1 \
                    && apt-get install -y nodejs >> "$LOG_FILE" 2>&1; then
                    log "INSTALLED" "Node.js $(node -v) (NodeSource)"
                fi
            fi ;;
        dnf)
            dnf install -y nodejs npm >> "$LOG_FILE" 2>&1 || true
            node_ok || dnf install -y "nodejs${NODE_MAJOR}" "nodejs${NODE_MAJOR}-npm" >> "$LOG_FILE" 2>&1 || true ;;
    esac
    hash -r
    if ! node_ok; then
        install_node_tarball
    fi
    node_ok || fail "Node.js installation (found: $(node -v 2>/dev/null || echo none))"
    log "INSTALLED" "Node.js $(node -v) at $(command -v node)"
fi
NODE_BIN="$(command -v node)"

# ---------------------------------------------------------------- 3. app dependencies + build
[ -f "$SOFT/package.json" ] || fail "soft/package.json not found (is the project complete?)"
chown -R "$TARGET_USER:$TARGET_GROUP" "$ROOT"
chmod +x "$ROOT"/*.sh "$INSTALL_DIR"/*.sh 2>/dev/null || true

log "INFO" "Installing npm packages (this can take several minutes on a Raspberry Pi)"
cd "$SOFT" || fail "cd $SOFT"
if ! as_user npm ci --no-audit --no-fund >> "$LOG_FILE" 2>&1; then
    log "WARNING" "npm ci failed, retrying with npm install"
    as_user npm install --no-audit --no-fund >> "$LOG_FILE" 2>&1 || fail "npm install"
fi
log "INSTALLED" "npm packages"

log "INFO" "Building the web UI"
as_user npm run build:fast --workspace=client >> "$LOG_FILE" 2>&1 || fail "client build"
log "BUILT" "client (soft/client/dist)"

# ---------------------------------------------------------------- 4. serial port access
SERIAL_GROUP=""
for g in dialout uucp; do getent group "$g" >/dev/null && { SERIAL_GROUP="$g"; break; }; done
if [ -n "$SERIAL_GROUP" ] && [ "$TARGET_USER" != "root" ]; then
    if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx "$SERIAL_GROUP"; then
        log "CHECK" "$TARGET_USER is in the '$SERIAL_GROUP' group (USB serial access)"
    else
        usermod -aG "$SERIAL_GROUP" "$TARGET_USER" && \
            log "ADDED" "$TARGET_USER to '$SERIAL_GROUP' for USB serial access (log out/in to apply)"
    fi
fi

# ---------------------------------------------------------------- 5. global command
ln -sf "$ROOT/lzrcnc.sh" /usr/local/bin/lzrcnc && log "CREATED" "command 'lzrcnc' (/usr/local/bin/lzrcnc)"

# ---------------------------------------------------------------- 6. firewall (Fedora)
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port=${PORT}/tcp >> "$LOG_FILE" 2>&1 && firewall-cmd --reload >> "$LOG_FILE" 2>&1 \
        && log "OPENED" "firewall port $PORT/tcp"
fi

# ---------------------------------------------------------------- 7. boot service
if [ -z "$SERVICE_CHOICE" ]; then
    if [ -t 0 ]; then
        read -r -p "Start LzrCnc automatically at boot (systemd service)? [y/N] " SERVICE_CHOICE
    else
        SERVICE_CHOICE=n
    fi
fi
if [[ "$SERVICE_CHOICE" =~ ^([yY]|[yY][eE][sS])$ ]]; then
    if [ ! -d /run/systemd/system ]; then
        log "SKIPPED" "systemd is not running on this system - start LzrCnc with 'lzrcnc'"
    else
        SUPP=""
        [ -n "$SERIAL_GROUP" ] && SUPP="SupplementaryGroups=$SERIAL_GROUP"
        cat > /etc/systemd/system/lzrcnc.service <<EOT
[Unit]
Description=LzrCnc laser / CNC server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
WorkingDirectory=$SOFT/server
Environment=PORT=$PORT
Environment=NODE_ENV=production
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin
$SUPP
ExecStart=$NODE_BIN --disable-warning=DEP0205 --import tsx src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOT
        systemctl daemon-reload
        systemctl enable --now lzrcnc >> "$LOG_FILE" 2>&1 && log "ENABLED" "systemd service 'lzrcnc' (sudo systemctl status lzrcnc)"
    fi
else
    log "SKIPPED" "boot service (start manually with: lzrcnc)"
fi

IP="$(hostname -I 2>/dev/null | cut -d' ' -f1)"
echo
echo "=========================================="
echo " LzrCnc installed."
echo "   Start:  lzrcnc        (or: lzrcnc sim  for the simulator)"
echo "   Open:   http://localhost:$PORT  ${IP:+ / http://$IP:$PORT}"
echo "   Report: $LOG_FILE"
echo "=========================================="
