/**
 * 2.5D milling CAM: facing, pocketing and profiling (inside / outside / on) with ramp entry.
 *
 * Coordinate convention (same XY as the laser jobs):
 *   - X/Y are bed millimetres; contours arrive already transformed (object position/scale/rotation baked in).
 *   - Z0 is the TOP of the stock. Cuts are negative Z. Depths in the request are positive "mm below the top".
 *
 * The generator never throws on machining problems: it reports them as warnings (error / warning / info)
 * so the UI can explain why a tool does not fit, a cut goes through the stock, etc.
 * Structurally invalid requests throw MillJobValidationError (HTTP 400).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CL: any = require('js-clipper');

export type Pt = [number, number];
export type Pt3 = [number, number, number];
export type MillOpType = 'face' | 'pocket' | 'profile';
export type CutSide = 'inside' | 'outside' | 'on';

export interface MillStock {
    width: number;
    height: number;
    thickness: number;
    /** Lower-left corner of the stock on the bed (mm). */
    x?: number;
    y?: number;
    material?: string;
}

export interface MillTool {
    name?: string;
    type?: 'endmill' | 'ballnose' | 'vbit' | 'drill';
    diameter: number;
    flutes?: number;
    maxRPM?: number;
}

export interface MillContour {
    id: string;
    name?: string;
    points: Pt[];
    closed: boolean;
}

export interface MillOperation {
    id: string;
    label?: string;
    type: MillOpType;
    enabled?: boolean;
    cutSide?: CutSide;
    contourIds?: string[];
    tool: MillTool;
    /** Depth (mm below the stock top) where the remaining material starts for this operation, e.g. after facing. */
    startDepth?: number;
    /** Final depth (mm below the stock top). */
    depth: number;
    stepdown: number;
    /** Pocket / facing stepover as % of the tool diameter. */
    stepoverPct?: number;
    /** Ramp entry angle in degrees. 0 = straight plunge. */
    rampAngle?: number;
    feed: number;
    plunge: number;
    rpm: number;
}

export interface MillJobRequest {
    stock: MillStock;
    /** Retract height above the stock top (mm). */
    safeZ?: number;
    /** Machine rapid rate used for the time estimate (mm/min). */
    rapidRate?: number;
    /** Where work Z0 is: the stock top (default) or the bed / bottom of the stock (all Z shifted by +thickness). */
    zZero?: 'top' | 'bottom';
    contours?: MillContour[];
    operations: MillOperation[];
}

export interface MillWarning {
    level: 'error' | 'warning' | 'info';
    opId?: string;
    contourId?: string;
    message: string;
}

export interface MillToolpath {
    opId: string;
    contourId?: string;
    type: MillOpType;
    closed: boolean;
    points: Pt[];
}

export interface MillOpSummary {
    id: string;
    label: string;
    passes: number;
    stepdown: number;
    rampLength: number;
    cutLength: number;
    time: number;
}

export interface MillJobResult {
    gcode: string;
    toolpaths: MillToolpath[];
    warnings: MillWarning[];
    operations: MillOpSummary[];
    stats: {
        lines: number;
        cutLength: number;
        rapidLength: number;
        /** seconds */
        estimatedTime: number;
        bounds: { min: Pt3; max: Pt3 };
    };
}

export class MillJobValidationError extends Error { }

// ── Geometry helpers ─────────────────────────────────────────────────────────

const SCALE = 1000;
type IntPath = { X: number; Y: number }[];

const toInt = (pts: Pt[]): IntPath => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromInt = (p: IntPath): Pt[] => p.map(q => [q.X / SCALE, q.Y / SCALE]);
const areaOf = (paths: IntPath[]) => paths.reduce((s, p) => s + CL.Clipper.Area(p), 0) / (SCALE * SCALE);
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Drops a duplicated closing vertex. */
function openLoop(pts: Pt[]): Pt[] {
    if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6) return pts.slice(0, -1);
    return pts;
}

function offsetPaths(paths: IntPath[], delta: number): IntPath[] {
    if (!paths.length) return [];
    if (Math.abs(delta) < 1e-6) return paths;
    const co = new CL.ClipperOffset(2, 0.01 * SCALE);
    co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const out: IntPath[] = [];
    co.Execute(out, delta * SCALE);
    return out.filter(p => p.length >= 3);
}

