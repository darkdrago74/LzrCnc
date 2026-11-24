/**
 * Lightweight G-code interpreter used for previews (3D viewer, bounds, frame, time estimate).
 * Handles modal motion (G0/G1/G2/G3), G90/G91, G20/G21, G92 offsets, I/J and R arcs,
 * ( ) and ; comments, line numbers and S/F words.
 */

export type MoveKind = 'rapid' | 'cut';

export interface GcodeSegment {
    kind: MoveKind;
    from: [number, number, number];
    to: [number, number, number];
    /** Spindle / laser power word in effect (S) */
    s: number;
    /** Feed rate in effect (F, mm/min) */
    f: number;
    /** Source line index (0-based) */
    line: number;
}

export interface GcodeBounds {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
}

export interface ParsedGcode {
    segments: GcodeSegment[];
    bounds: GcodeBounds;
    /** Bounds of cutting moves only (what is actually burned / milled) */
    cutBounds: GcodeBounds;
    cutLength: number;
    rapidLength: number;
    /** Rough estimate in seconds (no acceleration model) */
    estimatedTime: number;
}

const ARC_SEG_MM = 0.5;
const DEFAULT_RAPID = 3000;

function emptyBounds(): GcodeBounds {
    return { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
}

function grow(b: GcodeBounds, p: [number, number, number]) {
    if (p[0] < b.min.x) b.min.x = p[0];
    if (p[1] < b.min.y) b.min.y = p[1];
    if (p[2] < b.min.z) b.min.z = p[2];
    if (p[0] > b.max.x) b.max.x = p[0];
    if (p[1] > b.max.y) b.max.y = p[1];
    if (p[2] > b.max.z) b.max.z = p[2];
}

function finalize(b: GcodeBounds): GcodeBounds {
    if (!isFinite(b.min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    return b;
}

export function stripComment(line: string): string {
    return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

export function parseGcode(input: string | string[], rapidRate = DEFAULT_RAPID): ParsedGcode {
    const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
    const segments: GcodeSegment[] = [];
    const bounds = emptyBounds();
    const cutBounds = emptyBounds();

    let pos: [number, number, number] = [0, 0, 0];
    const offset: [number, number, number] = [0, 0, 0];
    let motion = 0;
    let absolute = true;
    let unit = 1;
    let feed = 1000;
    let power = 0;
    let cutLength = 0, rapidLength = 0, time = 0;

    const push = (kind: MoveKind, to: [number, number, number], lineIdx: number) => {
        const from = pos;
        const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        if (d < 1e-9) { pos = to; return; }
        segments.push({ kind, from, to, s: power, f: feed, line: lineIdx });
        grow(bounds, from); grow(bounds, to);
        if (kind === 'cut') { grow(cutBounds, from); grow(cutBounds, to); cutLength += d; time += d / Math.max(feed, 1) * 60; }
        else { rapidLength += d; time += d / rapidRate * 60; }
        pos = to;
    };

    for (let li = 0; li < lines.length; li++) {
        const code = stripComment(lines[li]).toUpperCase();
        if (!code || code.startsWith('$') || code.startsWith('%')) continue;

        const words = code.match(/[A-Z][-+]?\d*\.?\d+(?:E[-+]?\d+)?/g);
        if (!words) continue;

        const vals: Record<string, number> = {};
        let isG92 = false, nonModal = false, motionWord = false;
        for (const w of words) {
            const letter = w[0];
            const num = parseFloat(w.slice(1));
            if (letter === 'G') {
                const g = Math.round(num * 10) / 10;
                if (g === 0 || g === 1 || g === 2 || g === 3) { motion = g; motionWord = true; }
                else if (g === 90) absolute = true;
                else if (g === 91) absolute = false;
                else if (g === 20) unit = 25.4;
                else if (g === 21) unit = 1;
                else if (g === 92) isG92 = true;
                else if (g === 28 || g === 30 || g === 53 || g === 4 || g === 10 || g === 38.2) nonModal = true;
            } else if (letter !== 'N') {
                vals[letter] = num;
            }
        }
        if ('F' in vals) feed = vals.F * unit;
        if ('S' in vals) power = vals.S;
        if (nonModal) continue;

        const hasAxis = 'X' in vals || 'Y' in vals || 'Z' in vals;
        if (isG92) {
            (['X', 'Y', 'Z'] as const).forEach((a, i) => {
                if (a in vals) offset[i] = pos[i] - vals[a] * unit;
            });
            continue;
        }
        if (!hasAxis && !(motionWord && (motion === 2 || motion === 3) && ('I' in vals || 'J' in vals))) continue;

        const target: [number, number, number] = [pos[0], pos[1], pos[2]];
        (['X', 'Y', 'Z'] as const).forEach((a, i) => {
            if (a in vals) target[i] = absolute ? vals[a] * unit + offset[i] : pos[i] + vals[a] * unit;
        });

        if (motion === 0) push('rapid', target, li);
        else if (motion === 1) push('cut', target, li);
        else {
            const cw = motion === 2;
            let cx: number, cy: number;
            if ('R' in vals) {
                const r = vals.R * unit;
                const dx = target[0] - pos[0], dy = target[1] - pos[1];
                const d = Math.hypot(dx, dy);
                if (d < 1e-9) { push('cut', target, li); continue; }
                const h = Math.sqrt(Math.max(r * r - (d / 2) * (d / 2), 0));
                // Negative R selects the long arc
                const sign = (cw ? -1 : 1) * (r < 0 ? -1 : 1);
                cx = pos[0] + dx / 2 - sign * h * dy / d;
                cy = pos[1] + dy / 2 + sign * h * dx / d;
            } else {
                cx = pos[0] + (vals.I ?? 0) * unit;
                cy = pos[1] + (vals.J ?? 0) * unit;
            }
            const r = Math.hypot(pos[0] - cx, pos[1] - cy);
            const a0 = Math.atan2(pos[1] - cy, pos[0] - cx);
            let a1 = Math.atan2(target[1] - cy, target[0] - cx);
            let sweep = a1 - a0;
            if (cw && sweep >= -1e-9) sweep -= Math.PI * 2;
            if (!cw && sweep <= 1e-9) sweep += Math.PI * 2;
            a1 = a0 + sweep;
            const steps = Math.max(4, Math.ceil(Math.abs(sweep) * r / ARC_SEG_MM));
            const z0 = pos[2];
            for (let k = 1; k <= steps; k++) {
                const t = k / steps;
                const a = a0 + sweep * t;
                const p: [number, number, number] = k === steps
                    ? target
                    : [cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + (target[2] - z0) * t];
                push('cut', p, li);
            }
        }
    }

    return {
        segments,
        bounds: finalize(bounds),
        cutBounds: finalize(cutBounds),
        cutLength,
        rapidLength,
        estimatedTime: time,
    };
}

export function formatDuration(sec: number): string {
    if (!isFinite(sec) || sec <= 0) return '0s';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
