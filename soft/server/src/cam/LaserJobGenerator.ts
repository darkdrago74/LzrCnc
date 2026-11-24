/**
 * LaserJobGenerator.ts
 *
 * Converts laser operations (vectors already in machine mm, Y-up; raster images
 * already resampled to the output grid) into GRBL-compatible laser G-code.
 */

export type LaserOpType = 'raster' | 'vector_cut' | 'vector_engrave';
export type RasterMode = 'grayscale' | 'dither' | 'threshold';

export interface LaserOpSettings {
    power: number;        // 0-100 %
    speed: number;        // mm/min
    passes: number;
    mode?: RasterMode;
    threshold?: number;   // 0-255
    overscan?: number;    // mm
    lineInterval?: number; // mm
    invert?: boolean;
    minPower?: number;    // %
    brightness?: number;  // -100..100
    contrast?: number;    // -100..100
    gamma?: number;       // 0.2..5
}

export interface LaserVector {
    points: Array<[number, number]>;
    closed: boolean;
}

export interface LaserRaster {
    dataUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LaserOperation {
    id: string;
    type: LaserOpType;
    enabled: boolean;
    settings: LaserOpSettings;
    vectors?: LaserVector[];
    rasters?: LaserRaster[];
}

export interface LaserJobOptions {
    maxS?: number;
    laserMode?: 'M4' | 'M3';
    travelSpeed?: number;
    airAssist?: boolean;
}

export interface LaserJobRequest {
    operations: LaserOperation[];
    options?: LaserJobOptions;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface LaserJobResult {
    gcode: string;
    stats: { lines: number; estimatedTimeSec: number; bounds: Bounds };
}

/** Grayscale image, row 0 = top of the image, values 0 (black) .. 255 (white). */
export interface GrayImage {
    width: number;
    height: number;
    data: ArrayLike<number>;
}

export type ImageDecoder = (dataUrl: string) => Promise<GrayImage>;

export class LaserJobValidationError extends Error { }

const DEFAULT_MAX_S = 1000;
const DEFAULT_TRAVEL = 3000;
const DEFAULT_THRESHOLD = 128;

const fmt = (v: number): string => {
    const r = Math.round(v * 1000) / 1000;
    return (Object.is(r, -0) ? 0 : r).toString();
};

/** Tracks machine state while emitting G-code to compute time and bounds. */
class GcodeWriter {
    lines: string[] = [];
    x = 0;
    y = 0;
    feed = -1;
    timeSec = 0;
    bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    constructor(private travelSpeed: number) { }

    raw(line: string) { this.lines.push(line); }

    resetFeed() { this.feed = -1; }

    g0(x: number, y: number, extra = '') {
        x = round3(x); y = round3(y);
        if (x === this.x && y === this.y && !extra) return;
        this.timeSec += (dist(this.x, this.y, x, y) / this.travelSpeed) * 60;
        this.x = x; this.y = y;
        this.lines.push(`G0 X${fmt(x)} Y${fmt(y)}${extra}`);
    }

    /** Linear move. `s` = spindle value appended (undefined = not emitted). */
    g1(x: number, y: number, feed: number, s?: number): boolean {
        x = round3(x); y = round3(y);
        const d = dist(this.x, this.y, x, y);
        if (d === 0) return false;
        this.timeSec += (d / feed) * 60;
        if (s === undefined || s > 0) {
            this.extend(this.x, this.y);
            this.extend(x, y);
        }
        let line = `G1 X${fmt(x)} Y${fmt(y)}`;
        if (s !== undefined) line += ` S${s}`;
        if (feed !== this.feed) { line += ` F${fmt(feed)}`; this.feed = feed; }
        this.x = x; this.y = y;
        this.lines.push(line);
        return true;
    }

    /** Horizontal raster move (Y unchanged). */
    g1x(x: number, feed: number, s: number) {
        x = round3(x);
        const d = Math.abs(x - this.x);
        if (d === 0) return;
        this.timeSec += (d / feed) * 60;
        if (s > 0) { this.extend(this.x, this.y); this.extend(x, this.y); }
        let line = `G1 X${fmt(x)} S${s}`;
        if (feed !== this.feed) { line += ` F${fmt(feed)}`; this.feed = feed; }
        this.x = x;
        this.lines.push(line);
    }

    private extend(x: number, y: number) {
        const b = this.bounds;
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
    }