function unionEvenOdd(paths: IntPath[]): IntPath[] {
    const c = new CL.Clipper();
    c.AddPaths(paths, CL.PolyType.ptSubject, true);
    const out: IntPath[] = [];
    c.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    return out;
}

/**
 * Area that a round tool of radius r cannot avoid leaving at sharp corners
 * (sum over corners turning toward `side`: +1 = left turns (convex for CCW), -1 = right turns).
 */
function cornerLoss(paths: IntPath[], r: number, side: 1 | -1): number {
    let loss = 0;
    for (const ip of paths) {
        const p = fromInt(ip);
        const n = p.length;
        for (let i = 0; i < n; i++) {
            const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
            const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
            const cross = ux * vy - uy * vx;
            if (cross * side <= 0) continue;
            const phi = Math.min(Math.abs(Math.atan2(cross, ux * vx + uy * vy)), Math.PI - 0.05);
            loss += r * r * (Math.tan(phi / 2) - phi / 2);
        }
    }
    return loss;
}

/** Area (mm²) of `region` that a tool of radius r cannot reach beyond the unavoidable corner rounding. */
function unreachableArea(region: IntPath[], r: number, toolInside: boolean): number {
    const regionArea = Math.abs(areaOf(region));
    const reached = toolInside
        ? Math.abs(areaOf(offsetPaths(offsetPaths(region, -r), r)))
        : Math.abs(areaOf(offsetPaths(offsetPaths(region, r), -r)));
    const actual = Math.abs(regionArea - reached);
    return Math.max(0, actual - cornerLoss(region, r, toolInside ? 1 : -1) * 1.15);
}

/** Ensures counter-clockwise orientation for an outer loop (conventional/climb doesn't matter for wood, keeps output stable). */
function ccw(loop: Pt[]): Pt[] {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return a < 0 ? [...loop].reverse() : loop;
}

/** Re-starts a closed loop at the point closest to `p` (inserting that point on its segment). */
function startNearest(loop: Pt[], p: Pt): Pt[] {
    let best = Infinity, bi = 0, bq: Pt = loop[0];
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        const q: Pt = [a[0] + t * dx, a[1] + t * dy];
        const d = dist(p, q);
        if (d < best) { best = d; bi = i; bq = q; }
    }
    const rest: Pt[] = [];
    for (let k = 1; k <= loop.length; k++) rest.push(loop[(bi + k) % loop.length]);
    if (dist(rest[rest.length - 1], bq) < 1e-6) rest.pop();
    if (dist(rest[0], bq) < 1e-6) return rest;
    return [bq, ...rest];
}

function cumulative(loop: Pt[]): number[] {
    const cum = [0];
    for (let i = 0; i < loop.length; i++) cum.push(cum[i] + dist(loop[i], loop[(i + 1) % loop.length]));
    return cum;
}

/** Z levels (negative) from startDepth to depth with equal steps not larger than stepdown. */
export function depthLevels(startDepth: number, depth: number, stepdown: number): number[] {
    const total = depth - startDepth;
    if (total <= 1e-9) return [];
    const n = Math.max(1, Math.ceil(total / stepdown - 1e-9));
    return Array.from({ length: n }, (_, k) => -(startDepth + (total * (k + 1)) / n));
}

const CHIPLOAD: { re: RegExp; range: [number, number]; name: string }[] = [
    { re: /alu|brass|copper|metal/i, range: [0.01, 0.08], name: 'aluminium / non-ferrous' },
    { re: /acryl|plexi|pmma|pvc|hdpe|delrin|pom|plastic|abs|nylon|poly/i, range: [0.04, 0.25], name: 'plastic' },
    { re: /foam|cork|wax/i, range: [0.1, 0.6], name: 'foam' },
    { re: /wood|mdf|ply|pine|oak|beech|birch|walnut|maple|hardwood|softwood|bamboo/i, range: [0.04, 0.35], name: 'wood' },
];

// ── G-code emitter ───────────────────────────────────────────────────────────

const f3 = (v: number) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3).replace(/\.?0+$/, '') || '0';

