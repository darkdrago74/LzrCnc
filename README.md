# LzrCnc

![LzrCnc Logo](./LrzCnc%20logo.png)

**LzrCnc** is a modern, web-based CNC/Laser control server designed for Raspberry Pi (Debian Bookworm/Trixie) and Linux systems. It recovers the power of LaserWeb4 with a modern React stack, supporting GRBL (Serial) and Klipper (Moonraker) controllers.

## Features

-   **Web-Based Control**: Responsive React/Vite UI accessible from any browser.
-   **Visualizer**: 3D G-Code preview with real-time status and machine simulation.
-   **CAM Backend**:
    -   **Raster**: High-performance image processing (Sharp/Maker.js).
    -   **Vector**: SVG/DXF support (In Progress).
-   **Hardware**: Native GRBL and Klipper support.
-   **Smart Startup**: Auto-detects port conflicts and recovers from zombie processes.
-   **Update System**: Safe in-place updates preserving user data.

## Installation

### Prerequisites
-   Linux OS (Debian/Ubuntu/Raspberry Pi OS recommended).
-   `Node.js` v20+ (Installer will attempt to install/manage this).
-   `git`

### Quick Install (Recommended)
This method calculates dependencies, sets up the environment, and creates the global `lzrcnc` command.

```bash
git clone https://github.com/darkdrago74/LzrCnc.git
cd LzrCnc
chmod +x install.sh
sudo ./install.sh
```

During installation, you can choose to enable the **Systemd Service** for auto-boot on startup.

## Usage

### Starting the Server
If you installed the global command, simply run:

```bash
lzrcnc
```

-   **Smart Startup**: This script checks if port `3000` is free. If a frozen/zombie instance is blocking it, it will automatically clean it up and start a fresh instance.
-   **Access**: Open your browser to `http://localhost:3000` or `http://<your-pi-ip>:3000`.

### Hardware Connection
**GRBL**:
- Connect your board via USB.
- In **Machine Settings**, select "GRBL Import" to auto-configure your workspace dimensions.
- Use the **Hardware Parameters** tab to fine-tune your machine's speeds, accelerations, and travel limits directly on the EEPROM.
- **Controls**: Homing (`$H`) and Unlock (`$X`) are available in the setup tab.

### Manual Start (Dev)
```bash
npm start
# Runs server on :3000 and client on :5173 (if in dev mode)
```

## Maintenance

### Updating LzrCnc
We provide a safe update mechanism that preserves your machine settings (`data/` folder).

**Method 1: Web UI (Recommended)**
1.  Go to **Machine Settings** in the web interface.
2.  Scroll to **System Updates**.
3.  Click **Check for Updates** -> **Update**.
4.  The server will pull changes, rebuild, and restart automatically.

**Method 2: Command Line**
```bash
cd /path/to/LzrCnc
./update.sh
```

### Uninstallation
```bash
# Standard Remove (Keeps User Data in data/)
sudo ./uninstall.sh

# Full Clean (Removes Dependencies & Configs)
sudo ./uninstall.sh --all
```

## Project Structure

-   `server/`: Fastify/Node.js backend.
-   `client/`: React/Vite frontend.
-   `data/`: **User Data Directory**. Stores `machine_settings.json` and `materials.json`. This folder is ignored by git to ensure your settings are safe during updates.
-   `install.sh`: Main installer.
-   `lzrcnc_start.sh`: Smart startup script (symlinked to `/usr/local/bin/lzrcnc`).

## Troubleshooting

### Port 3000 Busy
If you see `EADDRINUSE`, simply run `lzrcnc` again. The smart startup script handles cleanup of zombie processes automatically.

### Permissions
If you encounter permission errors after a manual git pull, run:
```bash
# Fix ownership to your user
sudo chown -R $USER:$USER .
```
(The installer fixes this automatically at the end).
