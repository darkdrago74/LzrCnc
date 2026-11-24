#!/usr/bin/env bash
# LzrCnc launcher for Linux (Debian / Ubuntu / Raspberry Pi OS / Fedora ...).
#
#   lzrcnc            start LzrCnc (UI + API on one port, default 3001)
#   lzrcnc sim        same, with the built-in GRBL simulator (no hardware)
#   lzrcnc dev        developer mode: Vite on :3000 (hot reload) + API on :3001
#   lzrcnc build      rebuild the web UI
#   lzrcnc stop       stop a running LzrCnc started from a terminal
#   lzrcnc status     show whether LzrCnc answers
#
# Environment: LZRCNC_PORT (default 3001).

set -u

# Resolve the real project folder even when called through /usr/local/bin/lzrcnc
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")" && pwd)"
SOFT="$ROOT/soft"
PORT="${LZRCNC_PORT:-3001}"
DEV_PORT=3000
CMD="${1:-start}"

info() { echo "[lzrcnc] $*"; }
die()  { echo "[lzrcnc] ERROR: $*" >&2; exit 1; }

[ -d "$SOFT" ] || die "soft/ folder not found next to $SELF"

lan_ip() {
    hostname -I 2>/dev/null | cut -d' ' -f1 || true
}

# Node >= 20.19 (or >= 22.12) is required by Vite 7
check_node() {
    command -v node >/dev/null 2>&1 || die "Node.js is not installed. Run: sudo bash $ROOT/install/install.sh"
    command -v npm  >/dev/null 2>&1 || die "npm is not installed. Run: sudo bash $ROOT/install/install.sh"
    local v major minor
    v="$(node -v | sed 's/^v//')"
    major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
    if [ "$major" -lt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -lt 19 ]; } || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; } || [ "$major" -eq 21 ]; then
        die "Node.js v$v is too old (need 20.19+ or 22.12+). Run: sudo bash $ROOT/install/install.sh"
    fi
}

ensure_deps() {
    local stamp="$SOFT/node_modules/.package-lock.json"
    if [ ! -f "$stamp" ] || [ ! -d "$SOFT/server/node_modules" ] || [ "$SOFT/package-lock.json" -nt "$stamp" ]; then
        info "Installing dependencies (first start or package update)..."
        (cd "$SOFT" && npm install --no-audit --no-fund) || die "npm install failed"
        touch "$stamp"
    fi
}

ensure_build() {
    local index="$SOFT/client/dist/index.html"
    if [ "${1:-}" != "force" ] && [ -f "$index" ] \
        && [ -z "$(find "$SOFT/client/src" "$SOFT/client/index.html" "$SOFT/client/public" "$SOFT/client/package.json" -newer "$index" -print -quit 2>/dev/null)" ]; then
        return 0
    fi
    info "Building the web UI (can take a few minutes on a Raspberry Pi)..."
    (cd "$SOFT" && npm run build:fast --workspace=client) || die "client build failed"
}

port_pids() {
    local p="$1"
    {
        if command -v lsof >/dev/null 2>&1; then
            lsof -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null
        elif command -v ss >/dev/null 2>&1; then
            ss -ltnpH "sport = :$p" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2
        elif command -v fuser >/dev/null 2>&1; then
            fuser "$p/tcp" 2>/dev/null | tr -s ' ' '\n'
        fi
    } | grep -E '^[0-9]+$' | sort -u
}

port_busy() {
    if command -v ss >/dev/null 2>&1; then
        [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]
    else
        [ -n "$(port_pids "$1")" ]
    fi
}

# Stop a stale LzrCnc (node) process holding a port; never kill unrelated programs.
free_port() {
    local p="$1" pid name
    for pid in $(port_pids "$p"); do
        name="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
        case "$name" in
            node|npm*|tsx*|MainThread|esbuild)
                info "Port $p is used by an old LzrCnc process (PID $pid, $name) - stopping it."
                kill "$pid" 2>/dev/null || true
                for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
                kill -9 "$pid" 2>/dev/null || true
                ;;
            *)
                die "Port $p is used by another program ($name, PID $pid). Stop it or set LZRCNC_PORT."
                ;;
        esac
    done
    if port_busy "$p"; then
        die "Port $p is still in use (owned by another user or a service). Try: lzrcnc stop, or sudo systemctl stop lzrcnc"
    fi
}

service_active() {
    command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet lzrcnc 2>/dev/null
}

banner() {
    local ip; ip="$(lan_ip)"
    echo "=========================================="
    echo "  LzrCnc $1"
    echo "  Open: http://localhost:$2"
    [ -n "$ip" ] && echo "        http://$ip:$2  (other devices on the network)"
    echo "  Stop: Ctrl+C"
    echo "=========================================="
}

run_server() {
    local mode="$1"
    if service_active; then
        info "LzrCnc is already running as a system service: http://localhost:$PORT"
        info "Use 'sudo systemctl restart lzrcnc' / 'sudo systemctl stop lzrcnc' to control it."
        exit 0
    fi
    check_node
    ensure_deps
    ensure_build
    free_port "$PORT"
    cd "$SOFT/server" || die "soft/server not found"
    export PORT NODE_ENV=production
    if [ "$mode" = "sim" ]; then
        export MOCK_HARDWARE=true
        banner "(simulator - no hardware)" "$PORT"
    else
        banner "" "$PORT"
    fi
    exec node --disable-warning=DEP0205 --import tsx src/index.ts
}

case "$CMD" in
    start|"")
        run_server normal ;;
    sim)
        run_server sim ;;
    dev)
        check_node
        ensure_deps
        free_port "$DEV_PORT"
        free_port 3001
        banner "(developer mode)" "$DEV_PORT"
        cd "$SOFT" && exec npm run dev ;;
    build)
        check_node
        ensure_deps
        ensure_build force ;;
    stop)
        if service_active; then
            info "LzrCnc runs as a system service - stop it with: sudo systemctl stop lzrcnc"
            exit 1
        fi
        free_port "$PORT"
        free_port "$DEV_PORT"
        info "Stopped." ;;
    status)
        if command -v curl >/dev/null 2>&1 && curl -fsS "http://localhost:$PORT/ping" 2>/dev/null; then
            echo; info "Running on http://localhost:$PORT"
        else
            info "Not running on port $PORT"; exit 1
        fi ;;
    -h|--help|help)
        sed -n '2,12p' "$SELF" | sed 's/^# \{0,1\}//' ;;
    *)
        die "Unknown command '$CMD' (use: start | sim | dev | build | stop | status)" ;;
esac