class Emitter {
    lines: string[] = [];
    pos: Pt3;
    cutLen = 0;
    rapidLen = 0;
    minutes = 0;
    feedCur = -1;
    min: Pt3 = [Infinity, Infinity, Infinity];
    max: Pt3 = [-Infinity, -Infinity, -Infinity];

    /** Positions are tracked relative to the stock top; zOff is added to emitted Z words only. */
    constructor(private rapidRate: number, start: Pt3, private zOff = 0) { this.pos = start; }

    comment(s: string) { this.lines.push(`; ${s}`); }
    raw(s: string) { this.lines.push(s); }
    dwell(sec: number) { this.lines.push(`G4 P${sec}`); this.minutes += sec / 60; }

    private words(x: number, y: number, z: number) {
        const w: string[] = [];
        if (Math.abs(x - this.pos[0]) > 1e-6) w.push(`X${f3(x)}`);
        if (Math.abs(y - this.pos[1]) > 1e-6) w.push(`Y${f3(y)}`);
        if (Math.abs(z - this.pos[2]) > 1e-6) w.push(`Z${f3(z + this.zOff)}`);
        return w;
    }

    rapid(x = this.pos[0], y = this.pos[1], z = this.pos[2]) {
        const w = this.words(x, y, z);
        if (!w.length) return;
        const d = Math.hypot(x - this.pos[0], y - this.pos[1], z - this.pos[2]);
        this.rapidLen += d;
        this.minutes += d / this.rapidRate;
        this.lines.push(`G0 ${w.join(' ')}`);
        this.pos = [x, y, z];
    }

    feed(x: number, y: number, z: number, f: number) {
        const w = this.words(x, y, z);
        if (!w.length) return;
        const d = Math.hypot(x - this.pos[0], y - this.pos[1], z - this.pos[2]);
        this.cutLen += d;
        this.minutes += d / f;
        if (f !== this.feedCur) { w.push(`F${Math.round(f)}`); this.feedCur = f; }
        this.lines.push(`G1 ${w.join(' ')}`);
        const out = [x, y, z + this.zOff];
        for (let k = 0; k < 3; k++) { this.min[k] = Math.min(this.min[k], out[k]); this.max[k] = Math.max(this.max[k], out[k]); }
        this.pos = [x, y, z];
    }
}

// ── Validation ───────────────────────────────────────────────────────────────

const pos = (v: unknown) => typeof v === 'number' && isFinite(v) && v > 0;

export function validateMillJob(req: any): asserts req is MillJobRequest {
    if (!req || typeof req !== 'object') throw new MillJobValidationError('Missing request body');
    const s = req.stock;
    if (!s || !pos(s.width) || !pos(s.height) || !pos(s.thickness)) throw new MillJobValidationError('Stock width, height and thickness must be > 0');
    if (req.safeZ !== undefined && !pos(req.safeZ)) throw new MillJobValidationError('Safe Z must be above the stock (> 0)');
    if (!Array.isArray(req.operations) || req.operations.length === 0) throw new MillJobValidationError('No operations');
    if (req.contours !== undefined && !Array.isArray(req.contours)) throw new MillJobValidationError('contours must be an array');
    for (const c of req.contours ?? []) {
        if (!c || typeof c.id !== 'string' || !Array.isArray(c.points)) throw new MillJobValidationError('Invalid contour');
        if (!c.points.every((p: any) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))) throw new MillJobValidationError(`Contour ${c.id} has invalid points`);
    }
    for (const op of req.operations) {
        if (!op || !['face', 'pocket', 'profile'].includes(op.type)) throw new MillJobValidationError(`Unknown operation type "${op?.type}"`);
        const name = op.label || op.id;
        if (!op.tool || !pos(op.tool.diameter)) throw new MillJobValidationError(`${name}: tool diameter must be > 0`);
        if (!pos(op.depth)) throw new MillJobValidationError(`${name}: depth must be > 0`);
        if (!pos(op.stepdown)) throw new MillJobValidationError(`${name}: stepdown must be > 0`);
        if (!pos(op.feed) || !pos(op.plunge)) throw new MillJobValidationError(`${name}: feed and plunge rates must be > 0`);
        if (!pos(op.rpm)) throw new MillJobValidationError(`${name}: spindle speed must be > 0`);
    }
}

