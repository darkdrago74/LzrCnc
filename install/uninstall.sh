#!/bin/bash

# Default mode
MODE="soft"
AUTO_YES=false

# Critical system packages that should NEVER be removed automatically
# even if they are in requirement-simple.txt
CRITICAL_PACKAGES=("sudo" "git" "systemd" "udev" "python3" "bash" "openssh-server" "nodejs" "npm")

# Parse arguments
for arg in "$@"; do
    case $arg in
        --all)
        MODE="all"
        shift
        ;;
        --soft)
        MODE="soft"
        shift
        ;;
        --clean)
        MODE="soft"
        shift
        ;;
        -y)
        AUTO_YES=true
        shift
        ;;
    esac
done

# Function to prompt confirmation
confirm() {
    if [ "$AUTO_YES" = true ]; then
        return 0
    fi
    read -p "$1 [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY]) 
            return 0 
            ;;
        *)
            return 1
            ;;
    esac
}

echo "Starting Uninstall (Mode: $MODE)..."

# 0. Kill running processes
echo "Checking for running processes..."

# Stop Systemd Service if exists
if systemctl list-unit-files | grep -q lzrcnc.service; then
    echo "Stopping and disabling systemd service..."
    systemctl stop lzrcnc
    systemctl disable lzrcnc
    rm -f /etc/systemd/system/lzrcnc.service
    systemctl daemon-reload
    echo "Service removed."
fi

pids=$(lsof -t -i:3000)
if [ -n "$pids" ]; then
    echo "Stopping active server processes..."
    kill -9 $pids 2>/dev/null || true
fi

# 1. Soft Uninstall (Project files)
echo "Removing project dependencies and build artifacts..."
rm -rf node_modules
rm -rf server/node_modules
rm -rf server/dist
rm -rf client/node_modules
rm -rf client/dist
rm -rf client/.next
rm -rf client/out

# Remove logs
rm -rf logs
rm -f *.log
rm -f *.pid

echo "Project cleanup complete."

# 2. All Uninstall (System packages)
if [ "$MODE" = "all" ]; then
    echo "WARNING: You have selected --all mode."
    echo "This will attempt to remove system packages listed in requirement-simple.txt."
    
    if confirm "Are you sure you want to remove system packages?"; then
        if [ -f "requirement-simple.txt" ]; then
            while IFS= read -r package || [ -n "$package" ]; do
                [[ $package =~ ^#.* ]] && continue
                [ -z "$package" ] && continue
                
                # Check if package is critical
                IS_CRITICAL=0
                for crit in "${CRITICAL_PACKAGES[@]}"; do
                    if [ "$package" == "$crit" ]; then
                        IS_CRITICAL=1
                        break
                    fi
                done

                if [ $IS_CRITICAL -eq 1 ]; then
                    echo "SKIP: $package is a critical system package. Keeping it."
                    continue
                fi

                echo "Removing $package..."
                if command -v apt-get &> /dev/null; then
                    apt-get remove -y "$package"
                else
                    echo "apt-get not found, skipping removal of $package"
                fi
            done < "requirement-simple.txt"
            
            echo "System package removal complete."
        else
            echo "requirement-simple.txt not found, cannot remove system packages."
        fi
    else
        echo "Skipping system package removal."
    fi
fi

echo "Uninstallation Complete."
