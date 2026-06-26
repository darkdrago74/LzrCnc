/**
 * MillingGcodeGenerator.ts
 *
 * Generates 2.5D milling G-code from a list of operations.
 *
 * Per-path workflow:
 *   1. Apply XY drag offset (from user positioning in the visualizer)
 *   2. Apply tool-radius geometric offset (inside = shrink, outside = expand, on = none)
 *   3. Slice into Z passes from stock surface down to target depth
 *   4. Emit: G0 rapid to XY → G1 plunge → G1 feed along loop → G0 retract
 *
 * Returns the G-code string PLUS toolpath polygons (offset outlines) for the
 * 3D visualizer to render as a preview overlay.
 */

import type { DetectedPath, PathPoint } from './PathAnalyzer.js';
import { OffsetCalculator } from './OffsetCalculator.js';

// ── Request / response types ──────────────────────────────────────────────────

export interface MillingOpRequest {
    id: string;
    label: string;
    pathIds: string[];
    cutSide: 'inside' | 'outside' | 'on';
    depth: number;         // total depth below stock surface (positive mm)
    depthPerPass: number;  // depth increment per pass (positive mm)
    feedrate: number;      // cutting feed rate (mm/min)
    plungeRate: number;    // plunge feed rate (mm/min)
    spindleSpeed: number;  // RPM
    toolDiameter: number;  // endmill diameter (mm) — for offset calculation
    safeZ: number;         // retract height above stock surface (mm)
}

export interface MillingJobRequest {
    paths: DetectedPath[];
    /** Per-path XY translation offsets set by user drag in the visualizer */
    pathOffsets: Record<string, [number, number, number]>;
    operations: MillingOpRequest[];
    /** Z level of the stock top surface (usually 0) */
    stockSurface: number;
}

export interface ToolpathPolygonResult {
    id: string;
    points: PathPoint[];
    cutSide: 'inside' | 'outside' | 'on';
}

export interface MillingResult {
    gcode: string;
    toolpathPolygons: ToolpathPolygonResult[];
    stats: { lines: number; estimatedTime: string };
}

// ── Generator ─────────────────────────────────────────────────────────────────

export class MillingGcodeGenerator {
    private offsetCalc = new OffsetCalculator();

