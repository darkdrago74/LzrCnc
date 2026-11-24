/**
 * Parametric drawing shapes (rectangle, circle/ellipse, slot, polygon on a construction circle,
 * star, text). Every shape is regenerated from its parameters, so it stays editable after it has
 * been placed on the bed. Shapes are SVGs whose user units are millimetres; the shape's centre is
 * the centre of the SVG, i.e. the object's position on the bed.
 */
import type { ParametricConfig, SceneObject } from '../types';
import { simplify } from './svgUtils';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Metric hex nut sizes: across-flats (wrench size) in mm, ISO 4032. */
export const NUT_PRESETS: { label: string; flats: number }[] = [
    { label: 'M2', flats: 4 }, { label: 'M2.5', flats: 5 }, { label: 'M3', flats: 5.5 }, { label: 'M4', flats: 7 },
    { label: 'M5', flats: 8 }, { label: 'M6', flats: 10 }, { label: 'M8', flats: 13 }, { label: 'M10', flats: 17 }, { label: 'M12', flats: 19 },
];

export const SHAPE_TITLES: Record<ParametricConfig['shape'], string> = {
    rect: 'Rectangle', ellipse: 'Circle / ellipse', slot: 'Slot', polygon: 'Polygon', star: 'Star', text: 'Text',
};

export const DEFAULT_SHAPES: Record<ParametricConfig['shape'], ParametricConfig> = {
    rect: { shape: 'rect', width: 50, height: 30, radius: 0 },
    ellipse: { shape: 'ellipse', width: 30, height: 30 },
    slot: { shape: 'slot', width: 40, height: 8 },
    polygon: { shape: 'polygon', sides: 6, diameter: 30, sizeBy: 'circle', angle: 0, hole: 0 },
    star: { shape: 'star', sides: 5, diameter: 40, innerRadius: 45, angle: 0 },
    text: { shape: 'text', text: 'LzrCnc', font: 'Arial', bold: true, textHeight: 10, textMode: 'raster' },
};

/** Ø of the circle through the polygon's vertices (construction circle). */
export function polygonCircleDiameter(p: ParametricConfig): number {
    const n = Math.max(3, Math.round(p.sides ?? 6));
    const d = Math.max(0.1, p.diameter ?? 30);
    return p.shape === 'polygon' && p.sizeBy === 'flats' ? d / Math.cos(Math.PI / n) : d;
}

/** Distance across flats of a regular polygon (for even sides; inscribed-circle Ø in general). */
export function polygonAcrossFlats(p: ParametricConfig): number {
    const n = Math.max(3, Math.round(p.sides ?? 6));
    return polygonCircleDiameter(p) * Math.cos(Math.PI / n);
}

/** Vertices of a polygon / star in SVG coordinates (y down), centred on (c, c). */
export function polygonPoints(p: ParametricConfig): [number, number][] {
    const n = Math.max(3, Math.round(p.sides ?? 6));
    const D = polygonCircleDiameter(p), R = D / 2;
    const star = p.shape === 'star';
    const count = star ? n * 2 : n;
    // Polygons: a flat on top (hex nut drawing convention); stars: a point on top.
    const a0 = -Math.PI / 2 + (star ? 0 : Math.PI / n) + ((p.angle ?? 0) * Math.PI) / 180;
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) {
        const a = a0 + (i * 2 * Math.PI) / count;
        const k = star && i % 2 === 1 ? Math.max(5, Math.min(95, p.innerRadius ?? 45)) / 100 : 1;
        pts.push([R + R * k * Math.cos(a), R + R * k * Math.sin(a)]);
    }
    return pts;
}

/** Size in mm of the shape's SVG box. Polygons/stars use the construction circle so the centre never moves. */
export function shapeSize(p: ParametricConfig): [number, number] {
    if (p.shape === 'polygon' || p.shape === 'star') {
        const D = polygonCircleDiameter(p);
        return [D, D];
    }
    return [Math.max(0.1, p.width ?? 10), Math.max(0.1, p.height ?? 10)];
}

