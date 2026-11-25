# Changelog

## 2.2.0 — Machine profiles

### New
- **Named machine profiles** (`data/machines.json`): several machines per LzrCnc, each with a name, type
  (laser / mill / laser + mill), notes, max S (`$30`), connection (port/baud or Klipper host) and all settings.
  The old `machine_settings.json` is migrated automatically to a profile called "My machine" (file left untouched).
- **Settings → Machines**: select, rename, New, Duplicate, Delete, Set active; Save writes to the selected profile.
  Unsaved edits are previewed in the 3D view only for the active machine and only while Settings is open.
- **Simulate a saved machine**: Connection panel has a Machine selector and a "Simulate <name>" button; the simulator
  uses that machine's travel limits. Jobs can be prepared offline without `npm run sim`.
- **Export / Import** a machine as a `lzrcnc-machine` JSON file (add as new, or replace the selected machine while
  keeping its local port), and **Send to another LzrCnc** (e.g. the Raspberry Pi) by address, updating the machine
  with the same name there.
- Header shows the active machine name and a SIM badge while simulating.
- LzrCnc logo back at the top of the visualizer, redrawn as a lightweight vector (triangle "LC" mark + wordmark with
  an animated laser line); same mark in the sidebar and as the browser icon (`logo-mark.svg`).
- Lighter laser FX (Settings toggle): beams now appear every ~6–12 s for ~2–3 s with slow fades and a faint glow
  halo instead of a full-screen Bloom pass; nothing is drawn between beams and React no longer re-renders per
  phase. Sparks are 24 round, fading points per beam that drift slowly off the beam. 4 vertical + 2 full-length
  floor beams. The hidden full-window 2D "chips" canvas (`BackgroundFX`) was removed. Honours *prefers-reduced-motion*.
- CAM: the *CNC* tab is merged into *Mill*. Step 3 opens the tool library in place (the tool list refreshes after
  edits); new step 6 "Zero, spindle & run" holds Z0 / touch-plate probing, the Z-direction test, the optional spindle
  controls and a **Run milling job…** button that opens the run wizard directly.
- API: `GET/POST /api/machines`, `PUT/DELETE /api/machines/:id`, `POST /api/machines/:id/activate`,
  `GET /api/machines/:id/export`, `POST /api/machines/import`; `/connect` accepts `machineId`; `/status` reports
  `activeMachine` and `connectionType`. `/api/settings/machine` still reads/writes the active machine.
- Switching or replacing the active machine is refused (409) while real hardware is connected or a job runs.

### Fixed
- Unsaved settings edits no longer stay applied to the visualizer / job wizard after leaving the Settings panel.
- Laser power scaling falls back to the machine's max S when the controller does not report `$30`.

## 2.1.1 — Installation & launchers (Windows, Debian / Raspberry Pi OS, Fedora)

Tested end-to-end on Windows 11 (fresh copy), Fedora 44 and Debian 13 (WSL, with systemd).

### Fixed
- `install.bat`, `install.sh`, `update.sh`, `uninstall.sh` ran npm in `install/` where there is no `package.json`
  (the project lives in `soft/`): every install failed. All scripts now locate the project from their own path.
- `lzrcnc_start.sh` had a hard-coded `/home/roro/Documents/LzrCnc` path and needed `lsof`.
- The systemd service started `server/dist/index.js` (never built, wrong path) on port 3000 as root-owned files;
  it now runs `node --import tsx src/index.ts` in `soft/server` as your user, on port 3001, with the `dialout` group.
- `.bat` files had Unix line endings (cmd mis-parses labels); `.sh` files are now forced to LF and `.bat` to CRLF
  by a new `.gitattributes` (Windows line endings broke every `.sh` on Linux).
- Port clean-up only stops old LzrCnc (node) processes; it no longer kills whatever program holds the port.
- `validate.sh` checked port 3000 and the wrong start command; `soft/package.json` `install:all` pointed to a missing file.
- Missing files under `/assets/` returned `index.html` (served as JavaScript), which left a blank page; they now return 404.
- If the app cannot start (blocked or missing script, startup error), the page now shows the reason instead of an empty dark screen.
- `start.bat` opens `http://127.0.0.1:3001` instead of `localhost`: enterprise Edge policies can force `localhost` into Internet Explorer mode (blank page). The page detects IE mode and gives the right address.

