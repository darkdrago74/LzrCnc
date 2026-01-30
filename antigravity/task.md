# Project Tasks: LzrCnc

## Critical Rules
- **NEVER use `pkill node`**. It causes crashes. Always prefer gentle shutdowns or ask the user.

# Project Tasks: LzrCnc

## Phase 0: Infrastructure & Validation (Enhanced QC)
- [x] **Robust Uninstaller (`uninstall.sh`)**
    - [x] Implement `--all` flag & Critical Safelist.
    - [x] Protect `nodejs`/`npm`.
- [x] **Installation QC Agent (`install.sh`)**
    - [x] Implement detailed logging (`install_report.log`).
    - [x] Log status: `[INSTALLED]`, `[SKIPPED]`, `[FAILED]`.
    - [x] Smart dependency check (Node.js, Python, System libs).
- [x] **Validation Script (`validate.sh`)**
    - [x] End-to-end cycle check.
- [x] **App Refinements**
    - [x] Create `lzrcnc` symlink.
    - [x] Logo adjustments (position, opacity).
    - [x] Settings Panel (IP/System Info).
    - [x] Visualizer Grid (clipping, 2cm inner grid).
- [x] **Refinement Phase 2**
    - [x] Server: Detect LAN IP.
    - [x] Client: Display LAN IP & Logo Fade (4 edges).
    - [x] Visualizer: 5cm Grid & Reduce Particles.
    - [x] Documentation: Log permission issues.
- [x] **Refinement Phase 3**
    - [x] Visualizer: Beam Makeover (White Core/Blue Glow).
    - [x] Visualizer: Particle Reduction (20 count, slow).
    - [x] **Settings Visualizer**: 3D Canvas, Opaque Bed, Corner Origins, Thicker Arrows, Static Direction logic.
    - [x] Visualizer: Denser Outer Grid (5cm).
    - [x] **Endstops**: Configuration UI & 3D Visualization.
- [x] **Final Polish & QA**
    - [x] Visualizer: Single Beam (Simplify).
    - [x] Docs: Update README (lzrcnc, install).
    - [x] QA: Manual Validation Run (Sudo Skipped).
- [x] **Design Refinement**
    - [x] Reduce laser particle speed (10%).
    - [x] Verify UI Logo.

- [x] **Installation Robustness (RPi)**
    - [x] Requirements: Add `curl`.
    - [x] Install Script: Node.js v24 Auto-Setup.
    - [x] Install Script: Auto-Symlink `lzrcnc`.
    - [x] Install Script: Permission Fix.

## Phase 1: CAM & Core Logic
- [ ] **Implement Vector CAM**
    - [ ] Add SVG/DXF parsing in `CamService`.
    - [ ] Implement path generation (profiles, pockets).
    - [ ] Add tool offset calculation.
- [ ] **Expose CAM API**
    - [ ] Add `/upload`, `/generate`, `/job` endpoints.

## Phase 2: Frontend Implementation
- [ ] **CAM Interface**
    - [ ] Implement File Upload (Drag & Drop).
    - [ ] Create Settings Panel.
    - [ ] Add G-code Preview.
- [ ] **Machine Control Enhancements**
    - [ ] Terminal, Macros, Z-Probe UI.

## Phase 3: Hardware Refinement
- [x] **Hardware Tests**
    - [x] Detect `/dev/ttyUSB0`.
    - [x] Verify GRBL connection via UI (API Validated).
    - [x] Verify `$$` settings retrieval.
- [x] **GRBL Integration**
    - [x] **Import Feature**: Sync dimensions from board.
    - [x] **Expert Tab**: Edit `$110`-`$132` parameters.
    - [x] **Controls**: Homing ($H) and Unlock ($X).
- [ ] **Klipper Integration**
    - [ ] Verify `KlipperController`.
    - [ ] Parse `printer.cfg`.

## Phase 4: QA & Feature Parity (New)
- [ ] **Feature Comparison Agent**
    - [ ] Analyze original LaserWeb4 features vs Current.
    - [ ] Identify missing icons, workflows, and tools.
- [ ] **QA/QC Functional Agent**
    - [ ] Automated UI Tests (Drag & Drop, Connection).
    - [ ] Verify functionality "on-device" (RPi simulation).
- [ ] **AI Entry Points**
    - [ ] Create hook for G-code optimization.
