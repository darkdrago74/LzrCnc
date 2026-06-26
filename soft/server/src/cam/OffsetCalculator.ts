/**
 * OffsetCalculator.ts
 *
 * Applies geometric polygon offsets using js-clipper (already in server/package.json).
 *
 * Convention:
 *   distance > 0  → outside (expand)
 *   distance < 0  → inside  (shrink)
 *   distance = 0  → no-op   (returns original)
 *
 * js-clipper needs integer coordinates — all values are scaled by SCALE (×1000)
 * giving 0.001 mm precision.
 */

import type { PathPoint } from './PathAnalyzer.js';

const SCALE = 1000;

function toClipper(pts: PathPoint[]): { X: number; Y: number }[] {
    return pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

function fromClipper(path: { X: number; Y: number }[]): PathPoint[] {
    return path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

export class OffsetCalculator {
    private CL: any;

    constructor() {
        this.CL = require('js-clipper');
    }

    /**
     * Apply a uniform offset to a polygon or polyline.
     *
     * @param points   Source path points. If closed, pass WITHOUT a duplicate closing point.
     * @param distance Offset distance in mm. Positive = expand, negative = shrink.
     * @param closed   true → treat as closed polygon; false → open polyline.
     * @returns        Array of result polygons (may be empty when the shape collapses).
     */
    applyOffset(points: PathPoint[], distance: number, closed: boolean): PathPoint[][] {
        if (Math.abs(distance) < 0.001) return [points];

        const CL = this.CL;

        // Remove closing duplicate if present (first ≈ last)
        let pts = points;
        if (closed && pts.length > 1) {
            const first = pts[0], last = pts[pts.length - 1];
            if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
                pts = pts.slice(0, -1);
            }
        }
        if (pts.length < 2) return [];

        // miterLimit=2 handles sharp corners well; arcTolerance=0.25 controls arc smoothness
        const co = new CL.ClipperOffset(2.0, 0.25);
        co.AddPath(
            toClipper(pts),
            CL.JoinType.jtRound,
            closed ? CL.EndType.etClosedPolygon : CL.EndType.etOpenRound
        );

        const solution: { X: number; Y: number }[][] = [];
        co.Execute(solution, distance * SCALE);

        if (!solution || solution.length === 0) return [];
        return solution.map(fromClipper);
    }
}
