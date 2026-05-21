# Check for root privileges
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./install.sh)"
  exit 1
fi

LOG_FILE="$(pwd)/install_report.log"

# Initialize Log
echo "==========================================" > "$LOG_FILE"
echo "LzrCnc Installation Report" >> "$LOG_FILE"
echo "Date: $(date)" >> "$LOG_FILE"
echo "==========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Logging Function
log_action() {
    local status="$1"
    local package="$2"
    local message="$3"
    local timestamp=$(date "+%H:%M:%S")
    
    # Print to console
    echo "[$status] $package: $message"
    
    # Append to log
    echo "[$timestamp] [$status] $package: $message" >> "$LOG_FILE"
}

echo "Installing LzrCnc Dependencies..."

# 1. Install System Dependencies from requirement-simple.txt
if [ -f "requirement-simple.txt" ]; then
    echo "Installing system packages from requirement-simple.txt..."
    # Read non-empty lines, skip comments if any
    while IFS= read -r package || [ -n "$package" ]; do
        [[ $package =~ ^#.* ]] && continue
        [ -z "$package" ] && continue
        
        # Smart Check for Node.js - SKIP here, handled specifically later
        if [ "$package" == "nodejs" ] || [ "$package" == "npm" ]; then
             continue
        fi

        # Determine package manager (assuming apt for Debian/RPi as per requirements)
        if command -v apt-get &> /dev/null; then
             # Try install
             if apt-get install -y "$package"; then
                 log_action "INSTALLED" "$package" "Successfully installed via apt-get."
             else
                 log_action "FAILED" "$package" "apt-get install failed."
             fi
        else
            log_action "FAILED" "$package" "apt-get not found."
        fi
    done < "requirement-simple.txt"
else
    log_action "WARNING" "requirement-simple.txt" "File not found."
fi

# 2. Check for Node.js Version (Need 20+)
# 2. Ensure Node.js v24 (via NodeSource)
REQUIRED_NODE_MAJOR=20
CURRENT_NODE_VALID=false

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    
    if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
        log_action "CHECK" "Node.js" "Version $NODE_VERSION is valid (>=20)."
        CURRENT_NODE_VALID=true
    else
        log_action "INFO" "Node.js" "Version $NODE_VERSION is too old. Upgrading..."
    fi
fi

if [ "$CURRENT_NODE_VALID" = false ]; then
    ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
    echo "Detected Architecture: $ARCH"

    NODE_MAJOR_VERSION="24"
    
    # Check for 32-bit ARM (armhf/armv7l)
    if [[ "$ARCH" == "armhf" || "$ARCH" == "armv7l" ]]; then
        echo "----------------------------------------------------------------"
        echo "WARNING: 32-bit ARM ($ARCH) detected."
        echo "Node.js 24 is not supported on 32-bit ARM by NodeSource."
        echo "RECOMMENDATION: Use Raspberry Pi OS 64-bit (arm64) for best performance."
        echo "----------------------------------------------------------------"
        echo "Falling back to Node.js 20 (LTS) for compatibility..."
        NODE_MAJOR_VERSION="20"
    fi

    echo "Installing Node.js v${NODE_MAJOR_VERSION} via NodeSource..."
    # 1. Download and run the setup script
    if curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR_VERSION}.x | bash -; then
        # 2. Install nodejs
        if apt-get install -y nodejs; then
            log_action "INSTALLED" "Node.js" "Successfully installed v${NODE_MAJOR_VERSION}."
        else
            log_action "FAILED" "Node.js" "apt-get install nodejs failed."
            exit 1
        fi
    else
        log_action "FAILED" "Node.js" "NodeSource setup script failed."
        exit 1
    fi
fi

# 3. Install Root Dependencies
echo "Installing Root Packages..."
if [ -f "package.json" ]; then
    if npm install; then
        log_action "INSTALLED" "npm-root" "Root dependencies installed."
    else
        log_action "FAILED" "npm-root" "npm install failed."
        exit 1
    fi
else 
    log_action "FAILED" "package.json" "Not found in root."
    exit 1
fi

# 4. Install Server Dependencies
echo "Installing Server Packages..."
if [ -d "server" ]; then
    cd server
    if npm install; then
        log_action "INSTALLED" "npm-server" "Server dependencies installed."
        # Build if script exists
        if npm run | grep -q "build"; then
            if npm run build; then
                log_action "BUILT" "server" "Build successful."
            else
                log_action "FAILED" "server" "Build failed."
            fi
        else
            log_action "SKIPPED" "server-build" "No build script found."
        fi
    else
        log_action "FAILED" "npm-server" "Server npm install failed."
        exit 1
    fi
    cd ..
else
    log_action "FAILED" "server-dir" "Directory not found."
    exit 1
fi

# 5. Install Client Dependencies
echo "Installing Client Packages..."
if [ -d "client" ]; then
    cd client
    if npm install; then
        log_action "INSTALLED" "npm-client" "Client dependencies installed."
        if npm run build; then
            log_action "BUILT" "client" "Client build successful."
        else
            log_action "FAILED" "client" "Client build failed."
        fi
    else
        log_action "FAILED" "npm-client" "Client npm install failed."
        exit 1
    fi
    cd ..
else
    log_action "FAILED" "client-dir" "Directory not found."
    exit 1
fi


# 6. Setup Autoboot (Systemd)
echo "------------------------------------------"
if [ -n "$AUTOBOOT" ]; then
    response="$AUTOBOOT"
else
    read -p "Do you want LzrCnc to start automatically on boot? [y/N] " response
fi
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Configuring Systemd Service..."
    
    SERVICE_FILE="/etc/systemd/system/lzrcnc.service"
    APP_DIR=$(pwd)
    USER_NAME=${SUDO_USER:-root}
    NODE_PATH=$(which node)
    
    # Create Service File
    cat <<EOT > "$SERVICE_FILE"
[Unit]
Description=LzrCnc Server
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=$NODE_PATH $APP_DIR/server/dist/index.js
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOT

    # Reload and Enable
    systemctl daemon-reload
    systemctl enable lzrcnc
    systemctl start lzrcnc
    
    log_action "ENABLED" "systemd" "Service created and started."
    echo "Service enabled! You can verify with: systemctl status lzrcnc"
else
    echo "Skipping autoboot setup."
fi

# 7. Final Polish
echo "Finalizing Setup..."

# Create Global Symlink
if ln -sf "$(pwd)/lzrcnc_start.sh" /usr/local/bin/lzrcnc; then
    chmod +x /usr/local/bin/lzrcnc
    log_action "CREATED" "symlink" "Global command 'lzrcnc' enabled."
else
    log_action "WARNING" "symlink" "Failed to create /usr/local/bin/lzrcnc"
fi

# Fix Permissions (Restore ownership to sudo user)
# This prevents root-locked files from checking out the repo or running npm as user later.
TARGET_USER=${SUDO_USER:-$(whoami)}
if [ "$TARGET_USER" != "root" ]; then
    echo "Fixing permissions for user: $TARGET_USER"
    chown -R "$TARGET_USER:$TARGET_USER" "$(pwd)"
    log_action "FIXED" "permissions" "Ownership restored to $TARGET_USER."
fi

echo "Installation Complete. See install_report.log for details."
