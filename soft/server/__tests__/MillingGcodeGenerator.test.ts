import { describe, it, expect } from 'vitest';
import { generateMillingJob, depthLevels, MillJobValidationError, MillOperation, Pt } from '../src/cam/MillingGcodeGenerator';

type Move = { g: 0 | 1; from: [number, number, number]; to: [number, number, number] };

function moves(gcode: string): Move[] {
    let p: [number, number, number] = [0, 0, 5];
    const out: Move[] = [];
    for (const raw of gcode.split('\n')) {
        const line = raw.split(';')[0].trim();
        const m = line.match(/^G([01])\b/);
        if (!m) continue;
        const to = [...p] as [number, number, number];
        for (const [axis, i] of [['X', 0], ['Y', 1], ['Z', 2]] as const) {
            const v = line.match(new RegExp(`${axis}(-?[\\d.]+)`));
            if (v) to[i] = parseFloat(v[1]);
        }
        out.push({ g: Number(m[1]) as 0 | 1, from: p, to });
        p = to;
    }
    return out;
}

const square = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const circle = (cx: number, cy: number, r: number, n = 64): Pt[] =>
    Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)] as Pt);

const tool6 = { name: '6mm flat', type: 'endmill' as const, diameter: 6, flutes: 2 };
const base = { tool: tool6, feed: 1200, plunge: 300, rpm: 16000, stepdown: 2, rampAngle: 3 };
const wood = { width: 200, height: 200, thickness: 13, material: 'Wood (birch ply)' };