    generate(req: MillingJobRequest): MillingResult {
        const { paths, pathOffsets, operations, stockSurface } = req;
        const lines: string[] = [];
        const toolpathPolygons: ToolpathPolygonResult[] = [];

        const pathMap = new Map<string, DetectedPath>(paths.map(p => [p.id, p]));

        // Use the highest safeZ across all operations
        const globalSafeZ = operations.reduce((max, o) => Math.max(max, o.safeZ ?? 5), 5);

        // ── Header ────────────────────────────────────────────────────────
        lines.push('; LzrCNC 2.5D Milling Job');
        lines.push(`; Generated: ${new Date().toISOString()}`);
        lines.push('G21 ; mm mode');
        lines.push('G90 ; absolute positioning');
        lines.push('G17 ; XY plane');
        lines.push(`G0 Z${globalSafeZ.toFixed(3)} ; move to safe height`);

        let lastSpindle = -1;

        for (const op of operations) {
            const opSafeZ = op.safeZ ?? globalSafeZ;

            lines.push('');
            lines.push(`; === ${op.label} — ${op.cutSide} cut, total depth ${op.depth}mm ===`);

            // Only re-emit spindle command if speed changed
            if (op.spindleSpeed !== lastSpindle) {
                lines.push(`M3 S${op.spindleSpeed}`);
                lastSpindle = op.spindleSpeed;
            }

            // Tool-radius offset distance (half diameter, signed)
            const offsetDist =
                (op.toolDiameter / 2) *
                (op.cutSide === 'inside' ? -1 : op.cutSide === 'outside' ? 1 : 0);

            for (const pathId of op.pathIds) {
                const path = pathMap.get(pathId);
                if (!path || path.points.length < 2) continue;

                // 1. Apply user-drag XY offset
                const [ox, oy] = pathOffsets[pathId] ?? [0, 0, 0];
                const shifted: PathPoint[] = path.points.map(p => ({ x: p.x + ox, y: p.y + oy }));

                // 2. Apply geometric offset (tool radius compensation)
                let toolPoints: PathPoint[];
                if (Math.abs(offsetDist) > 0.001 && path.closed) {
                    const polygons = this.offsetCalc.applyOffset(shifted, offsetDist, true);
                    if (polygons.length === 0) {
                        lines.push(`; WARN: path ${pathId} collapsed under offset — skipped`);
                        continue;
                    }
                    // Take the polygon with the most points (handles multi-island results)
                    toolPoints = polygons.reduce((a, b) => a.length >= b.length ? a : b);
                } else {
                    // Open path or on-line: use shifted points directly
                    toolPoints = shifted;
                }

                if (toolPoints.length < 2) continue;

                // Store for visualizer preview
                toolpathPolygons.push({ id: `tp_${op.id}_${pathId}`, points: toolPoints, cutSide: op.cutSide });

                // 3. Remove closing duplicate to avoid double-hitting start point
                let loopPts = toolPoints;
                if (path.closed && toolPoints.length > 1) {
                    const f = toolPoints[0], l = toolPoints[toolPoints.length - 1];
                    if (Math.abs(f.x - l.x) < 0.01 && Math.abs(f.y - l.y) < 0.01) {
                        loopPts = toolPoints.slice(0, -1);
                    }
                }
                if (loopPts.length < 1) continue;

                // 4. Compute Z-depth pass list
                const zPasses: number[] = [];
                let z = stockSurface;
                const targetZ = stockSurface - op.depth;
                while (z > targetZ + 0.0001) {
                    z = Math.max(z - op.depthPerPass, targetZ);
                    zPasses.push(parseFloat(z.toFixed(4)));
                }
                if (zPasses.length === 0) zPasses.push(targetZ);

                const start = loopPts[0];
                lines.push(`; path ${pathId} — ${loopPts.length} pts, ${zPasses.length} pass(es)`);

                for (const passZ of zPasses) {
                    lines.push(`; pass Z=${passZ.toFixed(3)}`);
                    lines.push(`G0 Z${opSafeZ.toFixed(3)}`);
                    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`);
                    lines.push(`G1 Z${passZ.toFixed(3)} F${op.plungeRate}`);
                    lines.push(`G1 F${op.feedrate}`);

                    for (let i = 1; i < loopPts.length; i++) {
                        const p = loopPts[i];
                        lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`);
                    }

                    // Close the loop for closed paths
                    if (path.closed) {
                        lines.push(`G1 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`);
                    }
                }

                lines.push(`G0 Z${opSafeZ.toFixed(3)}`);
            }
        }

        // ── Footer ────────────────────────────────────────────────────────
        lines.push('');
        lines.push('; === End of job ===');
        lines.push('M5 ; spindle off');
        lines.push(`G0 Z${globalSafeZ.toFixed(3)}`);
        lines.push('G0 X0 Y0');

        const gcode = lines.join('\n');

        // Rough time estimate based on total toolpath length / average feed rate
        const totalLength = toolpathPolygons.reduce((sum, tp) => {
            let len = 0;
            for (let i = 1; i < tp.points.length; i++) {
                const dx = tp.points[i].x - tp.points[i - 1].x;
                const dy = tp.points[i].y - tp.points[i - 1].y;
                len += Math.sqrt(dx * dx + dy * dy);
            }
            return sum + len;
        }, 0);
        const avgFeed = operations.length > 0
            ? operations.reduce((s, o) => s + o.feedrate, 0) / operations.length
            : 1000;
        const estMin = totalLength / avgFeed;
        const estimatedTime = estMin < 1
            ? `${Math.round(estMin * 60)}s`
            : `${estMin.toFixed(1)} min`;

        return { gcode, toolpathPolygons, stats: { lines: lines.length, estimatedTime } };
    }
}
