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
        const svgContent = `<svg><path d="M 0 0 L 10 0 L 0 10 z" /></svg>`;
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');
        const tempPath = path.join(os.tmpdir(), 'test_cam_service.svg');
        fs.writeFileSync(tempPath, svgContent);

        const job = {
            id: 'test-job',
            name: 'Test Job',
            sourceFilePath: tempPath,
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
                tool: laserTool,
                format: 'svg',
                workingZ: 0,
                safeZ: 5
            }
        };

        const result = await service.generateJob(job as any);
        const gcode = result.gcode;

        expect(gcode).toContain('; Job: Test Job');
        expect(gcode).toContain('G21');
    });

    it('throws error for invalid vector', async () => {
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');
        const tempPath = path.join(os.tmpdir(), 'test_cam_service_invalid.svg');
        fs.writeFileSync(tempPath, 'invalid-xml');

        const job = {
            id: 'test-job-invalid',
            name: 'Invalid Job',
            sourceFilePath: tempPath,
            operations: [{
                id: 'op-1',
                type: 'vector_cut',
                enabled: true,
                order: 0,
                settings: { power: 100, speed: 1000 }
            }],
            options: {}
        };
        await expect(service.generateJob(job as any)).rejects.toThrow();
    });
});