describe('MillingGcodeGenerator', () => {
    it('depthLevels splits the depth in equal steps not larger than stepdown', () => {
        depthLevels(4, 12, 3).forEach((z, k) => expect(z).toBeCloseTo([-20 / 3, -28 / 3, -12][k], 9));
        expect(depthLevels(0, 1, 2)).toEqual([-1]);
    });

    it('Z0 at the bottom shifts every Z word by the stock thickness', () => {
        const ops: MillOperation[] = [{ id: 'p', type: 'profile', cutSide: 'outside', contourIds: ['sq'], depth: 12, ...base }];
        const req = { stock: wood, safeZ: 5, contours: [{ id: 'sq', points: square(50, 50, 100, 100), closed: true }], operations: ops };
        const top = generateMillingJob(req);
        const bottom = generateMillingJob({ ...req, zZero: 'bottom' as const });
        expect(bottom.gcode).toContain('Z0 = BOTTOM of the stock');
        expect(bottom.stats.bounds.min[2]).toBeCloseTo(1, 6);
        const zs = (g: string) => [...g.matchAll(/Z(-?[\d.]+)/g)].map(m => parseFloat(m[1])).filter(z => !Number.isNaN(z));
        const a = zs(top.gcode.split('\n').filter(l => !l.startsWith(';')).join('\n'));
        const b = zs(bottom.gcode.split('\n').filter(l => !l.startsWith(';')).join('\n'));
        expect(b.length).toBe(a.length);
        b.forEach((z, k) => expect(z).toBeCloseTo(a[k] + 13, 6));
    });

    it('13 mm stock: face 4 mm then outside profile to -12 leaves a 1 mm skin', () => {
        const ops: MillOperation[] = [
            { id: 'face', type: 'face', depth: 4, stepoverPct: 40, ...base },
            { id: 'prof', type: 'profile', cutSide: 'outside', contourIds: ['sq'], startDepth: 4, depth: 12, ...base },
        ];
        const res = generateMillingJob({ stock: wood, safeZ: 5, contours: [{ id: 'sq', points: square(50, 50, 100, 100), closed: true }], operations: ops });
        expect(res.warnings.filter(w => w.level === 'error')).toEqual([]);
        expect(res.warnings.some(w => /through-cut/.test(w.message))).toBe(false);
        expect(res.stats.bounds.min[2]).toBeCloseTo(-12, 6);
        expect(res.gcode).toContain('TOOL D=6');
        expect(res.gcode).toMatch(/M3 S16000\nG4 P3/);

        // Profile toolpath sits one tool radius outside the square.
        const prof = res.toolpaths.find(t => t.opId === 'prof')!;
        const xs = prof.points.map(p => p[0]), ys = prof.points.map(p => p[1]);
        expect(Math.min(...xs)).toBeCloseTo(47, 2);
        expect(Math.max(...xs)).toBeCloseTo(153, 2);
        expect(Math.min(...ys)).toBeCloseTo(47, 2);

        // Facing covers the whole stock top, entering from outside the stock.
        const mv = moves(res.gcode);
        const faceCuts = mv.filter(m => m.g === 1 && Math.abs(m.to[2] + 4) < 1e-6 && m.from[2] === m.to[2]);
        const fy = faceCuts.flatMap(m => [m.from[1], m.to[1]]);
        expect(Math.min(...fy) - 3).toBeLessThanOrEqual(0);
        expect(Math.max(...fy) + 3).toBeGreaterThanOrEqual(200);
        expect(Math.min(...faceCuts.flatMap(m => [m.from[0], m.to[0]]))).toBeLessThan(-3);
        const firstFaceCut = mv.find(m => m.g === 1)!;
        expect(firstFaceCut.to[0]).toBeLessThan(0);

        // Flip side: 9 mm stock, face 1 mm frees the part.
        const sideB = generateMillingJob({ stock: { ...wood, thickness: 9 }, operations: [{ id: 'f', type: 'face', depth: 1, ...base }] });
        expect(sideB.warnings.filter(w => w.level === 'error')).toEqual([]);
        expect(sideB.stats.bounds.min[2]).toBeCloseTo(-1, 6);
    });

    it('ramps into the material at the requested angle instead of plunging', () => {
        const res = generateMillingJob({
            stock: wood,
            contours: [{ id: 'sq', points: square(50, 50, 100, 100), closed: true }],
            operations: [{ id: 'p', type: 'profile', cutSide: 'outside', contourIds: ['sq'], depth: 3, ...base, stepdown: 1, rampAngle: 5 }],
        });
        const mv = moves(res.gcode).filter(m => m.g === 1 && m.to[2] < 0);
        const descending = mv.filter(m => m.to[2] < m.from[2] - 1e-9 && m.from[2] <= 0);
        expect(descending.length).toBeGreaterThan(0);
        for (const m of descending) {
            const dxy = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
            const dz = m.from[2] - m.to[2];
            expect(Math.atan2(dz, dxy) * 180 / Math.PI).toBeCloseTo(5, 0);
        }
        expect(res.operations[0].rampLength).toBeCloseTo(1 / Math.tan(5 * Math.PI / 180), 3);
        expect(res.warnings.some(w => w.level === 'info' && /ramp entry 5°/.test(w.message))).toBe(true);
    });

    it('reports a tool that is too large for an inside cut or a pocket', () => {
        const res = generateMillingJob({
            stock: wood,
            contours: [{ id: 'hole', points: circle(100, 100, 2.5), closed: true }],
            operations: [
                { id: 'in', type: 'profile', cutSide: 'inside', contourIds: ['hole'], depth: 3, ...base },
                { id: 'pk', type: 'pocket', contourIds: ['hole'], depth: 3, ...base },
            ],
        });
        expect(res.warnings.filter(w => w.level === 'error').map(w => w.opId)).toEqual(['in', 'pk', undefined]);
        expect(res.warnings.find(w => w.opId === 'in' && w.level === 'error')!.message).toMatch(/too large/);
    });

    it('names a pocket contour too small for the tool and still cuts the others', () => {
        const res = generateMillingJob({
            stock: wood,
            contours: [
                { id: 'small', name: 'tiny', points: square(30, 30, 5, 5), closed: true },
                { id: 'big', points: square(100, 100, 30, 20), closed: true },
            ],
            operations: [{ id: 'pk', type: 'pocket', contourIds: ['small', 'big'], depth: 2, ...base }],
        });
        const err = res.warnings.filter(w => w.level === 'error');
        expect(err).toHaveLength(1);
        expect(err[0].message).toMatch(/too large for "tiny" \(5\.0 × 5\.0 mm\)/);
        const cuts = moves(res.gcode).filter(m => m.g === 1 && m.to[2] < 0).map(m => m.to);
        expect(cuts.length).toBeGreaterThan(0);
        expect(cuts.every(([x, y]) => x > 100 && x < 130 && y > 100 && y < 120)).toBe(true);
    });

    it('warns when a pocket has features narrower than the tool', () => {
        // 40x40 pocket with a 4 mm wide, 20 mm long slot sticking out of it.
        const shape: Pt[] = [[0, 0], [40, 0], [40, 40], [22, 40], [22, 60], [18, 60], [18, 40], [0, 40], [0, 0]];
        const res = generateMillingJob({
            stock: wood,
            contours: [{ id: 's', points: shape.map(([x, y]) => [x + 50, y + 50] as Pt), closed: true }],
            operations: [{ id: 'pk', type: 'pocket', contourIds: ['s'], depth: 2, ...base }],
        });
        expect(res.warnings.some(w => w.level === 'warning' && /narrower than the tool/.test(w.message))).toBe(true);

        // A plain square pocket only loses its unavoidable corner radii: no warning.
        const ok = generateMillingJob({
            stock: wood,
            contours: [{ id: 'q', points: square(50, 50, 40, 30), closed: true }],
            operations: [{ id: 'pk', type: 'pocket', contourIds: ['q'], depth: 2, ...base }],
        });
        expect(ok.warnings.some(w => /narrower|tight corners/.test(w.message))).toBe(false);
    });

    it('clears the whole pocket floor (concentric rings within one stepover)', () => {
        const res = generateMillingJob({
            stock: wood,
            contours: [{ id: 'c', points: circle(100, 100, 20), closed: true }, { id: 'q', points: square(20, 20, 40, 30), closed: true }],
            operations: [{ id: 'pk', type: 'pocket', contourIds: ['c', 'q'], depth: 4, ...base, stepoverPct: 45 }],
        });
        const floor = moves(res.gcode).filter(m => m.g === 1 && Math.abs(m.to[2] + 4) < 1e-6 && Math.abs(m.from[2] + 4) < 1e-6);
        const r = 3;
        const near = (x: number, y: number) => floor.some(m => {
            const [ax, ay] = m.from, [bx, by] = m.to;
            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
            return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= r + 1e-6;
        });
        const misses: string[] = [];
        for (let x = 81; x <= 119; x += 1.5) for (let y = 81; y <= 119; y += 1.5) {
            if (Math.hypot(x - 100, y - 100) < 19.5 && !near(x, y)) misses.push(`${x},${y}`);
        }
        // Square: everything except the four corner radii is cleared.
        for (let x = 20.5; x <= 59.5; x += 1.5) for (let y = 20.5; y <= 49.5; y += 1.5) {
            const cx = Math.min(Math.max(x, 23), 57), cy = Math.min(Math.max(y, 23), 47);
            if (Math.hypot(x - cx, y - cy) <= r - 0.05 && !near(x, y)) misses.push(`${x},${y}`);
        }
        expect(misses).toEqual([]);
        // Never cuts outside the pocket walls.
        for (const m of floor) for (const p of [m.from, m.to]) {
            const inCircle = Math.hypot(p[0] - 100, p[1] - 100) <= 17 + 1e-3;
            const inSquare = p[0] >= 23 - 1e-3 && p[0] <= 57 + 1e-3 && p[1] >= 23 - 1e-3 && p[1] <= 47 + 1e-3;
            expect(inCircle || inSquare).toBe(true);
        }
    });

    it('flags through-cuts, spoilboard cuts, aggressive steps and chip load', () => {
        const res = generateMillingJob({
            stock: wood,
            contours: [{ id: 'sq', points: square(50, 50, 100, 100), closed: true }],
            operations: [
                { id: 'thru', type: 'profile', cutSide: 'outside', contourIds: ['sq'], depth: 13, ...base },
                { id: 'deep', type: 'profile', cutSide: 'outside', contourIds: ['sq'], depth: 15, ...base, stepdown: 8, feed: 100 },
            ],
        });
        const msgs = (id: string) => res.warnings.filter(w => w.opId === id).map(w => `${w.level}: ${w.message}`).join('\n');
        expect(msgs('thru')).toMatch(/warning: .*through-cut/);
        expect(msgs('deep')).toMatch(/error: .*2 mm below the stock/);
        expect(msgs('deep')).toMatch(/stepdown 8 mm is larger than the tool diameter/);
        expect(msgs('deep')).toMatch(/chip load 0\.003 .*low for wood/);
    });

    it('rejects structurally invalid requests', () => {
        expect(() => generateMillingJob({ stock: { width: 0, height: 10, thickness: 5 }, operations: [] } as any)).toThrow(MillJobValidationError);
        expect(() => generateMillingJob({ stock: wood, operations: [{ id: 'x', type: 'face', depth: 1, ...base, tool: { diameter: 0 } }] })).toThrow(/tool diameter/);
    });
});
