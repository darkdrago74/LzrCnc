import { describe, it, expect } from 'vitest';
import { parseGcode } from './gcodeParser';

describe('parseGcode', () => {
    it('separates rapids from cuts and tracks modal state', () => {
        const r = parseGcode(['G21 G90', 'G0 X10 Y0', 'M4 S500', 'G1 X20 F600', 'Y10', 'G0 X0 Y0']);
        expect(r.segments.map(s => s.kind)).toEqual(['rapid', 'cut', 'cut', 'rapid']);
        expect(r.segments[2].s).toBe(500);
        expect(r.cutLength).toBeCloseTo(20);
        expect(r.cutBounds.min.x).toBe(10);
        expect(r.cutBounds.max.y).toBe(10);
    });

    it('handles relative mode, inches and comments', () => {
        const r = parseGcode(['G20 G91 ; inch relative', 'G1 X1 (one inch) F10', 'G1 X1']);
        const last = r.segments[r.segments.length - 1];
        expect(last.to[0]).toBeCloseTo(50.8);
    });

    it('interpolates arcs (I/J) along the circle', () => {
        const r = parseGcode(['G0 X10 Y0', 'G3 X-10 Y0 I-10 J0 F600']);
        const cuts = r.segments.filter(s => s.kind === 'cut');
        expect(cuts.length).toBeGreaterThan(10);
        expect(r.cutBounds.max.y).toBeCloseTo(10, 1);
        expect(r.cutLength).toBeCloseTo(Math.PI * 10, 0);
    });

    it('estimates time from feed rate', () => {
        const r = parseGcode(['G1 X100 F600']);
        expect(r.estimatedTime).toBeCloseTo(10, 0);
    });
});