### New
- **`lzrcnc.sh`** (Linux) and **`start.bat`** (Windows) launchers with the same commands: `start` (default),
  `sim`, `dev`, `build`, `stop` (+ `status` on Linux). Production mode serves the UI and API on one port (3001),
  installs missing packages and rebuilds the UI when the sources changed; Windows opens the browser when ready.
  `lzrcnc` detects a running boot service instead of starting a second copy. `LZRCNC_PORT` changes the port.
- `install.sh`: apt **and dnf** (Fedora) support, Node.js 22 via NodeSource / Fedora / official binaries
  (32-bit Raspberry Pi OS), npm run as the normal user, `dialout` group, firewalld port, `--service` / `--no-service`.
- `uninstall.sh` no longer removes system packages; `--all` deletes the user data instead (with confirmation).
- `npm run build:fast --workspace=client` (Vite only, no type-check) used by the launchers - lighter on a Raspberry Pi.
- Screenshots in `docs/screenshots/`, README rewritten for Windows / Raspberry Pi / Fedora.
- The server prints its network address(es) at start-up, e.g. `Network : http://192.168.1.20:3001`, to open it from a phone or tablet.

## 2.1.0 — Laser designer & mill setup

### Laser CAM
- **Operation profiles**: each operation has a name and a colour and is saved in the browser (`lzrcnc.laser.ops`).
  The profile panel lists the objects with a checkbox, so many objects share a few profiles; the object list shows
  each object's profile colour. Objects can be set to *None — don't burn* (guides, references).
- **Raster**: brightness / contrast / gamma tone curve (server `toneCurve`, pure white never burns) and a live burn
  preview in the profile panel, computed with the same maths as the server (`client/src/utils/rasterPreview.ts`).
- **Vector ordering**: inner contours are cut before the outline that contains them (parts no longer drop before
  their holes are cut), nearest-neighbour ordering inside each level, closed paths start at the nearest vertex.
- **Parametric shapes** (`client/src/utils/shapes.ts`), editable after placement from the object properties:
  rectangle with corner radius and optional centre hole, circle by Ø / ellipse, slot, polygon on a construction
  circle (Ø through the corners or across flats, rotation, centre hole, M2–M12 nut presets, flat on top, positioned
  by its centre; the dashed construction circle is shown in the preview only), star, text.
- **Text** can be a raster image or traced vector outlines (holes kept, even-odd), so it can be cut or line-engraved.
- Filled shapes are routed to a raster profile automatically. Objects can be renamed.
- Removed the unused `DitheringPreview` component.

### Mill CAM
- **Work Z0** can be the stock top or the stock bottom (bed / spoilboard); G-code, viewer, simulation, framing and
  the Run-job wizard all follow it.
- Each operation's final depth is set **either** from the top **or** as the material left above the bottom.
- **Show on machine** card: trace the stock outline or the cut area at a clearance height, go to the first cut, lift;
  only enabled when the machine is idle. Framing in the job tab now includes the tool radius and the stock height.
  The frame is drawn in 3D as a green dashed rectangle.

## 2.0.0 — Review & upgrade

A full review of the application (UI design, 3D visualizer, laser CAM, machine control) followed by an upgrade pass.
Client and server both type-check cleanly and are covered by unit tests (`cd soft && npm test`).

### Visualizer — native Z-up
- The scene is now authored directly in machine coordinates: **XY is always the bed plane, +Z always points up**
  (`THREE.Object3D.DEFAULT_UP = (0,0,1)`). The old `-π/2` group rotation and the Y/Z swapping it required are gone.
- The camera cannot orbit below the bed. New **3D / TOP / FRONT / FIT** presets; TOP is a locked plan view
  (X right, Y up, Z towards you).
- Axis gizmo colors follow the X red / Y green / Z blue convention; bed, grid, rulers and machine head all use real mm.
- G-code preview is color-coded (cut / travel / done) and shows live job progress.
- Imported and drawn artwork is placed at its true mm size (SVG units, DXF in mm, images at 96 dpi).
- Fixed: SVG artwork sometimes never appeared (the texture URL was recreated on every suspended render).
- The Settings axis preview is Z-up as well.

