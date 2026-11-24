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
/** Segments used to approximate each SVG bezier curve */
const BEZIER_SEGMENTS = 16;

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
        for (const m of svgContent.matchAll(/<circle\b[^>]*>/gi)) {
            const cx = this.svgAttr(m[0], 'cx') ?? 0, cy = this.svgAttr(m[0], 'cy') ?? 0, r = this.svgAttr(m[0], 'r');
            if (r !== null && r > 0) {
                const pts = this.discretizeCircle(cx, cy, r);
                paths.push(this.makeDetectedPath(`svg_circle_${i++}`, true, 'circle', pts,
                    [{ type: 'circle', cx, cy, radius: r }]));
            }
        }

        // <ellipse cx cy rx ry>
        for (const m of svgContent.matchAll(/<ellipse\b[^>]*>/gi)) {
            const cx = this.svgAttr(m[0], 'cx') ?? 0, cy = this.svgAttr(m[0], 'cy') ?? 0;
            const rx = this.svgAttr(m[0], 'rx'), ry = this.svgAttr(m[0], 'ry');
            if (rx !== null && ry !== null && rx > 0 && ry > 0) {
                const pts = this.discretizeEllipseRadii(cx, cy, rx, ry);
                paths.push(this.makeDetectedPath(`svg_ellipse_${i++}`, true, 'ellipse', pts, []));
            }
        }

        // <rect x y width height>
        for (const m of svgContent.matchAll(/<rect\b[^>]*>/gi)) {
            const x = this.svgAttr(m[0], 'x') ?? 0;
            const y = this.svgAttr(m[0], 'y') ?? 0;
            const w = this.svgAttr(m[0], 'width'), h = this.svgAttr(m[0], 'height');
            if (w !== null && h !== null && w > 0 && h > 0) {
                const corners: PathPoint[] = [
                    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
                ];
                const pts = [...corners, corners[0]];
                paths.push(this.makeDetectedPath(`svg_rect_${i++}`, true, 'rectangle', pts,
                    [{ type: 'polyline', points: corners, closed: true }]));
            }
        }

        // <line x1 y1 x2 y2>
        for (const m of svgContent.matchAll(/<line\b[^>]*>/gi)) {
            const x1 = this.svgAttr(m[0], 'x1') ?? 0, y1 = this.svgAttr(m[0], 'y1') ?? 0;
            const x2 = this.svgAttr(m[0], 'x2') ?? 0, y2 = this.svgAttr(m[0], 'y2') ?? 0;
            const pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
            paths.push(this.makeDetectedPath(`svg_line_${i++}`, false, 'open_curve', pts,
                [{ type: 'line', x1, y1, x2, y2 }]));
        }

        // <polygon points="...">
        for (const m of svgContent.matchAll(/<polygon\b[^>]*\spoints\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
            const verts = this.parseSvgPointList(m[1]);
            if (verts.length > 2) {
                const pts = [...verts, verts[0]];
                paths.push(this.makeDetectedPath(`svg_polygon_${i++}`, true, this.classifyCorners(verts), pts,
                    [{ type: 'polyline', points: verts, closed: true }]));
            }
        }

        // <polyline points="...">
        for (const m of svgContent.matchAll(/<polyline\b[^>]*\spoints\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
            const verts = this.parseSvgPointList(m[1]);
            if (verts.length > 1) {
                paths.push(this.makeDetectedPath(`svg_polyline_${i++}`, false, 'open_curve', verts,
                    [{ type: 'polyline', points: verts, closed: false }]));
            }
        }

        // <path d="..."> — each subpath becomes its own DetectedPath
        for (const m of svgContent.matchAll(/<path\b[^>]*\sd\s*=\s*["']([^"']*)["'][^>]*>/gi)) {
            for (const sub of this.parseSvgPathSubpaths(m[1])) {
                if (sub.points.length < 2) continue;
                const hasCurves = sub.curved;
                const classification: PathClassification = !sub.closed
                    ? 'open_curve'
                    : hasCurves ? 'closed_curve' : this.classifyCorners(sub.points);
                paths.push(this.makeDetectedPath(`svg_path_${i++}`, sub.closed, classification, sub.points,
                    [{ type: 'polyline', points: sub.points, closed: sub.closed }]));
            }
        }

        return this.toMachineCoordinates(svgContent, paths);
    }

    /**
     * Maps SVG user units (Y down) to machine millimetres (Y up), using the root
     * <svg> width/height/viewBox. Unitless and px values are 96 DPI.
     */
    private toMachineCoordinates(svgContent: string, paths: DetectedPath[]): DetectedPath[] {
        const root = /<svg\b[^>]*>/i.exec(svgContent)?.[0] ?? '';
        const vbRaw = this.svgAttrRaw(root, 'viewBox');
        let vb: number[] | null = null;
        if (vbRaw) {
            const n = vbRaw.trim().split(/[\s,]+/).map(Number);
            if (n.length === 4 && n.every(v => isFinite(v)) && n[2] > 0 && n[3] > 0) vb = n;
        }
        const widthMm = this.lengthToMm(this.svgAttrRaw(root, 'width'));
        const heightMm = this.lengthToMm(this.svgAttrRaw(root, 'height'));
        const PX = 25.4 / 96;

        let sx = PX, sy = PX, minX = 0, minY = 0, docH: number;
        if (vb) {
            [minX, minY] = vb;
            docH = vb[3];
            if (widthMm !== null && heightMm !== null) { sx = widthMm / vb[2]; sy = heightMm / vb[3]; }
            else if (widthMm !== null) { sx = sy = widthMm / vb[2]; }
            else if (heightMm !== null) { sx = sy = heightMm / vb[3]; }
        } else if (heightMm !== null) {
            docH = heightMm / PX;
        } else {
            // No size information: flip around the content's max Y
            docH = paths.reduce((m, p) => Math.max(m, p.bounds.maxY), 0);
        }

        const mapPt = (p: PathPoint): PathPoint => ({ x: (p.x - minX) * sx, y: (minY + docH - p.y) * sy });
        const scaleR = (r: number) => r * (sx + sy) / 2;

        return paths.map(p => {
            const points = p.points.map(mapPt);
            const rawPrimitives: RawPrimitive[] = p.rawPrimitives.map(r => {
                switch (r.type) {
                    case 'circle': {
                        const c = mapPt({ x: r.cx, y: r.cy });
                        return { type: 'circle', cx: c.x, cy: c.y, radius: scaleR(r.radius) };
                    }
                    case 'line': {
                        const a = mapPt({ x: r.x1, y: r.y1 }), b = mapPt({ x: r.x2, y: r.y2 });
                        return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
                    }
                    case 'polyline':
                        return { type: 'polyline', points: r.points.map(mapPt), closed: r.closed };
                    case 'arc': {
                        // Y flip mirrors angles: (start,end) CCW becomes (-end,-start) CCW
                        const c = mapPt({ x: r.cx, y: r.cy });
                        return { type: 'arc', cx: c.x, cy: c.y, radius: scaleR(r.radius), startAngle: -r.endAngle, endAngle: -r.startAngle };
                    }
                }
            });
            return { ...p, points, rawPrimitives, bounds: this.bounds(points) };
        });
    }

    /** Converts an SVG length ("100mm", "4in", "300", "300px") to millimetres. Percentages are ignored. */
    private lengthToMm(v: string | null): number | null {
        if (!v) return null;
        const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?\s*$/i.exec(v);
        if (!m) return null;
        const n = parseFloat(m[1]);
        if (!(n > 0)) return null;
        switch ((m[2] ?? 'px').toLowerCase()) {
            case 'mm': return n;
            case 'cm': return n * 10;
            case 'in': return n * 25.4;
            case 'pt': return n * 25.4 / 72;
            case 'pc': return n * 25.4 / 6;
            case '%': return null;
            default: return n * 25.4 / 96;
        }
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

    private svgAttrRaw(tag: string, name: string): string | null {
        const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
        if (!m) return null;
        return m[1] ?? m[2] ?? null;
    }

    private svgAttr(tag: string, name: string): number | null {
        const raw = this.svgAttrRaw(tag, name);
        if (raw === null) return null;
        const v = parseFloat(raw);
        return isNaN(v) ? null : v;
    }

    private parseSvgPointList(s: string): PathPoint[] {
        const nums = s.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        const pts: PathPoint[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
        return pts;
    }

    /**
     * SVG path data parser (all commands, absolute and relative). Curves are
     * discretized: beziers into BEZIER_SEGMENTS segments, arcs via the
     * endpoint→center parameterization. Coordinates stay in SVG user units.
     * Returns all subpaths concatenated (legacy shape).
     */
    parseSvgPathD(d: string): { points: PathPoint[]; closed: boolean } {
        const subs = this.parseSvgPathSubpaths(d);
        const points = subs.flatMap(s => s.points);
        let closed = subs.length > 0 && subs.every(s => s.closed);
        if (!closed && points.length > 1) {
            const f = points[0], l = points[points.length - 1];
            closed = this.ptEq(f.x, f.y, l.x, l.y);
        }
        return { points, closed };
    }

    parseSvgPathSubpaths(d: string): Array<{ points: PathPoint[]; closed: boolean; curved: boolean }> {
        const result: Array<{ points: PathPoint[]; closed: boolean; curved: boolean }> = [];
        const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
        let pos = 0;
        let cx = 0, cy = 0, startX = 0, startY = 0;
        let lastCtrlX = 0, lastCtrlY = 0, lastCmd = '';
        let cur: { points: PathPoint[]; closed: boolean; curved: boolean } | null = null;

        const isCmd = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t);
        const hasNum = () => pos < tokens.length && !isCmd(tokens[pos]);
        const num = () => parseFloat(tokens[pos++]);
        // Arc flags may be written without separators ("a1 1 0 00 1 1")
        const flag = () => {
            const t = tokens[pos];
            if (t.length > 1 && (t[0] === '0' || t[0] === '1')) { tokens[pos] = t.slice(1); return t[0] === '1' ? 1 : 0; }
            pos++;
            return parseFloat(t) !== 0 ? 1 : 0;
        };
        const finish = () => {
            if (cur && cur.points.length > 0) {
                if (!cur.closed && cur.points.length > 1) {
                    const f = cur.points[0], l = cur.points[cur.points.length - 1];
                    if (this.ptEq(f.x, f.y, l.x, l.y)) cur.closed = true;
                }
                result.push(cur);
            }
            cur = null;
        };
        const ensure = () => {
            if (!cur) cur = { points: [{ x: cx, y: cy }], closed: false, curved: false };
            return cur;
        };
        const lineTo = (x: number, y: number) => { ensure().points.push({ x, y }); cx = x; cy = y; };

        let cmd = '';
        while (pos < tokens.length) {
            if (isCmd(tokens[pos])) cmd = tokens[pos++];
            else if (!cmd) { pos++; continue; }
            const rel = cmd === cmd.toLowerCase();
            const C = cmd.toUpperCase();
            const ox = rel ? cx : 0, oy = rel ? cy : 0;

            if (C === 'Z') {
                if (cur) {
                    const c0 = cur as { points: PathPoint[]; closed: boolean; curved: boolean };
                    const l = c0.points[c0.points.length - 1];
                    if (!this.ptEq(l.x, l.y, startX, startY)) c0.points.push({ x: startX, y: startY });
                    c0.closed = true;
                }
                cx = startX; cy = startY;
                finish();
                lastCmd = 'Z';
                continue;
            }
            if (!hasNum()) { cmd = ''; continue; }

            switch (C) {
                case 'M': {
                    finish();
                    cx = ox + num(); cy = oy + num();
                    startX = cx; startY = cy;
                    cur = { points: [{ x: cx, y: cy }], closed: false, curved: false };
                    cmd = rel ? 'l' : 'L';
                    break;
                }
                case 'L': { const x = ox + num(); const y = oy + num(); lineTo(x, y); break; }
                case 'H': lineTo(ox + num(), cy); break;
                case 'V': lineTo(cx, (rel ? cy : 0) + num()); break;
                case 'C': {
                    const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
                    this.cubicTo(ensure(), cx, cy, x1, y1, x2, y2, x, y);
                    lastCtrlX = x2; lastCtrlY = y2; cx = x; cy = y;
                    break;
                }
                case 'S': {
                    const refl = lastCmd === 'C' || lastCmd === 'S';
                    const x1 = refl ? 2 * cx - lastCtrlX : cx, y1 = refl ? 2 * cy - lastCtrlY : cy;
                    const x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
                    this.cubicTo(ensure(), cx, cy, x1, y1, x2, y2, x, y);
                    lastCtrlX = x2; lastCtrlY = y2; cx = x; cy = y;
                    break;
                }
                case 'Q': {
                    const x1 = ox + num(), y1 = oy + num(), x = ox + num(), y = oy + num();
                    this.quadTo(ensure(), cx, cy, x1, y1, x, y);
                    lastCtrlX = x1; lastCtrlY = y1; cx = x; cy = y;
                    break;
                }
                case 'T': {
                    const refl = lastCmd === 'Q' || lastCmd === 'T';
                    const x1 = refl ? 2 * cx - lastCtrlX : cx, y1 = refl ? 2 * cy - lastCtrlY : cy;
                    const x = ox + num(), y = oy + num();
                    this.quadTo(ensure(), cx, cy, x1, y1, x, y);
                    lastCtrlX = x1; lastCtrlY = y1; cx = x; cy = y;
                    break;
                }
                case 'A': {
                    const rx = num(), ry = num(), rot = num();
                    const large = flag(), sweep = flag();
                    const x = ox + num(), y = oy + num();
                    this.arcTo(ensure(), cx, cy, rx, ry, rot, large, sweep, x, y);
                    cx = x; cy = y;
                    break;
                }
                default: pos++; break;
            }
            lastCmd = C;
        }
        finish();
        return result;
    }

    private cubicTo(sub: { points: PathPoint[]; curved: boolean }, x0: number, y0: number,
        x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
        sub.curved = true;
        for (let k = 1; k <= BEZIER_SEGMENTS; k++) {
            const t = k / BEZIER_SEGMENTS, u = 1 - t;
            sub.points.push({
                x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
            });
        }
    }

    private quadTo(sub: { points: PathPoint[]; curved: boolean }, x0: number, y0: number,
        x1: number, y1: number, x2: number, y2: number) {
        sub.curved = true;
        for (let k = 1; k <= BEZIER_SEGMENTS; k++) {
            const t = k / BEZIER_SEGMENTS, u = 1 - t;
            sub.points.push({
                x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
                y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
            });
        }
    }

    /** SVG elliptical arc (F.6.5 endpoint → center conversion). */
    private arcTo(sub: { points: PathPoint[]; curved: boolean }, x1: number, y1: number,
        rx: number, ry: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number) {
        if (x1 === x2 && y1 === y2) return;
        rx = Math.abs(rx); ry = Math.abs(ry);
        if (rx === 0 || ry === 0) { sub.points.push({ x: x2, y: y2 }); return; }
        sub.curved = true;
        const phi = (rotDeg * Math.PI) / 180;
        const cosP = Math.cos(phi), sinP = Math.sin(phi);
        const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
        const x1p = cosP * dx + sinP * dy;
        const y1p = -sinP * dx + cosP * dy;
        const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
        const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
        const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        let coef = Math.sqrt(Math.max(0, num / den));
        if (large === sweep) coef = -coef;
        const cxp = coef * (rx * y1p) / ry;
        const cyp = coef * -(ry * x1p) / rx;
        const ccx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
        const ccy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
        const ang = (ux: number, uy: number, vx: number, vy: number) => {
            const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            return a;
        };
        const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
        let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
        if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
        else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
        const segs = Math.max(4, Math.ceil((Math.abs(dTheta) / (2 * Math.PI)) * ARC_SEGMENTS_FULL));
        for (let k = 1; k <= segs; k++) {
            const t = theta1 + (dTheta * k) / segs;
            const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
            sub.points.push(k === segs
                ? { x: x2, y: y2 }
                : { x: cosP * ex - sinP * ey + ccx, y: sinP * ex + cosP * ey + ccy });
        }
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
