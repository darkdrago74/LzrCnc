#!/usr/bin/env bash
# LzrCnc uninstall
#   sudo bash install/uninstall.sh         remove service, command, packages and build (keeps your settings)
#   sudo bash install/uninstall.sh --all   also delete your settings (soft/server/data)
#   -y                                     do not ask for confirmation
# Node.js and system packages are left installed (other programs may use them).

set -u
INSTALL_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
SOFT="$ROOT/soft"
PORT=3001
ALL=false
YES=false
for arg in "$@"; do
    case "$arg" in
        --all) ALL=true ;;
        --soft|--clean) ALL=false ;;
        -y) YES=true ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root:  sudo bash $0 $*"
    exit 1
fi

confirm() {
    $YES && return 0
    read -r -p "$1 [y/N] " r
    [[ "$r" =~ ^([yY]|[yY][eE][sS])$ ]]
}

if [ -f /etc/systemd/system/lzrcnc.service ]; then
    echo "Removing the systemd service..."
    systemctl disable --now lzrcnc 2>/dev/null || true
    rm -f /etc/systemd/system/lzrcnc.service
    systemctl daemon-reload 2>/dev/null || true
fi

if [ -x "$ROOT/lzrcnc.sh" ]; then
    LZRCNC_PORT=$PORT bash "$ROOT/lzrcnc.sh" stop >/dev/null 2>&1 || true
fi

if [ -L /usr/local/bin/lzrcnc ]; then
    rm -f /usr/local/bin/lzrcnc
    echo "Removed the 'lzrcnc' command."
fi

if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --remove-port=${PORT}/tcp >/dev/null 2>&1 && firewall-cmd --reload >/dev/null 2>&1 || true
fi

echo "Removing npm packages and build output..."
rm -rf "$SOFT/node_modules" "$SOFT/server/node_modules" "$SOFT/client/node_modules" \
       "$SOFT/server/dist" "$SOFT/client/dist"
rm -f "$INSTALL_DIR"/*.log

if $ALL; then
    if confirm "Also delete your machine settings, tools and materials (soft/server/data)?"; then
        rm -rf "$SOFT/server/data"
        echo "User data deleted."
    fi
else
    echo "Your settings in soft/server/data were kept."
fi

echo "Uninstall complete. Node.js and system packages were left installed."