### Laser CAM
- New client-side job builder (`client/src/utils/laserJob.ts`): every object is converted to absolute mm vectors
  or a resampled raster with its position, rotation and scale applied, then grouped by operation.
- New server generator (`server/src/cam/LaserJobGenerator.ts`) for raster and vector operations: multiple passes,
  min/max power, overscan, grayscale / dither / threshold rasters, laser off during travels, `M5` at the end,
  power scaled to GRBL `$30`, M4 dynamic or M3 constant mode, optional air assist (`M8`/`M9`).
- `/cam/generate` returns statistics (lines, estimated time, bounds) displayed in the UI.
- Designer: rectangles (corner radius), ellipses, polygons, stars and text; duplicate and delete;
  exact position / size (with aspect lock) / rotation editing; per-object operation assignment.
- New objects are placed on the bed center, scaled to fit the bed, cascaded, and get a matching default
  operation automatically.
- Multi-file drag & drop for SVG, DXF, images and G-code.

### Mill CAM (2.5D)
- New **Mill** tab (`client/src/components/cam/MillPanel.tsx`, `client/src/utils/millJob.ts`) with a 4-step workflow:
  stock → contours → tool & operations → generate & simulate.
- Stock: size, thickness, bed position and material; Z0 is the stock top. Stock, contours, toolpaths and the
  simulated part are drawn in the Z-up visualizer (`MillScene.tsx`).
- Operations: Facing (whole stock), Pocket (islands supported, stepover %, inside-out offsets) and Profile
  (on line / inside / outside, with a bottom "skin" to keep the part attached). Per-op tool, depths, stepdown, feeds,
  spindle and **ramp angle** (helical/zig-zag ramp entry, never a straight plunge into material).
- Rewritten server generator (`server/src/cam/MillingGcodeGenerator.ts`): Clipper offsets, warnings for tools too
  large for a pocket (the offending contour is named and skipped, the others are still cut),   depth beyond the
    stock, stepdown larger than the tool, steep ramps / straight plunges, RPM above the tool max, chip load. Tools gained an optional max RPM; 6 mm and 3 mm flat endmills added.
- Heightfield material-removal simulation with a progress slider.
- Run-job wizard mill mode: origin at the stock corner, optional "Set Z0 here", spindle-off framing and a mill
  safety checklist (GRBL `$32=0`, clamps, collet, protection).
- *Example* loads a two-sided job: 13 mm × 200 × 200 wood → 8 mm square with a 1 mm skin, then flip and face 1 mm.

### Machine control
- New server `JobRunner`: streamed jobs with acknowledged-line progress, pause / resume / stop, and a busy guard
  (manual commands, jogs and probes are rejected with `409` while a job runs; real-time commands still work).
- New **Run job** wizard: optional homing, origin choice (keep work zero / start at the head position),
  bed bounds check, framing (laser off) and a mandatory safety confirmation.
- Bottom progress bar with elapsed time, ETA and pause / resume / stop.
- Editable user G-code macros (stored in the browser) next to Klipper macros.
- Laser test uses the real `$30` max power.

### Application
- Central API layer (`client/src/api.ts`) with relative URLs; the Vite dev server proxies to the Fastify server
  (`LZR_API_TARGET` overrides). No more hard-coded `localhost:3001`.
- Status polling no longer overlaps requests.
- Cleaner panel layout and styling (buttons, scrollbars, status pill, stats cards); the G-Code tab is usable while
  disconnected; the 7 MB logo is no longer bundled and the cosmetic background laser is off by default.
- The production build splits the 3D stack into its own chunk (app bundle ≈ 250 KB).
- New scripts in `soft/`: `npm run sim` (simulated machine, no hardware) and `npm test` (all unit tests).
- Removed scratch/debug files from the server.

### Known limitations
- Klipper pause/stop only acts on SD-card prints; for streamed jobs LzrCnc simply stops sending lines.
- GRBL end-of-job detection has been tested with the simulator only — verify on real hardware with the laser
  at low power first.
- Milling: no holding tabs, tool changes are `M0` pauses, and facing covers the whole stock (use a large surfacing
  bit for speed). The simulation is a flat-end heightfield (~0.5 mm resolution). Air-cut a new job first.
