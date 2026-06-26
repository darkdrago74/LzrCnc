/**
 * PathAnalyzer.ts
 *
 * Parses DXF and SVG files into DetectedPath objects.
 * Each DetectedPath carries:
 *   - discretized points ready for Three.js rendering
 *   - a closed/open flag detected via connectivity graph
 *   - a shape classification (circle, rectangle, polygon, closed_curve, open_curve)
 *   - raw primitives for precise G-code generation later
 *
 * No new dependencies — uses dxf-parser (already installed).
 * Offset computation (internal/external) uses js-clipper (already installed) in Phase 2.
 */

import DxfParser from 'dxf-parser';

// ── Public types ────────────────────────────────────────────────────────────

export type PathClassification =
    | 'circle'
    | 'ellipse'
    | 'rectangle'
    | 'polygon'
    | 'closed_curve'  // closed but contains curves (arcs/splines)
    | 'open_curve';   // open — tool will always follow the middle of the line

export interface PathPoint {
    x: number;
    y: number;
}

export type RawPrimitive =
    | { type: 'line';     x1: number; y1: number; x2: number; y2: number }
    | { type: 'arc';      cx: number; cy: number; radius: number; startAngle: number; endAngle: number }
    | { type: 'circle';   cx: number; cy: number; radius: number }
    | { type: 'polyline'; points: PathPoint[]; closed: boolean };

export interface PathBounds {
    minX: number; minY: number;
    maxX: number; maxY: number;
    width: number; height: number;
}

