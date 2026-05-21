import { describe, it, expect } from 'vitest';
import { VectorProcessor } from '../src/cam/processors/VectorProcessor';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('VectorProcessor', () => {
    it('should generate valid G-code with offsets and multipass z-steps', async () => {
        const processor = new VectorProcessor();
        const testFile = path.join(os.tmpdir(), 'test_vector.svg');
        fs.writeFileSync(testFile, '<svg><path d="M 0 0 L 10 0 L 10 10 L 0 10 Z" /></svg>');

        const job: any = {
            id: 't1',
            name: 't1',
            status: 'draft',
            sourceFilePath: testFile,
            options: {
                tool: { type: 'cnc', id: 't1', name: 'bit', units: 'mm', diameter: 1.0, cutDepth: 1 },
                format: 'svg',
                feedrate: 800,
                cutHeight: -2,
                workingZ: 0,
                safeZ: 5,
                cutSide: 'outside'
            },
            operations: []
        };

        const result = await processor.process(job, {} as any);
        const gcode = result.gcode;

        // Verify Multipass
        expect(gcode).toContain('; --- Pass Z: -1.000 ---');
        expect(gcode).toContain('; --- Pass Z: -2.000 ---');

        // Verify Safe Z
        expect(gcode).toContain('G0 Z5.000');

        // Verify Spindle
        expect(gcode).toContain('M3');
        expect(gcode).toContain('M5');

        // Verify Tool Offset compensation
        // If rect is 0,0 to 10,10 and it's outside offset by 0.5 (diam 1.0 / 2)
        // Check for coordinates like -0.500 or 10.500
        expect(gcode).toContain('-0.500');
        expect(gcode).toContain('10.500');
    });
});