// ── Generator ────────────────────────────────────────────────────────────────

const OP_NAMES: Record<MillOpType, string> = { face: 'Facing', pocket: 'Pocket', profile: 'Profile' };

export function generateMillingJob(req: MillJobRequest): MillJobResult {
    validateMillJob(req);
    const stock = { x: 0, y: 0, material: '', ...req.stock };
    const T = stock.thickness;
    const safeZ = req.safeZ ?? 5;
    const rapidRate = req.rapidRate && req.rapidRate > 0 ? req.rapidRate : 3000;
    const contours = new Map((req.contours ?? []).map(c => [c.id, c]));
    const warnings: MillWarning[] = [];
    const toolpaths: MillToolpath[] = [];
    const summaries: MillOpSummary[] = [];
    const warn = (level: MillWarning['level'], message: string, opId?: string, contourId?: string) =>
        warnings.push({ level, message, opId, contourId });

    const zBottom = req.zZero === 'bottom';
    const em = new Emitter(rapidRate, [stock.x, stock.y, safeZ], zBottom ? T : 0);
    em.comment('LzrCnc 2.5D milling job');
    em.comment(`Stock ${f3(stock.width)} x ${f3(stock.height)} x ${f3(T)} mm${stock.material ? ` (${stock.material})` : ''} at X${f3(stock.x)} Y${f3(stock.y)}`);
    em.comment(zBottom
        ? `Work zero: X/Y = bed origin, Z0 = BOTTOM of the stock (bed / spoilboard); stock top = Z${f3(T)}`
        : 'Work zero: X/Y = bed origin, Z0 = TOP of the stock');
    em.raw('G21');
    em.raw('G90');
    em.raw('G17');
    em.raw('G94');
    em.raw(`G0 Z${f3(safeZ + (zBottom ? T : 0))}`);

    const stockRect = { x0: stock.x, y0: stock.y, x1: stock.x + stock.width, y1: stock.y + stock.height };
    let prevTool = '';
    let spindleOn = false;
    let curRpm = 0;
    let opIndex = 0;

    for (const op of req.operations) {
        if (op.enabled === false) continue;
        opIndex++;
        const label = op.label || `${OP_NAMES[op.type]} ${opIndex}`;
        const D = op.tool.diameter;
        const r = D / 2;
        const start = Math.max(0, op.startDepth ?? 0);
        const depth = op.depth;
        const stepdown = op.stepdown;
        const stepoverPct = Math.min(100, Math.max(5, op.stepoverPct ?? 40));
        const stepover = (D * stepoverPct) / 100;
        const rampAngle = Math.max(0, Math.min(90, op.rampAngle ?? 0));
        const useRamp = rampAngle > 0.1 && rampAngle < 89.9;
        const cutSide: CutSide = op.cutSide ?? 'outside';
        const toolName = `${op.tool.name || op.tool.type || 'endmill'} Ø${f3(D)}`;

        // ── Pre-flight checks ──
        if (depth <= start + 1e-6) {
            warn('error', `${label}: final depth (${f3(depth)} mm) must be deeper than the start depth (${f3(start)} mm) — skipped.`, op.id);
            continue;
        }
        if (depth > T + 1e-6) {
            const over = depth - T;
            warn(over > 0.5 ? 'error' : 'warning', `${label}: cuts ${f3(over)} mm below the stock (${f3(T)} mm thick) into the spoilboard.`, op.id);
        }
        if (op.type === 'profile' && cutSide !== 'on' && depth >= T - 1e-6) {
            warn('warning', `${label}: through-cut — the part comes loose on the last pass. Add tabs / hold-downs, or leave a skin (e.g. depth ${f3(T - 1)} mm) and face it off from the other side.`, op.id);
        }
        if (stepdown > D + 1e-6) warn('warning', `${label}: stepdown ${f3(stepdown)} mm is larger than the tool diameter (${f3(D)} mm) — risk of tool breakage.`, op.id);
        if ((op.type === 'pocket' || op.type === 'face') && stepoverPct > 70) {
            warn('warning', `${label}: stepover ${stepoverPct}% > 70% may leave ridges in corners/between passes.`, op.id);
        }
        if (op.tool.type === 'vbit' || op.tool.type === 'drill') {
            warn('warning', `${label}: ${op.tool.type} selected — toolpaths assume a flat end mill of Ø${f3(D)}.`, op.id);
        } else if (op.tool.type === 'ballnose' && op.type !== 'profile') {
            warn('info', `${label}: ball-nose tool leaves scallops on flat floors — a flat end mill is recommended.`, op.id);
        }
        if (op.tool.maxRPM && op.rpm > op.tool.maxRPM) warn('warning', `${label}: ${op.rpm} RPM exceeds the tool max (${op.tool.maxRPM}).`, op.id);
        const flutes = Math.max(1, op.tool.flutes ?? 2);
        const chip = op.feed / (op.rpm * flutes);
        const mat = CHIPLOAD.find(m => m.re.test(stock.material));
        if (mat) {
            const k = Math.min(1.5, Math.max(0.4, D / 6));
            const lo = mat.range[0] * k, hi = mat.range[1] * k;
            if (chip < lo) warn('warning', `${label}: chip load ${chip.toFixed(3)} mm/tooth is low for ${mat.name} (≈${lo.toFixed(2)}–${hi.toFixed(2)}) — rubbing / burning. Increase feed or lower RPM.`, op.id);
            else if (chip > hi) warn('warning', `${label}: chip load ${chip.toFixed(3)} mm/tooth is high for ${mat.name} (≈${lo.toFixed(2)}–${hi.toFixed(2)}) — risk of breaking the tool. Lower feed or raise RPM.`, op.id);
        }
        const levels = depthLevels(start, depth, stepdown);
        const realStep = (depth - start) / levels.length;
        const rampLen = useRamp ? realStep / Math.tan((rampAngle * Math.PI) / 180) : 0;
        if (op.type !== 'face') {
            if (useRamp) warn('info', `${label}: ramp entry ${f3(rampAngle)}° → ${rampLen.toFixed(1)} mm of travel per ${realStep.toFixed(2)} mm step.`, op.id);
            else warn('warning', `${label}: straight plunge entry — needs a center-cutting end mill; a 2–5° ramp is gentler on the tool.`, op.id);
            if (rampAngle > 30 && useRamp) warn('warning', `${label}: ramp angle ${f3(rampAngle)}° is steep — 2–10° is typical for wood.`, op.id);
        }

        // ── Collect machining loops ──
        type Loop = { pts: Pt[]; closed: boolean; contourId?: string; level?: number };
        const loops: Loop[] = [];
        const selected = (op.contourIds ?? []).map(id => contours.get(id)).filter((c): c is MillContour => !!c && c.points.length >= 2);
        if (op.type !== 'face' && selected.length === 0) {
            warn('error', `${label}: no contour selected — skipped.`, op.id);
            continue;
        }

        if (op.type === 'profile') {
            const area = (c: MillContour) => {
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (const [x, y] of c.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
                return (x1 - x0) * (y1 - y0);
            };
            // Inner features first so the part is still held while they are cut.
            for (const c of [...selected].sort((a, b) => area(a) - area(b))) {
                const name = c.name || c.id;
                if (!c.closed || c.points.length < 3) {
                    if (cutSide !== 'on') warn('warning', `${label}: "${name}" is an open path — cut on the line.`, op.id, c.id);
                    loops.push({ pts: c.points, closed: false, contourId: c.id });
                    continue;
                }
                const base = [toInt(openLoop(c.points))];
                if (cutSide === 'on') {
                    loops.push({ pts: ccw(openLoop(c.points)), closed: true, contourId: c.id });
                    continue;
                }
                const off = offsetPaths(base, cutSide === 'outside' ? r : -r);
                if (!off.length) {
                    warn('error', `${label}: tool Ø${f3(D)} is too large for "${name}" — the inside path collapses. Use a smaller tool.`, op.id, c.id);
                    continue;
                }
                if (cutSide === 'inside' && off.length > 1) {
                    warn('warning', `${label}: "${name}" has a section narrower than the tool Ø${f3(D)} — the path splits into ${off.length} parts.`, op.id, c.id);
                }
                const lost = unreachableArea(base, r, cutSide === 'inside');
                if (lost > Math.max(0.5, Math.abs(areaOf(base)) * 0.002)) {
                    warn('warning', `${label}: "${name}" has corners or details smaller than the tool radius (${f3(r)} mm) — about ${lost.toFixed(1)} mm² will not be cut.`, op.id, c.id);
                }
                for (const p of off) loops.push({ pts: ccw(fromInt(p)), closed: true, contourId: c.id });
            }
        } else if (op.type === 'pocket') {
            const closed = selected.filter(c => c.closed && c.points.length >= 3);
            for (const c of selected) if (!closed.includes(c)) warn('warning', `${label}: "${c.name || c.id}" is open and cannot be pocketed — ignored.`, op.id, c.id);
            if (!closed.length) { warn('error', `${label}: no closed contour to pocket — skipped.`, op.id); continue; }
            // Outer contours (not nested in another selected one) that the tool can't enter at all.
            const pip = (pt: Pt, poly: Pt[]) => {
                let inside = false;
                for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                    const [ax, ay] = poly[i], [bx, by] = poly[j];
                    if ((ay > pt[1]) !== (by > pt[1]) && pt[0] < ((bx - ax) * (pt[1] - ay)) / (by - ay) + ax) inside = !inside;
                }
                return inside;
            };
            const tooSmall = closed.filter(c => {
                const nested = closed.some(o => o !== c && pip(c.points[0], o.points));
                return !nested && offsetPaths([toInt(openLoop(c.points))], -r).length === 0;
            });
            for (const c of tooSmall) {
                const xs = c.points.map(p => p[0]), ys = c.points.map(p => p[1]);
                const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
                warn('error', `${label}: tool Ø${f3(D)} is too large for "${c.name || c.id}" (${w.toFixed(1)} × ${h.toFixed(1)} mm) — that pocket is skipped. Use a tool smaller than ${f3(Math.min(w, h))} mm.`, op.id, c.id);
            }
            const usable = closed.filter(c => !tooSmall.includes(c));
            if (!usable.length) continue;
            // Even-odd union: nested contours become islands (e.g. the inside of an "O").
            const region = unionEvenOdd(usable.map(c => toInt(openLoop(c.points))));
            const levelsXY: IntPath[][] = [];
            for (let d = r, guard = 0; guard < 5000; d += stepover, guard++) {
                const ring = offsetPaths(region, -d);
                if (!ring.length) break;
                levelsXY.push(ring);
            }
            if (!levelsXY.length) {
                warn('error', `${label}: tool Ø${f3(D)} is too large for the pocket — nothing can be cut. Use a smaller tool.`, op.id);
                continue;
            }
            const lost = unreachableArea(region, r, true);
            if (lost > Math.max(0.5, Math.abs(areaOf(region)) * 0.002)) {
                warn('warning', `${label}: parts of the pocket are narrower than the tool Ø${f3(D)} or have tight corners — about ${lost.toFixed(1)} mm² will not be cleared.`, op.id);
            }
            // Innermost rings first, finishing on the wall.
            for (let k = levelsXY.length - 1; k >= 0; k--) {
                for (const p of levelsXY[k]) loops.push({ pts: fromInt(p), closed: true, level: k });
            }
        }

        if (op.type !== 'face' && loops.length === 0) continue;

        // Stock bounds check
        if (op.type !== 'face') {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const l of loops) for (const [x, y] of l.pts) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
            const over = Math.max(stockRect.x0 - x0, stockRect.y0 - y0, x1 - stockRect.x1, y1 - stockRect.y1);
            if (loops.length && over > 0.01) {
                warn('warning', `${label}: the tool goes ${over.toFixed(1)} mm outside the stock — check clamps and the stock position.`, op.id);
            }
        }

        // ── Emit ──
        const cutBefore = em.cutLen, minBefore = em.minutes;
        em.raw('');
        em.comment(`===== ${opIndex}. ${label} — ${OP_NAMES[op.type]}${op.type === 'profile' ? ` (${cutSide})` : ''}, ${toolName}, Z${f3(-start)} → Z${f3(-depth)} in ${levels.length} pass${levels.length > 1 ? 'es' : ''}`);
        em.comment(`TOOL D=${f3(D)} TYPE=${op.tool.type || 'endmill'}`);
        const toolKey = `${op.tool.name}|${op.tool.type}|${D}`;
        if (prevTool && toolKey !== prevTool) {
            em.raw('M5');
            em.rapid(undefined, undefined, safeZ);
            em.comment(`TOOL CHANGE: insert ${toolName}, re-zero Z on the stock top, then resume`);
            em.raw('M0');
            spindleOn = false;
            warn('info', `${label}: tool change to ${toolName} (program pauses with M0 — re-zero Z before resuming).`, op.id);
        }
        prevTool = toolKey;
        em.rapid(undefined, undefined, safeZ);
        if (!spindleOn || curRpm !== op.rpm) {
            em.raw(`M3 S${Math.round(op.rpm)}`);
            em.dwell(spindleOn ? 1 : 3);
            spindleOn = true;
            curRpm = op.rpm;
        }

        const topOf = (levelIdx: number) => (levelIdx === 0 ? -start : levels[levelIdx - 1]);
        /** Moves to XY above `p` and descends to `zTop` (the top of the remaining material). */
        const approach = (p: Pt, zTop: number) => {
            if (dist([em.pos[0], em.pos[1]], p) > 1e-6) {
                em.rapid(undefined, undefined, safeZ);
                em.rapid(p[0], p[1], safeZ);
            }
            const clear = Math.min(safeZ, zTop + 1);
            if (em.pos[2] > clear) em.rapid(undefined, undefined, clear);
            em.feed(p[0], p[1], zTop, op.plunge);
        };
        /** Walks `len` mm along a closed loop from arc-length s0, interpolating Z from z0 to z1. Returns the end arc-length. */
        const walk = (loop: Pt[], cum: number[], s0: number, len: number, z0: number, z1: number, f: number) => {
            const P = cum[cum.length - 1];
            const n = loop.length;
            let s = ((s0 % P) + P) % P;
            let i = 0;
            while (i < n - 1 && cum[i + 1] <= s) i++;
            let t = 0;
            let guard = 0;
            while (t < len - 1e-9 && guard++ < 1e6) {
                const segLen = cum[i + 1] - cum[i];
                const step = Math.min(cum[i + 1] - s, len - t);
                t += step;
                s += step;
                const a = loop[i], b = loop[(i + 1) % n];
                const u = segLen > 0 ? (s - cum[i]) / segLen : 1;
                em.feed(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z0 + ((z1 - z0) * t) / (len || 1), f);
                if (s >= cum[i + 1] - 1e-9) { i = (i + 1) % n; s = cum[i]; }
            }
            return s;
        };
        /** Descends from zFrom to zTo at the current loop position (ramp along the loop or plunge). */
        const enter = (loop: Pt[], cum: number[], s: number, zFrom: number, zTo: number) => {
            const P = cum[cum.length - 1];
            if (useRamp && P > 0.5) return walk(loop, cum, s, (zFrom - zTo) / Math.tan((rampAngle * Math.PI) / 180), zFrom, zTo, op.feed);
            em.feed(em.pos[0], em.pos[1], zTo, op.plunge);
            return s;
        };

        if (op.type === 'face') {
            // Zig-zag along X with overrun; every row starts and ends outside the stock.
            const over = r + 2;
            const xa = stockRect.x0 - over, xb = stockRect.x1 + over;
            const c0 = stockRect.y0 + r * 0.5, c1 = stockRect.y1 - r * 0.5;
            const gaps = Math.max(1, Math.ceil((c1 - c0) / stepover - 1e-9));
            const rows = c1 <= c0 ? [(stockRect.y0 + stockRect.y1) / 2]
                : Array.from({ length: gaps + 1 }, (_, k) => c0 + ((c1 - c0) * k) / gaps);
            const path: Pt[] = [];
            rows.forEach((y, k) => {
                const [xs, xe] = k % 2 ? [xb, xa] : [xa, xb];
                path.push([xs, y], [xe, y]);
            });
            toolpaths.push({ opId: op.id, type: 'face', closed: false, points: path });
            levels.forEach((z, li) => {
                em.comment(`pass ${li + 1}/${levels.length} Z${f3(z)}`);
                em.rapid(undefined, undefined, safeZ);
                em.rapid(path[0][0], path[0][1], safeZ);
                em.rapid(undefined, undefined, Math.min(safeZ, topOf(li) + 1));
                em.feed(path[0][0], path[0][1], z, op.plunge);
                for (let k = 1; k < path.length; k++) em.feed(path[k][0], path[k][1], z, op.feed);
            });
            em.rapid(undefined, undefined, safeZ);
        } else if (op.type === 'profile') {
            for (const l of loops) {
                // Open paths are cut out-and-back so every pass ends where it started.
                const loop = l.closed ? l.pts : [...l.pts, ...l.pts.slice(1, -1).reverse()];
                const cum = cumulative(loop);
                toolpaths.push({ opId: op.id, contourId: l.contourId, type: 'profile', closed: l.closed, points: l.pts });
                if (cum[cum.length - 1] < 1e-6) continue;
                em.comment(`contour ${l.contourId ?? ''}`);
                approach(loop[0], -start);
                let s = 0, zCur = -start;
                for (const z of levels) {
                    s = enter(loop, cum, s, zCur, z);
                    s = walk(loop, cum, s, cum[cum.length - 1], z, z, op.feed);
                    zCur = z;
                }
                em.rapid(undefined, undefined, safeZ);
            }
        } else {
            for (const l of loops) toolpaths.push({ opId: op.id, type: 'pocket', closed: true, points: l.pts });
            levels.forEach((z, li) => {
                em.comment(`pass ${li + 1}/${levels.length} Z${f3(z)}`);
                const todo = [...loops];
                let first = true;
                while (todo.length) {
                    // Next ring: same or outer level, nearest to the current position.
                    const here: Pt = [em.pos[0], em.pos[1]];
                    const maxLevel = Math.max(...todo.map(t => t.level ?? 0));
                    let bi = -1, bd = Infinity, bl: Pt[] = [];
                    todo.forEach((t, k) => {
                        if ((t.level ?? 0) !== maxLevel) return;
                        const cand = startNearest(t.pts, here);
                        const d = dist(here, cand[0]);
                        if (d < bd) { bd = d; bi = k; bl = cand; }
                    });
                    todo.splice(bi, 1);
                    const cum = cumulative(bl);
                    if (!first && bd <= D * 0.95 && Math.abs(em.pos[2] - z) < 1e-6) {
                        em.feed(bl[0][0], bl[0][1], z, op.feed);
                    } else {
                        approach(bl[0], topOf(li));
                        enter(bl, cum, 0, topOf(li), z);
                    }
                    // After a ramp the tool is somewhere along the ring: cut one full lap from there.
                    const ring = startNearest(bl, [em.pos[0], em.pos[1]]);
                    const rc = cumulative(ring);
                    walk(ring, rc, 0, rc[rc.length - 1], z, z, op.feed);
                    first = false;
                }
                em.rapid(undefined, undefined, safeZ);
            });
        }

        summaries.push({
            id: op.id,
            label,
            passes: levels.length,
            stepdown: realStep,
            rampLength: op.type === 'face' ? 0 : rampLen,
            cutLength: em.cutLen - cutBefore,
            time: (em.minutes - minBefore) * 60,
        });
    }

    em.raw('');
    em.raw('M5');
    em.rapid(undefined, undefined, safeZ);
    em.rapid(stock.x, stock.y, safeZ);

    if (!summaries.length) warn('error', 'Nothing to machine: every operation was skipped.');
    const finite = (p: Pt3): Pt3 => p.map(v => (isFinite(v) ? v : 0)) as Pt3;
    return {
        gcode: em.lines.join('\n') + '\n',
        toolpaths,
        warnings,
        operations: summaries,
        stats: {
            lines: em.lines.filter(l => l && !l.startsWith(';')).length,
            cutLength: em.cutLen,
            rapidLength: em.rapidLen,
            estimatedTime: em.minutes * 60,
            bounds: { min: finite(em.min), max: finite(em.max) },
        },
    };
}