export interface DetectedPath {
    id: string;
    closed: boolean;
    classification: PathClassification;
    /** Discretized points — direct input for THREE.BufferGeometry */
    points: PathPoint[];
    bounds: PathBounds;
    /** Original geometric primitives for precise G-code generation */
    rawPrimitives: RawPrimitive[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Matching tolerance between two endpoints (mm) */
const ENDPOINT_TOLERANCE = 0.01;
/** Segments used to approximate a full circle */
const CIRCLE_SEGMENTS = 64;
/** Segments used to approximate an arc per 360° */
const ARC_SEGMENTS_FULL = 64;

interface OpenSegment {
    id: string;
    x1: number; y1: number;
    x2: number; y2: number;
    raw: RawPrimitive;
    visited: boolean;
}

// ── PathAnalyzer class ───────────────────────────────────────────────────────

export class PathAnalyzer {

    // ── DXF entry point ───────────────────────────────────────────────────

    analyzeDxf(dxfContent: string): DetectedPath[] {
        let parser: any;
        try {
            if (typeof DxfParser === 'function') {
                parser = new (DxfParser as any)();
            } else if ((DxfParser as any).default) {
                parser = new (DxfParser as any).default();
            } else {
                parser = new (require('dxf-parser'))();
            }
        } catch {
            parser = new (require('dxf-parser'))();
        }

        const dxf = parser.parseSync(dxfContent);
        if (!dxf?.entities) return [];

        const paths: DetectedPath[] = [];
        const openSegs: OpenSegment[] = [];
        let idx = 0;

        for (const entity of dxf.entities) {
            const handle = entity.handle ?? String(idx++);

            switch (entity.type) {

                case 'CIRCLE': {
                    const pts = this.discretizeCircle(
                        entity.center.x, entity.center.y, entity.radius
                    );
                    paths.push(this.makeDetectedPath(
                        `circle_${handle}`, true, 'circle', pts,
                        [{ type: 'circle', cx: entity.center.x, cy: entity.center.y, radius: entity.radius }]
                    ));
                    break;
                }

                case 'ELLIPSE': {
                    const pts = this.discretizeEllipse(
                        entity.center,
                        entity.majorAxisEndPoint,
                        entity.axisRatio ?? 1
                    );
                    paths.push(this.makeDetectedPath(
                        `ellipse_${handle}`, true, 'ellipse', pts, []
                    ));
                    break;
                }

                case 'LWPOLYLINE':
                case 'POLYLINE': {
                    const closed = !!(entity.shape || entity.closed);
                    const verts: PathPoint[] = entity.vertices.map((v: any) => ({ x: v.x, y: v.y }));
                    if (verts.length < 2) break;

                    if (closed) {
                        const pts = [...verts, verts[0]]; // close the loop visually
                        paths.push(this.makeDetectedPath(
                            `poly_${handle}`, true, this.classifyCorners(verts),
                            pts, [{ type: 'polyline', points: verts, closed: true }]
                        ));
                    } else {
                        // Open polyline — kept as-is, will be classified as open_curve
                        paths.push(this.makeDetectedPath(
                            `poly_${handle}`, false, 'open_curve',
                            verts, [{ type: 'polyline', points: verts, closed: false }]
                        ));
                    }
                    break;
                }

                case 'LINE': {
                    // DXF LINE has two vertices
                    const x1 = entity.vertices[0].x, y1 = entity.vertices[0].y;
                    const x2 = entity.vertices[1].x, y2 = entity.vertices[1].y;
                    openSegs.push({
                        id: `line_${handle}`,
                        x1, y1, x2, y2,
                        raw: { type: 'line', x1, y1, x2, y2 },
                        visited: false
                    });
                    break;
                }

                case 'ARC': {
                    // DXF ARC angles are in DEGREES (counterclockwise from +X)
                    const { startAngle, endAngle } = entity;
                    const span = ((endAngle - startAngle) + 360) % 360 || 360;

                    if (span > 359.5) {
                        // Near-full-circle arc → treat as circle
                        const pts = this.discretizeCircle(entity.center.x, entity.center.y, entity.radius);
                        paths.push(this.makeDetectedPath(
                            `arc_${handle}`, true, 'circle', pts,
                            [{ type: 'circle', cx: entity.center.x, cy: entity.center.y, radius: entity.radius }]
                        ));
                    } else {
                        const startRad = startAngle * Math.PI / 180;
                        const endRad   = endAngle   * Math.PI / 180;
                        const cx = entity.center.x, cy = entity.center.y, r = entity.radius;
                        openSegs.push({
                            id: `arc_${handle}`,
                            x1: cx + r * Math.cos(startRad), y1: cy + r * Math.sin(startRad),
                            x2: cx + r * Math.cos(endRad),   y2: cy + r * Math.sin(endRad),
                            raw: { type: 'arc', cx, cy, radius: r, startAngle, endAngle },
                            visited: false
                        });
                    }
                    break;
                }

                case 'SPLINE': {
                    const closed = !!(entity.closed || entity.periodic);
                    if (!entity.controlPoints?.length) break;

                    const verts: PathPoint[] = entity.controlPoints.map((v: any) => ({ x: v.x, y: v.y }));
                    if (closed) {
                        const pts = [...verts, verts[0]];
                        paths.push(this.makeDetectedPath(
                            `spline_${handle}`, true, 'closed_curve',
                            pts, [{ type: 'polyline', points: verts, closed: true }]
                        ));
                    } else {
                        openSegs.push({
                            id: `spline_${handle}`,
                            x1: verts[0].x, y1: verts[0].y,
                            x2: verts[verts.length - 1].x, y2: verts[verts.length - 1].y,
                            raw: { type: 'polyline', points: verts, closed: false },
                            visited: false
                        });
                    }
                    break;
                }
            }
        }

        // Build chains from open segments and determine closed/open
        const chains = this.buildChains(openSegs);
        for (const chain of chains) {
            const pts = this.chainToPoints(chain.segments);
            if (chain.closed && pts.length > 1) pts.push({ ...pts[0] });
            const classification = chain.closed
                ? this.classifyChain(chain.segments)
                : 'open_curve';
            paths.push(this.makeDetectedPath(
                `chain_${paths.length}`,
                chain.closed, classification,
                pts, chain.segments.map(s => s.raw)
            ));
        }

        return paths;
    }

    // ── SVG entry point ───────────────────────────────────────────────────

    analyzeSvg(svgContent: string): DetectedPath[] {
        const paths: DetectedPath[] = [];
        let i = 0;

        // <circle cx cy r>
        for (const m of svgContent.matchAll(/<circle[^>]*>/gi)) {
            const cx = this.svgAttr(m[0], 'cx'), cy = this.svgAttr(m[0], 'cy'), r = this.svgAttr(m[0], 'r');
            if (cx !== null && cy !== null && r !== null) {
                const pts = this.discretizeCircle(cx, cy, r);
                paths.push(this.makeDetectedPath(`svg_circle_${i++}`, true, 'circle', pts,
                    [{ type: 'circle', cx, cy, radius: r }]));
            }
        }

        // <ellipse cx cy rx ry>
        for (const m of svgContent.matchAll(/<ellipse[^>]*>/gi)) {
            const cx = this.svgAttr(m[0], 'cx'), cy = this.svgAttr(m[0], 'cy');
            const rx = this.svgAttr(m[0], 'rx'), ry = this.svgAttr(m[0], 'ry');
            if (cx !== null && cy !== null && rx !== null && ry !== null) {
                const pts = this.discretizeEllipseRadii(cx, cy, rx, ry);
                paths.push(this.makeDetectedPath(`svg_ellipse_${i++}`, true, 'ellipse', pts, []));
            }
        }

        // <rect x y width height>
        for (const m of svgContent.matchAll(/<rect[^>]*>/gi)) {
            const x = this.svgAttr(m[0], 'x') ?? 0;
            const y = this.svgAttr(m[0], 'y') ?? 0;
            const w = this.svgAttr(m[0], 'width'), h = this.svgAttr(m[0], 'height');
            if (w !== null && h !== null) {
                const corners: PathPoint[] = [
                    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
                ];
                const pts = [...corners, corners[0]];
                paths.push(this.makeDetectedPath(`svg_rect_${i++}`, true, 'rectangle', pts,
                    [{ type: 'polyline', points: corners, closed: true }]));
            }
        }

        // <polygon points="...">
        for (const m of svgContent.matchAll(/<polygon[^>]*points="([^"]*)"[^>]*>/gi)) {
            const verts = this.parseSvgPointList(m[1]);
            if (verts.length > 2) {
                const pts = [...verts, verts[0]];
                paths.push(this.makeDetectedPath(`svg_polygon_${i++}`, true, this.classifyCorners(verts), pts,
                    [{ type: 'polyline', points: verts, closed: true }]));
            }
        }

        // <polyline points="...">
        for (const m of svgContent.matchAll(/<polyline[^>]*points="([^"]*)"[^>]*>/gi)) {
            const verts = this.parseSvgPointList(m[1]);
            if (verts.length > 1) {
                paths.push(this.makeDetectedPath(`svg_polyline_${i++}`, false, 'open_curve', verts,
                    [{ type: 'polyline', points: verts, closed: false }]));
            }
        }

        // <path d="...">
        for (const m of svgContent.matchAll(/<path[^>]*\sd="([^"]*)"[^>]*/gi)) {
            const parsed = this.parseSvgPathD(m[1]);
            if (parsed.points.length > 1) {
                const classification = parsed.closed ? this.classifyCorners(parsed.points) : 'open_curve';
                paths.push(this.makeDetectedPath(`svg_path_${i++}`, parsed.closed, classification, parsed.points,
                    [{ type: 'polyline', points: parsed.points, closed: parsed.closed }]));
            }
        }

