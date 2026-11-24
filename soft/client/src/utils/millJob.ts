/**
 * Client side of the 2.5D milling workflow:
 *  - stock / tool / operation types shared by the Mill panel and the visualizer
 *  - contours taken from the scene objects (drawn shapes, SVG, DXF) in bed millimetres
 *  - feeds & speeds suggestions
 *  - a heightfield material-removal simulation of the generated G-code
 *
 * Z convention: depths are entered below the stock TOP. The generated program uses work Z0 on the
 * stock top (default, cuts are negative) or on the stock bottom (stock.zZero = 'bottom', the bed).
 * In the 3D view the stock sits on the bed (z = 0 … thickness), so G-code Z is drawn at
 * (thickness + Z) for top-zero programs and at Z for bottom-zero programs.
 */
import type { SceneObject } from '../types';
import { isVectorObject, objectVectors } from './laserJob';
import { parseGcode } from './gcodeParser';

export type MillOpType = 'face' | 'pocket' | 'profile';
export type CutSide = 'inside' | 'outside' | 'on';
export type ToolType = 'endmill' | 'ballnose' | 'vbit' | 'drill';

export interface MillTool {
    id?: string;
    name: string;
    type: ToolType;
    diameter: number;
    flutes: number;
    maxRPM?: number;
}

export interface MillStock {
    width: number;
    height: number;
    thickness: number;
    /** Lower-left corner of the stock on the bed. */
    x: number;
    y: number;
    material: string;
    /** Retract height above the stock top for rapid moves. */
    safeZ: number;
    /** Where the operator sets work Z0: on the stock top (default) or on the bed / spoilboard under the stock. */
    zZero?: 'top' | 'bottom';
}

