import { CncService, CncJob2D } from '../src/cnc/CncService';

// Mock Tool
const mockTool = { id: 't1', name: 'Test Bit', type: 'endmill', diameter: 3.175, flutes: 2, material: 'carbide' };

const service = new CncService();

// Mock DXF Path (Need a real path or mocking fs read? Service reads FS.)
// Actually, CncService uses fs.readFileSync. I should mock it or use a temp file.
// Let's create a temp DXF file.

import fs from 'fs';
import path from 'path';

const TMP_DXF = 'test_tabs.dxf';
const DXF_CONTENT = `
  0
SECTION
  2
ENTITIES
  0
LWPOLYLINE
  8
0
 90
4
 70
1
 10
0.0
 20
0.0
 10
100.0
 20
0.0
 10
100.0
 20
100.0
 10
0.0
 20
100.0
  0
ENDSEC
  0
EOF
`;

fs.writeFileSync(TMP_DXF, DXF_CONTENT);

const job: CncJob2D = {
    id: 'job1',
    filePath: TMP_DXF,
    tool: mockTool as any,
    operation: 'profile_outside',
    cutDepth: 2.0,
    stepDown: 2.0, // Single pass to force tabs
    safeZ: 5.0,
    feedRate: 1000,
    plungeRate: 200,
    spindleRPM: 12000,
    tabsEnabled: true,
    tabWidth: 5.0,
    tabHeight: 1.0,
    tabInterval: 50.0
};

async function testVideo() {
    try {
        console.log("Generating G-Code with Tabs...");
        const gcode = await service.generate2D(job);

        // Check for Tab Bridges
        // We look for retraction to Z-1.0 (since CutDepth is 2.0 and TabHeight is 1.0)
        // Layer Z is -2.0. BaseZ for tab should be -1.0.

        const hasBridgeRetract = gcode.includes('Z-1.000');

        if (hasBridgeRetract) {
            console.log("✅ Tabs Generated: Found Z-1.000 moves.");
        } else {
            console.error("❌ Tabs Missing: No Z-1.000 moves found.");
            console.log(gcode);
        }

    } catch (e) {
        console.error(e);
    } finally {
        fs.unlinkSync(TMP_DXF);
    }
}

testVideo();
