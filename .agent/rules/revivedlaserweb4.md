---
trigger: always_on
---

PROJECT MANIFEST: RevivedLaserweb4 (RPi Klipper/ RPi with GRBL)

1. Core Objective: Create a web-based CNC/Laser CAM and Control server compatible with Node.js 24. The core must run on Raspberry Pi (Debian Bookworm/Trixie) but be accessible via any browser (Localhost or IP).

This must recover the functionalities of Laserweb4 program.

2. Hardware Compatibility (Strict):

Klipper: Must interface via Moonraker API (WebSocket). do NOT try to talk to Klipper via Serial. It must parse printer.cfg to auto-discover axis limits and macros.

GRBL: Must interface via Serial (USB) for boards like Arduino/MKS DLC32.

3. CAM & Workflow Requirements:

Image Processing: Capability to convert JPG/PNG to G-code (Rastering).

Vector: Capability to convert SVG/DXF to G-code (Cutting).

Tooling: Support for defining "Bit Diameter" (CNC) and "Laser Spot Size".

Probing: Include a UI workflow for Z-Height probing (G38.2).

4. Architecture Constraints:

Backend: Node.js 24.

Frontend: Modern Reactive (React/Vue).

State Management: The UI must reflect real-time machine status (Position, Temp).

5. AI integration:

Leave entry points in the API for a local AI model (running on Node 24) to optimize G-code paths in the future.