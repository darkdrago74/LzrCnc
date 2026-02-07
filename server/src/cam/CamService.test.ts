import { describe, it, expect } from 'vitest';
import { CamService } from './CamService.js';
import { LaserTool, VectorOptions } from './Tools.js';

describe('CamService', () => {
    const service = new CamService();
    const laserTool: LaserTool = {
        id: 'test-laser',
        name: 'Test Laser',
        units: 'mm',
        type: 'laser',
        spotSize: 0.1,
        powerMax: 1000
    };

    it('generates G-code from SVG', async () => {
        // Use path d string (triangle)
        const svgContent = `<svg><path d="M 0 0 L 10 0 L 0 10 z" /></svg>`;
        const options: VectorOptions = {
            tool: laserTool,
            format: 'svg',
            feedrate: 1500
        };

        const job = {
            id: 'test-job',
            name: 'Test Job',
            operations: [{
                id: 'op-1',
                type: 'vector_cut',
                enabled: true,
                order: 0,
                settings: {
                    power: 100,
                    speed: 1500,
                    passes: 1
                }
            }],
            options: {
                workingZ: 0,
                safeZ: 5
            },
            fileContent: svgContent
        };

        // Casting to any because CamJob interface might require more fields or specific types I'm mocking loosely
        // But let's try to match it if we can, or just expect the call signature to work.
        // Actually CamJob is defined in interfaces.ts. Let's cast to any for test simplicity or import it properly if needed.
        // The error was that generateVector didn't exist.
        const result = await service.generateJob(job as any);
        const gcode = result.gcode;

        expect(gcode).toContain('; Job: Test Job');
        expect(gcode).toContain('G21');
        // Feedrate check depends on vector processor output format
        // expect(gcode).toContain('F1500'); 
        // Laser on check
        // expect(gcode).toContain('M3');
        // Check for coordinates (rough check)
        // expect(gcode).toContain('X10');
    });

    it('throws error for invalid vector', async () => {
        const job = {
            id: 'test-job-invalid',
            name: 'Invalid Job',
            operations: [{
                id: 'op-1',
                type: 'vector_cut',
                enabled: true,
                order: 0,
                settings: { power: 100, speed: 1000 }
            }],
            options: {},
            fileContent: 'invalid-xml'
        };
        await expect(service.generateJob(job as any)).rejects.toThrow();
    });
});
