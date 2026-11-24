import { describe, expect, it } from 'vitest';
import { carve, createHeightfield, simMoves, suggestFeeds, chipLoad, millTopZ, opDepth, millCutArea } from './millJob';

describe('milling simulation', () => {
    const stock = { width: 20, height: 20, thickness: 10, x: 0, y: 0 };

    it('removes a tool-width slot at the programmed depth only below Z0', () => {
        const gcode = [
            '; LzrCnc 2.5D milling job',
            '; TOOL D=4 TYPE=endmill',
            'G0 X2 Y10 Z5',
            'G1 Z-3 F300',
            'G1 X18 F1000',
            'G0 Z5',
        ];
        const moves = simMoves(gcode);
        expect(moves.every(m => m.r === 2)).toBe(true);
        const hf = carve(createHeightfield(stock, 40), moves);
        const at = (x: number, y: number) => hf.h[Math.round((y - hf.y0) / hf.dy) * hf.nx + Math.round((x - hf.x0) / hf.dx)];
        expect(at(10, 10)).toBeCloseTo(7);
        expect(at(10, 11.5)).toBeCloseTo(7);
        expect(at(10, 13)).toBeCloseTo(10);
        expect(at(10, 2)).toBeCloseTo(10);
    });

    it('stops at the requested move count (progress slider)', () => {
        const gcode = ['; TOOL D=2', 'G0 X5 Y5', 'G1 Z-1 F100', 'G1 Z-2', 'G1 Z-5'];
        const moves = simMoves(gcode);
        expect(moves).toHaveLength(3);
        const hf = carve(createHeightfield(stock, 20), moves, 2);
        expect(Math.min(...hf.h)).toBeCloseTo(8);
    });

    it('programs with Z0 on the stock bottom simulate the same cut', () => {
        const gcode = [
            '; LzrCnc 2.5D milling job',
            '; Work zero: X/Y = bed origin, Z0 = BOTTOM of the stock (bed / spoilboard); stock top = Z10',
            '; TOOL D=4',
            'G0 X2 Y10 Z15',
            'G1 Z7 F300',
            'G1 X18 F1000',
        ];
        expect(millTopZ(gcode)).toBe(10);
        expect(millTopZ(['; LzrCnc 2.5D milling job', '; Work zero: X/Y = bed origin, Z0 = TOP of the stock'])).toBe(0);
        const moves = simMoves(gcode, millTopZ(gcode));
        expect(moves).toHaveLength(2);
        const hf = carve(createHeightfield(stock, 40), moves);
        expect(Math.min(...hf.h)).toBeCloseTo(7);
    });
});

describe('depth reference', () => {
    it('"left above bottom" is converted to a depth below the top', () => {
        expect(opDepth({ depth: 5, depthRef: 'bottom', floor: 1 }, { thickness: 13 })).toBe(12);
        expect(opDepth({ depth: 5, depthRef: 'top', floor: 1 }, { thickness: 13 })).toBe(5);
        expect(opDepth({ depth: 5 }, { thickness: 13 })).toBe(5);
    });

    it('cut area includes the tool radius', () => {
        const area = millCutArea({ toolpaths: [{ opId: 'a', type: 'profile', closed: true, points: [[10, 10], [50, 30]] }] },
            [{ id: 'a', tool: { name: 't', type: 'endmill', diameter: 6, flutes: 2 } }]);
        expect(area).toEqual({ minX: 7, minY: 7, maxX: 53, maxY: 33 });
    });
});

describe('feeds', () => {
    it('suggests a sane chip load for a 6 mm 2-flute in wood', () => {
        const tool = { name: 't', type: 'endmill' as const, diameter: 6, flutes: 2 };
        const f = suggestFeeds('Wood', tool);
        const cl = chipLoad({ ...f, tool });
        expect(cl).toBeGreaterThan(0.04);
        expect(cl).toBeLessThan(0.35);
        expect(f.stepdown).toBeCloseTo(2);
    });
});
