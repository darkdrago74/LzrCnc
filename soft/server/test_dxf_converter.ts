import fs from 'fs';
import { DxfConverter } from './src/cam/processors/DxfConverter';

async function test() {
    const converter = new DxfConverter();

    // Minimal valid DXF string
    const sampleDxf = `  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1009
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
0
 10
0.0
 20
0.0
 30
0.0
 11
100.0
 21
100.0
 31
0.0
  0
ENDSEC
  0
EOF`;

    try {
        const result = await converter.convertToSvg(sampleDxf);
        console.log("SVG Output:\n", result);
        if (result.includes('<svg') && result.includes('<path') && result.includes('</svg>')) {
            console.log("SUCCESS: SVG generated correctly.");
        } else {
            console.log("WARNING: SVG format looks incorrect.");
        }
    } catch (e) {
        console.error("FAILED", e);
    }
}

test();
