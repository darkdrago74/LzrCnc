# Walkthrough - GRBL Settings Sync & Control
## Goal
Implement two-way synchronization between the App and the GRBL hardware, along with essential control functions.
## Changes
### 1. Backend (`Server`)
- **Enhanced Status**: `MachineStatus` now carries a `grblSettings` dictionary containing all `$N=V` parameters.
- **GrblController**: Updated to parse every setting line (e.g., `$110=5000`) and store it in status.
### 2. Frontend (`Client`)
- **GRBL Import**: Added a button to "Sync Size" which reads `$130`, `$131`, `$132` from the board and updates the Workbench dimensions in the App.
- **Hardware Parameters Tab**: A new "Expert" tab that allows viewing and modifying:
    - **Max Rates** (`$110`, `$111`, `$112`)
    - **Accelerations** (`$120`, `$121`, `$122`)
    - **Max Travel** (`$130`, `$131`, `$132`)
- **Control Actions**: Added dedicated buttons for:
    - **Home Machine**: Sends `$H`
    - **Unlock / Reset**: Sends `$X`
## Verification
1.  **Open Settings**: Navigate to the Settings Panel.
2.  **Test Import**:
    -   Ensure machine is connected.
    -   Click "GRBL Import".
    -   Observe Workbench dimensions updating to match firmware limits (e.g., 302x326x65).
3.  **Test Hardware Tab**:
    -   Switch to "Hardware Parameters".
    -   Verify values are populated.
    -   Edit a value (e.g., Change X Max Rate to 5500) and click the Upload icon.
    -   Click "Refresh ($$)" to confirm validity.
4.  **Test Controls**:
    -   Click "Unlock ($X)" -> Should see "Caution: Unlocked" in logs/console.
    -   Click "Home ($H)" -> Machine should begin homing cycle.