    finalBounds(): Bounds {
        const b = this.bounds;
        if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        return { ...b };
    }
}

function round3(v: number) { return Math.round(v * 1000) / 1000; }
function dist(x1: number, y1: number, x2: number, y2: number) { return Math.hypot(x2 - x1, y2 - y1); }
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateLaserJob(body: any): LaserJobRequest {
    if (!body || !Array.isArray(body.operations)) {
        throw new LaserJobValidationError('operations must be an array');
    }
    body.operations.forEach((op: any, i: number) => {
        if (!op || typeof op !== 'object') throw new LaserJobValidationError(`operations[${i}] is invalid`);
        if (op.enabled === false) return;
        if (!['raster', 'vector_cut', 'vector_engrave'].includes(op.type)) {
            throw new LaserJobValidationError(`operations[${i}].type must be raster, vector_cut or vector_engrave`);
        }
        const s = op.settings;
        if (!s || !isNum(s.power) || s.power < 0 || s.power > 100) {
            throw new LaserJobValidationError(`operations[${i}].settings.power must be a number 0-100`);
        }
        if (!isNum(s.speed) || s.speed <= 0) {
            throw new LaserJobValidationError(`operations[${i}].settings.speed must be > 0`);
        }
        if (s.passes !== undefined && (!isNum(s.passes) || s.passes < 1)) {
            throw new LaserJobValidationError(`operations[${i}].settings.passes must be >= 1`);
        }
        if (s.lineInterval !== undefined && (!isNum(s.lineInterval) || s.lineInterval <= 0)) {
            throw new LaserJobValidationError(`operations[${i}].settings.lineInterval must be > 0`);
        }
        if (op.vectors !== undefined) {
            if (!Array.isArray(op.vectors)) throw new LaserJobValidationError(`operations[${i}].vectors must be an array`);
            op.vectors.forEach((v: any, j: number) => {
                if (!v || !Array.isArray(v.points) || !v.points.every((p: any) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) {
                    throw new LaserJobValidationError(`operations[${i}].vectors[${j}].points must be [x,y] number pairs`);
                }
            });
        }
        if (op.rasters !== undefined) {
            if (!Array.isArray(op.rasters)) throw new LaserJobValidationError(`operations[${i}].rasters must be an array`);
            op.rasters.forEach((r: any, j: number) => {
                if (!r || typeof r.dataUrl !== 'string' || !isNum(r.x) || !isNum(r.y) || !isNum(r.width) || !isNum(r.height) || r.width <= 0 || r.height <= 0) {
                    throw new LaserJobValidationError(`operations[${i}].rasters[${j}] needs dataUrl, x, y, width>0, height>0`);
                }
            });
        }
    });
    return body as LaserJobRequest;
}

/** Converts a power percentage to an S value. */
export function powerToS(percent: number, maxS: number): number {
    return Math.round((Math.max(0, Math.min(100, percent)) / 100) * maxS);
}

export async function generateLaserJob(req: LaserJobRequest, decode: ImageDecoder = decodeDataUrlToGray): Promise<LaserJobResult> {
    const opts = req.options ?? {};
    const maxS = isNum(opts.maxS) && opts.maxS > 0 ? opts.maxS : DEFAULT_MAX_S;
    const laserCmd = opts.laserMode === 'M3' ? 'M3' : 'M4';
    const travel = isNum(opts.travelSpeed) && opts.travelSpeed > 0 ? opts.travelSpeed : DEFAULT_TRAVEL;

    const w = new GcodeWriter(travel);
    w.raw('; LzrCnc laser job');
    w.raw('G21');
    w.raw('G90');
    w.raw('M5');
    if (opts.airAssist) w.raw('M8');

    for (const op of req.operations) {
        if (op.enabled === false) continue;
        const s = op.settings;
        const passes = Math.max(1, Math.round(s.passes ?? 1));
        w.raw(`; Operation ${op.id} (${op.type}) power=${s.power}% speed=${s.speed} passes=${passes}`);
        w.resetFeed();

        if (op.type === 'raster') {
            const images: Array<{ img: GrayImage; r: LaserRaster }> = [];
            for (const r of op.rasters ?? []) {
                images.push({ img: await decode(r.dataUrl), r });
            }
            if (images.length === 0) continue;
            w.raw(`${laserCmd} S0`);
            for (let p = 0; p < passes; p++) {
                if (passes > 1) w.raw(`; pass ${p + 1}/${passes}`);
                for (const { img, r } of images) emitRaster(w, img, r, s, maxS);
            }
            w.raw('M5');
        } else {
            const vectors = orderVectors((op.vectors ?? []).filter(v => v.points.length >= 2), [w.x, w.y], op.type === 'vector_cut');
            if (vectors.length === 0) continue;
            const sVal = powerToS(s.power, maxS);
            let laserOn = false;
            for (let p = 0; p < passes; p++) {
                if (passes > 1) w.raw(`; pass ${p + 1}/${passes}`);
                for (const v of vectors) {
                    const pts = v.points;
                    w.g0(pts[0][0], pts[0][1], ' S0');
                    if (!laserOn) { w.raw(`${laserCmd} S${sVal}`); laserOn = true; }
                    const path = v.closed ? [...pts, pts[0]] : pts;
                    let needS = true;
                    for (let i = 1; i < path.length; i++) {
                        if (w.g1(path[i][0], path[i][1], s.speed, needS ? sVal : undefined)) needS = false;
                    }
                }
            }
            w.raw('M5');
        }
    }

    if (opts.airAssist) w.raw('M9');
    w.raw('M5');

    return {
        gcode: w.lines.join('\n') + '\n',
        stats: {
            lines: w.lines.length,
            estimatedTimeSec: Math.round(w.timeSec * 10) / 10,
            bounds: w.finalBounds()
        }
    };
}

/** Point-in-polygon (even-odd). */
function insidePoly(p: [number, number], poly: Array<[number, number]>): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * Orders paths to keep travel short. For cuts, paths nested inside closed contours go first
 * (holes before the outline) so a part never drops out before its inner features are cut.
 * Closed paths start at the vertex nearest to the head; open paths may be reversed.
 */
export function orderVectors(vectors: LaserVector[], start: [number, number] = [0, 0], innerFirst = true): LaserVector[] {
    const items = vectors.map(v => {
        let pts = v.points;
        if (v.closed && pts.length > 2 && dist(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        return { v: { ...v, points: pts }, box: { minX, minY, maxX, maxY }, depth: 0 };
    });
    if (innerFirst) {
        const closed = items.filter(it => it.v.closed && it.v.points.length > 2);
        for (const it of items) {
            const p = it.v.points[0];
            for (const c of closed) {
                if (c === it) continue;
                const b = c.box, a = it.box;
                if (a.minX < b.minX - 1e-9 || a.maxX > b.maxX + 1e-9 || a.minY < b.minY - 1e-9 || a.maxY > b.maxY + 1e-9) continue;
                if (insidePoly(p, c.v.points)) it.depth++;
            }
        }
    }
    const out: LaserVector[] = [];
    let cur = start;
    const levels = [...new Set(items.map(it => it.depth))].sort((a, b) => b - a);
    for (const level of levels) {
        const left = items.filter(it => it.depth === level);
        while (left.length) {
            let best = 0, bestD = Infinity, bestK = 0, bestRev = false;
            left.forEach((it, i) => {
                const pts = it.v.points;
                if (it.v.closed) {
                    pts.forEach((q, k) => { const d = dist(cur[0], cur[1], q[0], q[1]); if (d < bestD) { bestD = d; best = i; bestK = k; bestRev = false; } });
                } else {
                    const d0 = dist(cur[0], cur[1], pts[0][0], pts[0][1]);
                    const d1 = dist(cur[0], cur[1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
                    if (d0 < bestD) { bestD = d0; best = i; bestK = 0; bestRev = false; }
                    if (d1 < bestD) { bestD = d1; best = i; bestK = 0; bestRev = true; }
                }
            });
            const it = left.splice(best, 1)[0];
            let pts = it.v.points;
            if (it.v.closed) pts = [...pts.slice(bestK), ...pts.slice(0, bestK)];
            else if (bestRev) pts = [...pts].reverse();
            out.push({ points: pts, closed: it.v.closed });
            cur = it.v.closed ? pts[0] : pts[pts.length - 1];
        }
    }
    return out;
}

/**
 * Lookup table for brightness (-100..100), contrast (-100..100) and gamma (0.2..5, >1 lightens mid-tones).
 * Same formula as the client preview (client/src/utils/rasterPreview.ts).
 */
export function toneCurve(s: Pick<LaserOpSettings, 'brightness' | 'contrast' | 'gamma'>): Float32Array {
    const b = Math.max(-100, Math.min(100, s.brightness ?? 0)) / 100;
    const c = Math.max(-100, Math.min(100, s.contrast ?? 0)) / 100;
    const g = Math.max(0.2, Math.min(5, s.gamma ?? 1));
    const k = c >= 0 ? 1 / Math.max(0.01, 1 - c) : 1 + c;
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
        let x = v / 255 + b;
        x = (x - 0.5) * k + 0.5;
        x = Math.max(0, Math.min(1, x));
        lut[v] = Math.pow(x, 1 / g) * 255;
    }
    return lut;
}

/** Computes per-pixel power (percent) for an image according to the op settings. */
export function computePowerMap(img: GrayImage, s: LaserOpSettings): Float32Array {
    const n = img.width * img.height;
    const vals = new Float32Array(n);
    const adjust = toneCurve(s);
    for (let i = 0; i < n; i++) {
        const v = img.data[i];
        // Pure white (background / transparent) is never burned, whatever the tone adjustments.
        const t = v >= 254.5 ? 255 : adjust[Math.round(v)];
        vals[i] = s.invert ? 255 - t : t;
    }
    const out = new Float32Array(n);
    const mode = s.mode ?? 'grayscale';
    if (mode === 'threshold') {
        const t = s.threshold ?? DEFAULT_THRESHOLD;
        for (let i = 0; i < n; i++) out[i] = vals[i] < t ? s.power : 0;
    } else if (mode === 'dither') {
        floydSteinberg(vals, img.width, img.height, s.threshold ?? DEFAULT_THRESHOLD);
        for (let i = 0; i < n; i++) out[i] = vals[i] === 0 ? s.power : 0;
    } else {
        const minP = Math.max(0, Math.min(s.power, s.minPower ?? 0));
        for (let i = 0; i < n; i++) {
            const v = vals[i];
            out[i] = v >= 254.5 ? 0 : minP + (1 - v / 255) * (s.power - minP);
        }
    }
    return out;
}

/** In-place Floyd–Steinberg dithering on a float buffer, output values are 0 or 255. */
export function floydSteinberg(px: Float32Array, width: number, height: number, threshold = 128) {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const old = px[idx];
            const nv = old < threshold ? 0 : 255;
            px[idx] = nv;
            const err = old - nv;
            if (x + 1 < width) px[idx + 1] += (err * 7) / 16;
            if (y + 1 < height) {
                if (x > 0) px[idx + width - 1] += (err * 3) / 16;
                px[idx + width] += (err * 5) / 16;
                if (x + 1 < width) px[idx + width + 1] += err / 16;
            }
        }
    }
}

function emitRaster(w: GcodeWriter, img: GrayImage, r: LaserRaster, s: LaserOpSettings, maxS: number) {
    const power = computePowerMap(img, s);
    const sMap = new Int32Array(power.length);
    for (let i = 0; i < power.length; i++) sMap[i] = powerToS(power[i], maxS);

    const px = r.width / img.width;
    const py = r.height / img.height;
    const overscan = Math.max(0, s.overscan ?? 0);
    const feed = s.speed;
    let forward = true;

    for (let row = 0; row < img.height; row++) {
        const base = row * img.width;
        let first = -1, last = -1;
        for (let c = 0; c < img.width; c++) {
            if (sMap[base + c] > 0) { if (first < 0) first = c; last = c; }
        }
        if (first < 0) continue;

        const y = r.y + r.height - (row + 0.5) * py;
        const dir = forward ? 1 : -1;
        const startX = r.x + (forward ? first : last + 1) * px;
        const endX = r.x + (forward ? last + 1 : first) * px;

        w.g0(startX - dir * overscan, y);
        if (overscan > 0) w.g1x(startX, feed, 0);

        if (forward) {
            let c = first;
            while (c <= last) {
                const v = sMap[base + c];
                let e = c + 1;
                while (e <= last && sMap[base + e] === v) e++;
                w.g1x(r.x + e * px, feed, v);
                c = e;
            }
        } else {
            let c = last;
            while (c >= first) {
                const v = sMap[base + c];
                let e = c - 1;
                while (e >= first && sMap[base + e] === v) e--;
                w.g1x(r.x + (e + 1) * px, feed, v);
                c = e;
            }
        }

        if (overscan > 0) w.g1x(endX + dir * overscan, feed, 0);
        forward = !forward;
    }
}

/** Decodes a PNG/JPEG data URL to an 8-bit grayscale image (alpha flattened onto white). */
export async function decodeDataUrlToGray(dataUrl: string): Promise<GrayImage> {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m || !m[2]) throw new LaserJobValidationError('raster dataUrl must be a base64 data URL');
    const buf = Buffer.from(m[3], 'base64');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    let out: { data: Buffer; info: { width: number; height: number; channels: number } };
    try {
        out = await sharp(buf)
            .flatten({ background: '#ffffff' })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });
    } catch (e: any) {
        throw new LaserJobValidationError(`could not decode raster image: ${e.message}`);
    }
    const { width, height, channels } = out.info;
    if (channels === 1) return { width, height, data: out.data };
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = out.data[i * channels];
    return { width, height, data };
}
