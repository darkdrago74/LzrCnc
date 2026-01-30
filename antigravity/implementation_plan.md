# Implement GRBL Settings Sync and Control

## Goal Description
Implement the ability to synchronize the application's machine settings (Dimensions, Ranges) with the connected GRBL hardware settings. Additionally, provide an "Expert" interface to view and modify critical GRBL parameters (speeds, accelerations) directly on the board and controls for Homing (`$H`) and Unlocking (`$X`).

## User Review Required
> [!IMPORTANT]
> **Data Flow**: The "Import" feature will read from the hardware (`$$`) and overwrite the Server's "User Settings". The "Upload" feature in the Expert tab will write directly to the hardware firmware.

## Proposed Changes

### Backend (Server)

#### [MODIFY] [MachineInterface.ts](file:///home/roro/Documents/LzrCnc/server/src/machine/MachineInterface.ts)
- Update `MachineStatus` interface to include `grblSettings: Record<string, string | number>`.

#### [MODIFY] [GrblController.ts](file:///home/roro/Documents/LzrCnc/server/src/machine/GrblController.ts)
- Modify `parseResponse` to capture all `$N=V` responses.
- Store these values in `status.grblSettings`.
- Ensure they are emitted in the status update.

### Frontend (Client)

#### [MODIFY] [MachineSettingsPanel.tsx](file:///home/roro/Documents/LzrCnc/client/src/components/MachineSettingsPanel.tsx)
- **GRBL Import Logic**:
    - Implement `handleImportGrbl`:
        - Send `$$` command.
        - Watch `status.grblSettings` for updates.
        - Map `$130` (X Max) -> `workbench.width` / `axes.x.max`.
        - Map `$131` (Y Max) -> `workbench.height` / `axes.y.max`.
        - Map `$132` (Z Max) -> `workbench.depth` / `axes.z.max`.
- **New Tab: "Hardware Parameters"**:
    - Display editable fields for:
        - Max Rate: `$110` (X), `$111` (Y), `$112` (Z).
        - Acceleration: `$120` (X), `$121` (Y), `$122` (Z).
        - Max Travel: `$130` (X), `$131` (Y), `$132` (Z).
    - **Upload Button**: Sends changed values back to board (e.g., `$110=5000`).
- **Control Buttons**:
    - Add "Home ($H)" and "Unlock ($X)" buttons, likely near the top or in the Hardware tab.

## Verification Plan

### Automated Tests
- None (Hardware interaction heavily relies on physical simulation or mocking).

### Manual Verification
1. **Connect to GRBL**: Verify connection.
2. **GRBL Import**:
    - Change a value on the board (e.g., `$130=305`).
    - Click "GRBL Import".
    - Verify "Workbench Width" updates to `305`.
3. **Hardware Parameters**:
    - Go to "Hardware Parameters" tab.
    - Change X Max Rate ($110) to a new value.
    - Click "Upload".
    - Restart server/board or `$$` to verify persistence.
4. **Controls**:
    - Click `Unlock ($X)`: Verify console log shows `[MSG:Caution: Unlocked]`.
    - Click `Home ($H)`: Verify machine attempts homing (or sends command).
