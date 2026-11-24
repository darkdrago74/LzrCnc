import { describe, it, expect } from 'vitest';
import { polygonPoints, polygonAcrossFlats, shapeSize, shapeSvg, traceBitmap } from './shapes';
import { burnMap } from './rasterPreview';

describe('polygon on a construction circle', () => {
    it('sizes a hex nut by across-flats with a flat on top and its centre at the circle centre', () => {
        const p = { shape: 'polygon' as const, sides: 6, diameter: 10, sizeBy: 'flats' as const };
        const D = 10 / Math.cos(Math.PI / 6);
        expect(shapeSize(p)[0]).toBeCloseTo(D);
        expect(polygonAcrossFlats(p)).toBeCloseTo(10);
        const pts = polygonPoints(p);
        const ys = pts.map(q => q[1]);
        // Flat on top/bottom: distance between them = across flats, centred in the circle box
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10);
        expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(D / 2);
        expect(pts.filter(q => Math.abs(q[1] - Math.min(...ys)) < 1e-9)).toHaveLength(2);
    });

    it('adds a centre hole and keeps the construction circle out of the output', () => {
        const svg = shapeSvg({ shape: 'polygon', sides: 6, diameter: 20, hole: 5 });
        expect(svg).toContain('<polygon');
        expect(svg).toMatch(/<circle cx="10" cy="10" r="2.5"/);
        expect(svg).not.toContain('stroke-dasharray');
    });
});

describe('traceBitmap', () => {
    it('traces a ring as an outer loop and a hole loop', () => {
        // 10×10 square with a 4×4 hole in the middle
        const inside = (x: number, y: number) => !(x >= 3 && x < 7 && y >= 3 && y < 7);
        const loops = traceBitmap(inside, 10, 10);
        expect(loops).toHaveLength(2);
        const areas = loops.map(l => Math.abs(l.reduce((a, p, i) => { const q = l[(i + 1) % l.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2)).sort((a, b) => a - b);
        expect(areas).toEqual([16, 100]);
    });
});

describe('raster burn preview', () => {
    it('never burns white and follows the threshold', () => {
        const gray = new Uint8ClampedArray([0, 100, 200, 255]);
        expect(Array.from(burnMap(gray, 4, 1, { mode: 'threshold', threshold: 150 }))).toEqual([1, 1, 0, 0]);
        const g = burnMap(gray, 4, 1, { mode: 'grayscale', power: 100, minPower: 0 });
        expect(g[0]).toBeCloseTo(1);
        expect(g[3]).toBe(0);
    });

    it('brightness lightens the image (less burn)', () => {
        const gray = new Uint8ClampedArray([128]);
        const base = burnMap(gray, 1, 1, { mode: 'grayscale' })[0];
        expect(burnMap(gray, 1, 1, { mode: 'grayscale', brightness: 30 })[0]).toBeLessThan(base);
    });
});