export interface MillContour {
    id: string;
    objectId: string;
    name: string;
    points: [number, number][];
    closed: boolean;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface MillOp {
    id: string;
    label: string;
    type: MillOpType;
    enabled: boolean;
    cutSide: CutSide;
    contourIds: string[];
    tool: MillTool;
    startDepth: number;
    /** Final depth below the original stock top (used when depthRef is 'top'). */
    depth: number;
    /** How the final depth is entered: depth from the top, or material left above the stock bottom (exclusive). */
    depthRef?: 'top' | 'bottom';
    /** Material left above the stock bottom (used when depthRef is 'bottom'). */
    floor?: number;
    stepdown: number;
    stepoverPct: number;
    rampAngle: number;
    feed: number;
    plunge: number;
    rpm: number;
}

export interface MillWarning { level: 'error' | 'warning' | 'info'; opId?: string; contourId?: string; message: string }

export interface MillResult {
    gcode: string;
    warnings: MillWarning[];
    operations: { id: string; label: string; passes: number; stepdown: number; rampLength: number; cutLength: number; time: number }[];
    toolpaths: { opId: string; contourId?: string; type: MillOpType; closed: boolean; points: [number, number][] }[];
    stats: { lines: number; cutLength: number; rapidLength: number; estimatedTime: number; bounds: { min: [number, number, number]; max: [number, number, number] } };
}

export const MATERIALS = ['Wood', 'Plywood', 'MDF', 'Hardwood', 'Acrylic', 'HDPE / Delrin', 'Aluminium', 'Foam'];

export const DEFAULT_STOCK: MillStock = { width: 200, height: 200, thickness: 13, x: 0, y: 0, material: 'Wood', safeZ: 5 };

export const DEFAULT_TOOL: MillTool = { name: '6 mm flat end mill', type: 'endmill', diameter: 6, flutes: 2 };

const FEEDS: { re: RegExp; rpm: number; chip: number; stepdown: number; plunge: number }[] = [
    { re: /alu|brass|copper|metal/i, rpm: 12000, chip: 0.02, stepdown: 0.1, plunge: 0.25 },
    { re: /acryl|plexi|pmma|pvc|hdpe|delrin|pom|plastic|abs|nylon|poly/i, rpm: 16000, chip: 0.05, stepdown: 0.25, plunge: 0.3 },
    { re: /foam|cork|wax/i, rpm: 12000, chip: 0.15, stepdown: 1, plunge: 0.5 },
    { re: /hardwood|oak|beech|walnut|maple/i, rpm: 16000, chip: 0.05, stepdown: 0.25, plunge: 0.25 },
    { re: /wood|mdf|ply|pine|birch|bamboo/i, rpm: 16000, chip: 0.05, stepdown: 0.33, plunge: 0.3 },
];

/** Conservative hobby-router feeds & speeds for a material / tool pair. */
export function suggestFeeds(material: string, tool: MillTool) {
    const m = FEEDS.find(f => f.re.test(material)) ?? FEEDS[FEEDS.length - 1];
    const k = Math.min(1.5, Math.max(0.4, tool.diameter / 6));
    const rpm = tool.maxRPM ? Math.min(m.rpm, tool.maxRPM) : m.rpm;
    const feed = Math.round((rpm * Math.max(1, tool.flutes) * m.chip * k) / 50) * 50;
    const stepdown = Math.max(0.1, Math.round(tool.diameter * m.stepdown * 10) / 10);
    return { rpm, feed, plunge: Math.max(50, Math.round((feed * m.plunge) / 10) * 10), stepdown };
}

export const chipLoad = (op: Pick<MillOp, 'feed' | 'rpm' | 'tool'>) => op.feed / (Math.max(1, op.rpm) * Math.max(1, op.tool.flutes));

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const OP_LABEL: Record<MillOpType, string> = { face: 'Facing', pocket: 'Pocket', profile: 'Profile' };

export function defaultMillOp(type: MillOpType, tool: MillTool, stock: MillStock, contourIds: string[], index: number, previous?: MillOp[]): MillOp {
    const f = suggestFeeds(stock.material, tool);
    // Material above this op may already be removed by a facing op.
    const faced = Math.max(0, ...(previous ?? []).filter(o => o.type === 'face' && o.enabled).map(o => opDepth(o, stock)));
    const startDepth = type === 'face' ? 0 : faced;
    const depth = type === 'face' ? 1 : type === 'pocket' ? Math.min(stock.thickness, startDepth + 3) : Math.max(startDepth + 0.5, stock.thickness - 1);
    return {
        id: uid(),
        label: `${OP_LABEL[type]} ${index}`,
        type,
        enabled: true,
        cutSide: type === 'profile' ? 'outside' : 'inside',
        contourIds,
        tool,
        startDepth,
        depth: Math.round(depth * 100) / 100,
        stepdown: type === 'face' ? Math.min(f.stepdown, 1) : f.stepdown,
        stepoverPct: type === 'face' ? 60 : 40,
        rampAngle: 3,
        feed: f.feed,
        plunge: f.plunge,
        rpm: f.rpm,
    };
}

/** Closed and open contours of all vector objects, in bed millimetres (object transforms applied). */
export function millContours(objects: SceneObject[]): MillContour[] {
    const out: MillContour[] = [];
    for (const o of objects) {
        if (!isVectorObject(o)) continue;
        let paths;
        try { paths = objectVectors(o); } catch { continue; }
        paths.forEach((p, k) => {
            if (p.points.length < 2) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [x, y] of p.points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
            if (maxX - minX < 1e-3 && maxY - minY < 1e-3) return;
            out.push({
                id: `${o.id}:${k}`,
                objectId: o.id,
                name: paths.length > 1 ? `${o.name} #${k + 1}` : o.name,
                points: p.points,
                closed: p.closed,
                bounds: { minX, minY, maxX, maxY },
            });
        });
    }
    return out;
}

/** Final depth below the stock top, whichever way it was entered. */
export function opDepth(op: Pick<MillOp, 'depth' | 'depthRef' | 'floor'>, stock: Pick<MillStock, 'thickness'>): number {
    if (op.depthRef === 'bottom') return Math.round(Math.max(0.05, stock.thickness - Math.max(0, op.floor ?? 0)) * 1000) / 1000;
    return op.depth;
}

/** Request body for POST /cam/generate-milling. */
export function buildMillRequest(stock: MillStock, ops: MillOp[], contours: MillContour[]) {
    const used = new Set(ops.filter(o => o.enabled).flatMap(o => o.contourIds));
    return {
        stock: { width: stock.width, height: stock.height, thickness: stock.thickness, x: stock.x, y: stock.y, material: stock.material },
        safeZ: stock.safeZ,
        zZero: stock.zZero ?? 'top',
        contours: contours.filter(c => used.has(c.id)).map(c => ({ id: c.id, name: c.name, points: c.points, closed: c.closed })),
        operations: ops.filter(o => o.enabled).map(o => ({
            id: o.id, label: o.label, type: o.type, cutSide: o.cutSide, contourIds: o.contourIds,
            tool: { name: o.tool.name, type: o.tool.type, diameter: o.tool.diameter, flutes: o.tool.flutes, maxRPM: o.tool.maxRPM },
            startDepth: o.startDepth, depth: opDepth(o, stock), stepdown: o.stepdown, stepoverPct: o.stepoverPct,
            rampAngle: o.rampAngle, feed: o.feed, plunge: o.plunge, rpm: o.rpm,
        })),
    };
}

/** True when the G-code was produced by the milling generator. */
export const isMillGcode = (lines: string[]) => lines.slice(0, 5).some(l => /LzrCnc 2\.5D milling job/.test(l));

/** G-code Z of the stock top in a milling program: 0 when Z0 = top, the stock thickness when Z0 = bottom. */
export function millTopZ(lines: string[]): number {
    for (const l of lines.slice(0, 12)) {
        const m = l.match(/Z0 = BOTTOM.*stock top = Z(-?[\d.]+)/);
        if (m) return parseFloat(m[1]);
    }
    return 0;
}

/**
 * Area swept by the tool (tool-centre paths grown by the tool radius) of a milling result, in bed mm.
 * Used to show the operator where the job will cut before starting.
 */
export function millCutArea(result: Pick<MillResult, 'toolpaths'>, ops: Pick<MillOp, 'id' | 'tool'>[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tp of result.toolpaths) {
        const r = (ops.find(o => o.id === tp.opId)?.tool.diameter ?? 0) / 2;
        for (const [x, y] of tp.points) {
            minX = Math.min(minX, x - r); minY = Math.min(minY, y - r);
            maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r);
        }
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// ── Material removal simulation ──────────────────────────────────────────────

export interface SimMove { a: [number, number, number]; b: [number, number, number]; r: number }

/**
 * Cutting moves of a milling program with the tool radius in effect (from the "; TOOL D=" comments).
 * `zShift` is subtracted from every Z so the moves are relative to the stock top (pass the stock
 * thickness for programs with Z0 on the stock bottom).
 */
export function simMoves(gcode: string[], zShift = 0): SimMove[] {
    const radiusAt: number[] = new Array(gcode.length);
    let r = 3;
    for (let i = 0; i < gcode.length; i++) {
        const m = gcode[i].match(/TOOL D=([\d.]+)/);
        if (m) r = parseFloat(m[1]) / 2;
        radiusAt[i] = r;
    }
    const sh = (p: [number, number, number]): [number, number, number] => [p[0], p[1], p[2] - zShift];
    return parseGcode(gcode).segments
        .filter(s => s.kind === 'cut' && Math.min(s.from[2], s.to[2]) - zShift < 0)
        .map(s => ({ a: sh(s.from), b: sh(s.to), r: radiusAt[s.line] ?? r }));
}

export interface Heightfield {
    nx: number;
    ny: number;
    dx: number;
    dy: number;
    x0: number;
    y0: number;
    thickness: number;
    /** Remaining material height above the bed for each grid node (row-major, y up). */
    h: Float32Array;
}

export function createHeightfield(stock: Pick<MillStock, 'width' | 'height' | 'thickness' | 'x' | 'y'>, maxCells = 360): Heightfield {
    const cell = Math.max(0.25, Math.max(stock.width, stock.height) / maxCells);
    const nx = Math.max(2, Math.round(stock.width / cell) + 1);
    const ny = Math.max(2, Math.round(stock.height / cell) + 1);
    return {
        nx, ny,
        dx: stock.width / (nx - 1),
        dy: stock.height / (ny - 1),
        x0: stock.x, y0: stock.y,
        thickness: stock.thickness,
        h: new Float32Array(nx * ny).fill(stock.thickness),
    };
}

/** Sweeps a flat end mill along the moves (Z relative to the stock top) and lowers the heightfield. */
export function carve(hf: Heightfield, moves: SimMove[], count = moves.length, from = 0) {
    const { nx, ny, dx, dy, x0, y0, thickness: T, h } = hf;
    const step = Math.min(dx, dy) * 0.5;
    for (let m = Math.max(0, from); m < Math.min(count, moves.length); m++) {
        const { a, b, r } = moves[m];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(len / step));
        const r2 = r * r;
        for (let s = 0; s <= n; s++) {
            const t = s / n;
            const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
            const z = T + a[2] + (b[2] - a[2]) * t;
            if (z >= T) continue;
            const i0 = Math.max(0, Math.ceil((x - r - x0) / dx)), i1 = Math.min(nx - 1, Math.floor((x + r - x0) / dx));
            const j0 = Math.max(0, Math.ceil((y - r - y0) / dy)), j1 = Math.min(ny - 1, Math.floor((y + r - y0) / dy));
            for (let j = j0; j <= j1; j++) {
                const py = y0 + j * dy - y;
                const row = j * nx;
                for (let i = i0; i <= i1; i++) {
                    const px = x0 + i * dx - x;
                    if (px * px + py * py > r2) continue;
                    const k = row + i;
                    if (h[k] > z) h[k] = Math.max(0, z);
                }
            }
        }
    }
    return hf;
}