/** SVG (mm units) of a geometric shape. Text is handled by {@link buildShape}. */
export function shapeSvg(p: ParametricConfig): string {
    const [w, h] = shapeSize(p);
    const style = p.fill ? 'fill="#000" stroke="none"' : 'fill="none" stroke="#000" stroke-width="0.3"';
    const holeStyle = p.fill ? 'fill="#fff" stroke="none"' : style;
    let body: string;
    if (p.shape === 'rect' || p.shape === 'slot') {
        const r = p.shape === 'slot' ? Math.min(w, h) / 2 : Math.min(p.radius ?? 0, w / 2, h / 2);
        body = `<rect x="0" y="0" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(r)}" ry="${fmt(r)}" ${style}/>`;
    } else if (p.shape === 'ellipse') {
        body = `<ellipse cx="${fmt(w / 2)}" cy="${fmt(h / 2)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}" ${style}/>`;
    } else {
        body = `<polygon points="${polygonPoints(p).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}" ${style}/>`;
    }
    const hole = Math.min(p.hole ?? 0, Math.min(w, h) * 0.98);
    if (hole > 0 && p.shape !== 'slot') body += `<circle cx="${fmt(w / 2)}" cy="${fmt(h / 2)}" r="${fmt(hole / 2)}" ${holeStyle}/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">${body}</svg>`;
}

/** Short human-readable description used as the object name. */
export function shapeLabel(p: ParametricConfig): string {
    const [w, h] = shapeSize(p);
    switch (p.shape) {
        case 'rect': return `Rectangle ${fmt(w)}×${fmt(h)}`;
        case 'slot': return `Slot ${fmt(w)}×${fmt(h)}`;
        case 'ellipse': return Math.abs(w - h) < 1e-6 ? `Circle Ø${fmt(w)}` : `Ellipse ${fmt(w)}×${fmt(h)}`;
        case 'polygon': {
            const n = Math.round(p.sides ?? 6);
            return p.sizeBy === 'flats' ? `${n}-gon ${fmt(p.diameter ?? 0)} A/F` : `${n}-gon Ø${fmt(w)}`;
        }
        case 'star': return `Star ${Math.round(p.sides ?? 5)} pts Ø${fmt(w)}`;
        case 'text': return `Text "${(p.text ?? '').split('\n')[0].slice(0, 16)}"`;
    }
}

// ── Text ─────────────────────────────────────────────────────────────────────

const TEXT_PX_PER_MM = 20;

/** Draws text (black on transparent) on a canvas sized to fit; returns the canvas and px/mm used. */
function renderText(p: ParametricConfig): { canvas: HTMLCanvasElement; pxPerMm: number } | null {
    const text = p.text ?? '';
    if (!text.trim()) return null;
    const lines = text.split('\n');
    const hMm = Math.max(0.5, p.textHeight ?? 10);
    let pxPerMm = TEXT_PX_PER_MM;
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) return null;
    const spec = (px: number) => `${p.bold ? 'bold ' : ''}${px}px ${p.font ?? 'Arial'}`;
    measure.font = spec(hMm * pxPerMm);
    const widest = Math.max(...lines.map(l => measure.measureText(l).width));
    // Keep the bitmap below ~6000 px wide.
    if (widest > 6000) pxPerMm *= 6000 / widest;
    const px = hMm * pxPerMm;
    const lineH = px * 1.2;
    const pad = Math.ceil(px * 0.1) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((widest * pxPerMm) / TEXT_PX_PER_MM) + 2 * pad);
    canvas.height = Math.max(1, Math.ceil(lineH * lines.length) + 2 * pad);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = spec(px);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + lineH * (i + 0.5)));
    return { canvas, pxPerMm };
}

/**
 * Traces the outlines of a binary bitmap (pixel-edge contours, then simplified).
 * Returns closed loops in pixel coordinates (x right, y down). Holes (e.g. inside an "O") are separate loops.
 */
