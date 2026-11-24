import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { generateLaserJob, validateLaserJob, LaserJobValidationError, GrayImage, orderVectors, toneCurve } from '../src/cam/LaserJobGenerator';

const settings = { power: 50, speed: 1200, passes: 1 };

describe('LaserJobGenerator', () => {
    it('vector square: G0 travel then M4 and G1 cuts at S500 for 50%', async () => {
        const res = await generateLaserJob({
            operations: [{
                id: 'v1', type: 'vector_cut', enabled: true, settings,
                vectors: [{ points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }]
            }]
        });
        const lines = res.gcode.trim().split('\n');
        expect(lines.slice(0, 4)).toEqual(['; LzrCnc laser job', 'G21', 'G90', 'M5']);
        const g0 = lines.findIndex(l => l.startsWith('G0'));
        const m4 = lines.indexOf('M4 S500');
        const firstG1 = lines.findIndex(l => l.startsWith('G1'));
        expect(lines[g0]).toBe('G0 X0 Y0 S0');
        expect(g0).toBeLessThan(m4);
        expect(m4).toBeLessThan(firstG1);
        expect(lines[firstG1]).toBe('G1 X10 Y0 S500 F1200');
        const g1 = lines.filter(l => l.startsWith('G1'));
        expect(g1).toHaveLength(4); // closed: returns to start
        expect(g1[3]).toBe('G1 X0 Y0');
        expect(lines[lines.length - 1]).toBe('M5');
        expect(res.stats.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
        expect(res.stats.estimatedTimeSec).toBeCloseTo((40 / 1200) * 60, 1);
    });

    it('cuts holes before the outline that contains them, nearest path first', async () => {
        const outline = { points: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], closed: true };
        const far = { points: [[80, 80], [90, 80], [90, 90], [80, 90]] as [number, number][], closed: true };
        const near = { points: [[10, 10], [20, 10], [20, 20], [10, 20]] as [number, number][], closed: true };
        const ordered = orderVectors([outline, far, near], [0, 0], true);
        expect(ordered.map(v => v.points[0])).toEqual([[10, 10], [80, 80], [100, 100]]);
        // Engraving keeps pure nearest-neighbour order (outline corner is closest to the origin).
        expect(orderVectors([far, outline, near], [0, 0], false)[0].points[0]).toEqual([0, 0]);
        // A closed path starts at the vertex nearest to the head.
        expect(orderVectors([near], [21, 21], true)[0].points[0]).toEqual([20, 20]);
    });

    it('tone curve: neutral by default, brightness lightens, gamma > 1 lightens mid-tones', () => {
        const id = toneCurve({});
        expect(id[0]).toBe(0);
        expect(id[128]).toBeCloseTo(128, 5);
        expect(toneCurve({ brightness: 20 })[100]).toBeGreaterThan(100);
        expect(toneCurve({ gamma: 2 })[128]).toBeGreaterThan(128);
        expect(toneCurve({ contrast: 50 })[200]).toBeGreaterThan(200);
    });

    it('uses M3 when requested and honours maxS', async () => {
        const res = await generateLaserJob({
            operations: [{ id: 'v', type: 'vector_engrave', enabled: true, settings, vectors: [{ points: [[0, 0], [5, 0]], closed: false }] }],
            options: { laserMode: 'M3', maxS: 255 }
        });
        expect(res.gcode).toContain('M3 S128');
        expect(res.gcode).not.toContain('M4');
    });

    // 2x2 image, 1 mm pixels placed at (10,20): top row black/white, bottom row white/white
    const img: GrayImage = { width: 2, height: 2, data: Uint8Array.from([0, 255, 255, 255]) };
    const rasterOp = (mode: 'threshold' | 'grayscale') => ({
        operations: [{
            id: 'r', type: 'raster' as const, enabled: true,
            settings: { power: 100, speed: 3000, passes: 1, mode, threshold: 128 },
            rasters: [{ dataUrl: 'data:image/png;base64,AA==', x: 10, y: 20, width: 2, height: 2 }]
        }]
    });

    it('raster threshold: top row maps to higher Y, only dark pixels fire, blank lines skipped', async () => {
        const res = await generateLaserJob(rasterOp('threshold'), async () => img);
        const lines = res.gcode.trim().split('\n');
        expect(lines).toContain('M4 S0');
        const g0 = lines.filter(l => l.startsWith('G0'));
        expect(g0).toEqual(['G0 X10 Y21.5']); // only the top row (y = 20 + 2 - 0.5)
        const burns = lines.filter(l => /^G1 .*S[1-9]/.test(l));
        expect(burns).toEqual(['G1 X11 S1000 F3000']);
        expect(res.stats.bounds).toEqual({ minX: 10, minY: 21.5, maxX: 11, maxY: 21.5 });
    });

    it('raster decodes a real PNG via sharp', async () => {
        const png = await sharp(Buffer.from([0, 255, 255, 255]), { raw: { width: 2, height: 2, channels: 1 } }).png().toBuffer();
        const req = rasterOp('threshold');
        req.operations[0].rasters[0].dataUrl = 'data:image/png;base64,' + png.toString('base64');
        const res = await generateLaserJob(req);
        expect(res.gcode).toContain('G0 X10 Y21.5');
        expect(res.gcode).toContain('G1 X11 S1000');
    });

    it('raster overscan and bidirectional scanning', async () => {
        const full: GrayImage = { width: 2, height: 2, data: Uint8Array.from([0, 0, 0, 0]) };
        const req = rasterOp('threshold');
        (req.operations[0].settings as any).overscan = 1;
        const lines = (await generateLaserJob(req, async () => full)).gcode.split('\n');
        expect(lines).toContain('G0 X9 Y21.5');
        expect(lines).toContain('G1 X12 S1000');   // merged run left→right
        expect(lines).toContain('G0 X13 Y20.5');  // second row starts from the right
        expect(lines).toContain('G1 X10 S1000');  // right→left
        expect(lines).toContain('G1 X9 S0');      // overscan out
    });

    it('rejects invalid input', () => {
        expect(() => validateLaserJob({})).toThrow(LaserJobValidationError);
        expect(() => validateLaserJob({ operations: [{ id: 'a', type: 'vector_cut', enabled: true, settings: { power: 150, speed: 100 } }] }))
            .toThrow(LaserJobValidationError);
    });
});
