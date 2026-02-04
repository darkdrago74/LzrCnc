import { CamService } from '../src/cam/CamService.js';
import { RasterOptions, LaserTool } from '../src/cam/Tools.js';
import { CamJob, CamOperation } from '../src/cam/interfaces.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Mock CamService to test logic without full server
async function verifyCam() {
    console.log('Starting CAM Verification...');

    // 1. Create a Test Image (Gradient)
    const width = 100;
    const height = 100;
    const buffer = await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 0, g: 0, b: 0 }
        }
    })
        .linear(1, 0) // Dummy gradient? sharp linear is for adjustments.
        .toBuffer();

    // Create a gradient manually
    const rawBuffer = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const val = Math.floor((x / width) * 255);
            rawBuffer[idx] = val; // R
            rawBuffer[idx + 1] = val; // G
            rawBuffer[idx + 2] = val; // B
        }
    }

    const imagePath = path.resolve('test_gradient.png');
    await sharp(rawBuffer, { raw: { width, height, channels: 3 } }).toFile(imagePath);
    console.log(`Created test image: ${imagePath}`);

    const service = new CamService();

    // 2. Test Raster Job (Grayscale + Overscan)
    const tool: LaserTool = { id: 'l1', name: 'Diode', units: 'mm', type: 'laser', spotSize: 0.1, powerMax: 1000 };

    const op: CamOperation = {
        id: 'op1',
        type: 'raster',
        enabled: true,
        order: 0,
        settings: {
            width: 10, // mm (small)
            height: 10, // mm
            tool: tool,
            feedrate: 1000,
            powerMin: 0,
            powerMax: 1000,
            invert: false,
            mode: 'grayscale',
            overscan: 2.0, // mm
            dither: false
        } as RasterOptions
    };

    const job: CamJob = {
        id: 'test-job',
        name: 'Verification Job',
        status: 'draft',
        sourceFilePath: imagePath,
        operations: [op],
        options: { ...op.settings } as any
    };

    console.log('Generating Raster G-code...');
    const result = await service.generateJob(job);
    const gcode = result.gcode;

    // 3. Analyze G-code
    const lines = gcode.split('\n');
    console.log(`Generated ${lines.length} lines of G-code.`);

    // Properties to check
    let hasOverscan = false;
    let minX = Infinity, maxX = -Infinity;
    let hasSValues = false;

    const X_REGEX = /X([\d.-]+)/;
    const S_REGEX = /S([\d.]+)/;
    const G0_REGEX = /^G0/;

    lines.forEach(line => {
        const xMatch = line.match(X_REGEX);
        const sMatch = line.match(S_REGEX);
        const isG0 = G0_REGEX.test(line);

        if (xMatch) {
            const x = parseFloat(xMatch[1]);
            if (isG0 && x < 0) hasOverscan = true; // Overscan goes negative relative to 0?
            // Start is 0. Overscan should go to -2.0
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }

        if (sMatch) {
            const s = parseFloat(sMatch[1]);
            if (s > 0 && s < 1000) hasSValues = true; // Grayscale check
        }
    });

    console.log(`X Range: ${minX} to ${maxX}`);
    console.log(`Has Intermediate S-Values (Grayscale): ${hasSValues}`);
    console.log(`Overscan detected (X < 0): ${hasOverscan}`);

    if (minX <= -2.0 && hasSValues) {
        console.log('✅ PASS: Grayscale and Overscan verified.');
    } else {
        console.error('❌ FAIL: Overscan or Grayscale missing.');
    }

    // 4. Test Dithering
    op.settings.mode = 'dither';
    op.settings.dither = true;
    console.log('Generating Dithered G-code...');
    const resultDither = await service.generateJob(job);

    let allBinary = true;
    resultDither.gcode.split('\n').forEach(line => {
        const sMatch = line.match(/S([\d.]+)/);
        if (sMatch) {
            const s = parseFloat(sMatch[1]);
            // Allow 0 or 1000 (Max)
            if (Math.abs(s - 0) > 0.1 && Math.abs(s - 1000) > 0.1) {
                allBinary = false;
            }
        }
    });

    console.log(`All S-values Binary (0 or 1000): ${allBinary}`);
    if (allBinary) {
        console.log('✅ PASS: Dithering verified.');
    } else {
        console.error('❌ FAIL: Dithering produced non-binary values.');
    }

    // Cleanup
    fs.unlinkSync(imagePath);
}

verifyCam().catch(console.error);