        return paths;
    }

    // ── Geometry discretization ───────────────────────────────────────────

    private discretizeCircle(cx: number, cy: number, r: number): PathPoint[] {
        const pts: PathPoint[] = [];
        for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
            const a = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    /** Discretize an arc (angles in DEGREES, counterclockwise) */
    discretizeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): PathPoint[] {
        let span = endDeg - startDeg;
        if (span <= 0) span += 360;
        const segs = Math.max(4, Math.round((span / 360) * ARC_SEGMENTS_FULL));
        const pts: PathPoint[] = [];
        for (let i = 0; i <= segs; i++) {
            const a = (startDeg + (span * i) / segs) * Math.PI / 180;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    private discretizeEllipse(center: any, majorAxisEnd: any, axisRatio: number): PathPoint[] {
        if (!center || !majorAxisEnd) return [];
        const rx = Math.sqrt(majorAxisEnd.x ** 2 + majorAxisEnd.y ** 2);
        const ry = rx * axisRatio;
        const rot = Math.atan2(majorAxisEnd.y, majorAxisEnd.x);
        return this.discretizeEllipseRadii(center.x, center.y, rx, ry, rot);
    }

    private discretizeEllipseRadii(cx: number, cy: number, rx: number, ry: number, rot = 0): PathPoint[] {
        const pts: PathPoint[] = [];
        for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
            const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
            pts.push({
                x: cx + rx * Math.cos(t) * Math.cos(rot) - ry * Math.sin(t) * Math.sin(rot),
                y: cy + rx * Math.cos(t) * Math.sin(rot) + ry * Math.sin(t) * Math.cos(rot)
            });
        }
        return pts;
    }

    // ── Chain building (connectivity graph) ──────────────────────────────

    private vertexKey(x: number, y: number): string {
        const s = Math.round(1 / ENDPOINT_TOLERANCE);
        return `${Math.round(x * s)}:${Math.round(y * s)}`;
    }

    private ptEq(x1: number, y1: number, x2: number, y2: number): boolean {
        return Math.abs(x1 - x2) < ENDPOINT_TOLERANCE &&
               Math.abs(y1 - y2) < ENDPOINT_TOLERANCE;
    }

    /**
     * Groups open segments into ordered chains using a greedy endpoint walk.
     * Handles LINE + ARC combinations that form closed loops (e.g. a rounded rectangle).
     */
    private buildChains(segs: OpenSegment[]): Array<{ segments: OpenSegment[]; closed: boolean }> {
        if (segs.length === 0) return [];

        // adjacency: vertexKey → [segId, ...]
        const adj = new Map<string, string[]>();
        const byId = new Map<string, OpenSegment>();

        for (const seg of segs) {
            byId.set(seg.id, seg);
            const k1 = this.vertexKey(seg.x1, seg.y1);
            const k2 = this.vertexKey(seg.x2, seg.y2);
            if (!adj.has(k1)) adj.set(k1, []);
            if (!adj.has(k2)) adj.set(k2, []);
            adj.get(k1)!.push(seg.id);
            adj.get(k2)!.push(seg.id);
        }

        const chains: Array<{ segments: OpenSegment[]; closed: boolean }> = [];

        for (const start of segs) {
            if (start.visited) continue;
            start.visited = true;

            const chain: OpenSegment[] = [start];
            let headX = start.x1, headY = start.y1;
            let tailX = start.x2, tailY = start.y2;

            // Greedy walk forward from tail
            let extended = true;
            while (extended) {
                extended = false;
                for (const nid of (adj.get(this.vertexKey(tailX, tailY)) ?? [])) {
                    const next = byId.get(nid)!;
                    if (next.visited) continue;
                    next.visited = true;
                    extended = true;
                    if (this.ptEq(next.x1, next.y1, tailX, tailY)) {
                        chain.push(next);
                        tailX = next.x2; tailY = next.y2;
                    } else {
                        // Need the segment reversed — create a shallow copy with swapped endpoints
                        const rev = this.reverseSegment(next);
                        chain.push(rev);
                        tailX = rev.x2; tailY = rev.y2;
                    }
                    break;
                }
            }

            const closed = this.ptEq(headX, headY, tailX, tailY);
            chains.push({ segments: chain, closed });
        }

        return chains;
    }

    private reverseSegment(seg: OpenSegment): OpenSegment {
        let reversedRaw: RawPrimitive = seg.raw;
        if (seg.raw.type === 'line') {
            reversedRaw = { type: 'line', x1: seg.raw.x2, y1: seg.raw.y2, x2: seg.raw.x1, y2: seg.raw.y1 };
        } else if (seg.raw.type === 'arc') {
            // Reverse arc direction by swapping start/end angles
            reversedRaw = { ...seg.raw, startAngle: seg.raw.endAngle, endAngle: seg.raw.startAngle };
        }
        return { ...seg, x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1, raw: reversedRaw };
    }

    private chainToPoints(segments: OpenSegment[]): PathPoint[] {
        const pts: PathPoint[] = [];
        for (const seg of segments) {
            const raw = seg.raw;
            if (raw.type === 'line') {
                if (pts.length === 0) pts.push({ x: raw.x1, y: raw.y1 });
                pts.push({ x: raw.x2, y: raw.y2 });
            } else if (raw.type === 'arc') {
                const arcPts = this.discretizeArc(raw.cx, raw.cy, raw.radius, raw.startAngle, raw.endAngle);
                if (pts.length === 0) pts.push(...arcPts);
                else pts.push(...arcPts.slice(1)); // skip duplicate junction point
            } else if (raw.type === 'polyline') {
                if (pts.length === 0) pts.push(...raw.points);
                else pts.push(...raw.points.slice(1));
            }
        }
        return pts;
    }

    // ── Classification ────────────────────────────────────────────────────

    /**
     * Classify a closed polygon by its corner count and angle profile.
     * 4 corners all at ~90° → rectangle; otherwise → polygon.
     */
    private classifyCorners(points: PathPoint[]): PathClassification {
        // Deduplicate by removing the closing repeat point if present
        const unique = this.uniqueCorners(points);
        if (unique.length === 4 && this.isRectangle(unique)) return 'rectangle';
        return 'polygon';
    }

    private classifyChain(segments: OpenSegment[]): PathClassification {
        const hasArcs = segments.some(s => s.raw.type === 'arc');
        if (hasArcs) return 'closed_curve';
        return this.classifyCorners(this.chainToPoints(segments));
    }

    private uniqueCorners(points: PathPoint[]): PathPoint[] {
        return points.filter((p, i, arr) => {
            if (i === 0) return true;
            return !this.ptEq(p.x, p.y, arr[i - 1].x, arr[i - 1].y);
        }).filter((p, i, arr) => {
            // Also remove closing duplicate (last == first)
            if (i === arr.length - 1) return !this.ptEq(p.x, p.y, arr[0].x, arr[0].y);
            return true;
        });
    }

    private isRectangle(corners: PathPoint[]): boolean {
        if (corners.length !== 4) return false;
        for (let i = 0; i < 4; i++) {
            const p1 = corners[(i - 1 + 4) % 4];
            const p2 = corners[i];
            const p3 = corners[(i + 1) % 4];
            const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
            const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
            const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
            if (mag === 0) return false;
            // cos(90°) = 0; allow ±0.1 tolerance (~5.7°)
            if (Math.abs((v1.x * v2.x + v1.y * v2.y) / mag) > 0.1) return false;
        }
        return true;
    }

    // ── SVG helpers ───────────────────────────────────────────────────────

    private svgAttr(tag: string, name: string): number | null {
        const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        if (!m) return null;
        const v = parseFloat(m[1]);
        return isNaN(v) ? null : v;
    }

    private parseSvgPointList(s: string): PathPoint[] {
        const nums = s.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        const pts: PathPoint[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
        return pts;
    }

    /**
     * Minimal SVG path data parser supporting M/L/H/V/C/A/Z commands.
     * Returns discretized points plus a closed flag.
     */
    parseSvgPathD(d: string): { points: PathPoint[]; closed: boolean } {
        const pts: PathPoint[] = [];
        let closed = false;
        let cx = 0, cy = 0, startX = 0, startY = 0;

        // Tokenize into commands and numbers
        const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
        let i = 0;
        let cmd = 'M';

        const num = () => parseFloat(tokens[++i] ?? '0');

        while (i < tokens.length) {
            const t = tokens[i];
            if (/[MmLlHhVvCcSsQqTtAaZz]/.test(t)) { cmd = t; }

            switch (cmd) {
                case 'M': cx = num(); cy = num(); startX = cx; startY = cy; pts.push({ x: cx, y: cy }); cmd = 'L'; break;
                case 'm': cx += num(); cy += num(); startX = cx; startY = cy; pts.push({ x: cx, y: cy }); cmd = 'l'; break;
                case 'L': cx = num(); cy = num(); pts.push({ x: cx, y: cy }); break;
                case 'l': cx += num(); cy += num(); pts.push({ x: cx, y: cy }); break;
                case 'H': cx = num(); pts.push({ x: cx, y: cy }); break;
                case 'h': cx += num(); pts.push({ x: cx, y: cy }); break;
                case 'V': cy = num(); pts.push({ x: cx, y: cy }); break;
                case 'v': cy += num(); pts.push({ x: cx, y: cy }); break;
                case 'Z': case 'z':
                    closed = true; cx = startX; cy = startY;
                    pts.push({ x: cx, y: cy });
                    break;
                case 'C': num(); num(); num(); num(); cx = num(); cy = num(); pts.push({ x: cx, y: cy }); break;
                case 'c': num(); num(); num(); num(); cx += num(); cy += num(); pts.push({ x: cx, y: cy }); break;
                case 'S': num(); num(); cx = num(); cy = num(); pts.push({ x: cx, y: cy }); break;
                case 's': num(); num(); cx += num(); cy += num(); pts.push({ x: cx, y: cy }); break;
                case 'Q': num(); num(); cx = num(); cy = num(); pts.push({ x: cx, y: cy }); break;
                case 'q': num(); num(); cx += num(); cy += num(); pts.push({ x: cx, y: cy }); break;
                case 'A': case 'a': {
                    // rx ry x-rotation large-arc-flag sweep-flag x y
                    num(); num(); num(); num(); const sweep = num();
                    let ex: number, ey: number;
                    if (cmd === 'A') { ex = num(); ey = num(); }
                    else { ex = cx + num(); ey = cy + num(); }
                    // Approximate arc as straight segment endpoint (SVG arcs in milling are uncommon)
                    pts.push({ x: ex, y: ey });
                    cx = ex; cy = ey;
                    break;
                }
                default: break;
            }
            i++;
        }

        // Check geometric closure even without Z (endpoints within tolerance)
        if (!closed && pts.length > 1) {
            const first = pts[0], last = pts[pts.length - 1];
            if (this.ptEq(first.x, first.y, last.x, last.y)) closed = true;
        }

        return { points: pts, closed };
    }

    // ── Utility ───────────────────────────────────────────────────────────

    private makeDetectedPath(
        id: string,
        closed: boolean,
        classification: PathClassification,
        points: PathPoint[],
        rawPrimitives: RawPrimitive[]
    ): DetectedPath {
        return { id, closed, classification, points, bounds: this.bounds(points), rawPrimitives };
    }

    private bounds(points: PathPoint[]): PathBounds {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }
}