export function traceBitmap(inside: (x: number, y: number) => boolean, width: number, height: number, tolerancePx = 0.6): [number, number][][] {
    const W1 = width + 1;
    const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = [];
    const out = new Map<number, number[]>();
    const isIn = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && inside(x, y);
    const add = (x0: number, y0: number, x1: number, y1: number) => {
        const k = ex0.length;
        ex0.push(x0); ey0.push(y0); ex1.push(x1); ey1.push(y1);
        const key = y0 * W1 + x0;
        const list = out.get(key);
        if (list) list.push(k); else out.set(key, [k]);
    };
    // Boundary edges, oriented clockwise around inside pixels (y down).
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!isIn(x, y)) continue;
        if (!isIn(x, y - 1)) add(x, y, x + 1, y);
        if (!isIn(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!isIn(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!isIn(x - 1, y)) add(x, y + 1, x, y);
    }
    const used = new Uint8Array(ex0.length);
    const loops: [number, number][][] = [];
    for (let s = 0; s < ex0.length; s++) {
        if (used[s]) continue;
        const pts: [number, number][] = [[ex0[s], ey0[s]]];
        let e = s;
        for (;;) {
            used[e] = 1;
            const x = ex1[e], y = ey1[e];
            if (x === ex0[s] && y === ey0[s]) break;
            pts.push([x, y]);
            const cands = (out.get(y * W1 + x) ?? []).filter(k => !used[k]);
            if (!cands.length) break;
            // At pixels touching only by a corner, take the right-most turn (keeps loops simple).
            const dx = x - ex0[e], dy = y - ey0[e];
            let best = cands[0], bestCross = -Infinity;
            for (const k of cands) {
                const cross = dx * (ey1[k] - ey0[k]) - dy * (ex1[k] - ex0[k]);
                if (cross > bestCross) { bestCross = cross; best = k; }
            }
            e = best;
        }
        if (pts.length < 4) continue;
        // Drop collinear points, then RDP on the closed loop.
        const corners = pts.filter((p, i) => {
            const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
            return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
        });
        if (corners.length < 3) continue;
        const simp = simplify([...corners, corners[0]], tolerancePx);
        simp.pop();
        if (simp.length >= 3) loops.push(simp);
    }
    return loops;
}

export interface BuiltShape {
    type: SceneObject['type'];
    content: string;
    size: [number, number];
    svgUnitsMm?: boolean;
    name: string;
}

/** Builds the scene-object content for a parametric shape (SVG, or PNG for raster text). */
export function buildShape(p: ParametricConfig): BuiltShape | null {
    if (p.shape !== 'text') {
        return { type: p.shape === 'slot' ? 'rect' : p.shape, content: shapeSvg(p), size: shapeSize(p), svgUnitsMm: true, name: shapeLabel(p) };
    }
    const r = renderText(p);
    if (!r) return null;
    const { canvas, pxPerMm } = r;
    const size: [number, number] = [canvas.width / pxPerMm, canvas.height / pxPerMm];
    if (p.textMode !== 'vector') {
        return { type: 'image', content: canvas.toDataURL('image/png'), size, name: shapeLabel(p) };
    }
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const loops = traceBitmap((x, y) => data[(y * canvas.width + x) * 4 + 3] > 127, canvas.width, canvas.height);
    if (!loops.length) return null;
    const d = loops.map(l => `M${l.map(([x, y]) => `${fmt(x / pxPerMm)} ${fmt(y / pxPerMm)}`).join('L')}Z`).join('');
    const style = p.fill ? 'fill="#000" fill-rule="evenodd" stroke="none"' : 'fill="none" stroke="#000" stroke-width="0.2"';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(size[0])}mm" height="${fmt(size[1])}mm" viewBox="0 0 ${fmt(size[0])} ${fmt(size[1])}"><path d="${d}" ${style}/></svg>`;
    return { type: 'text', content: svg, size, svgUnitsMm: true, name: shapeLabel(p) };
}
