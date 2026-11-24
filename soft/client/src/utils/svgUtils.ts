/**
 * SVG helpers: physical size detection and flattening into polylines (mm, Y-up).
 * Flattening relies on the browser SVG engine (getPointAtLength / getScreenCTM), so
 * transforms, arcs, beziers and basic shapes are all handled exactly as displayed.
 */

export interface SvgInfo {
    viewBox: [number, number, number, number];
    widthMm: number;
    heightMm: number;
}

export type Polyline = { points: [number, number][]; closed: boolean };

const PX_MM = 25.4 / 96;
const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: PX_MM, '': PX_MM };

function parseLength(v: string | null, assumeMm: boolean): number | null {
    if (!v) return null;
    const m = v.trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?$/i);
    if (!m || m[2] === '%') return null;
    const unit = (m[2] || '').toLowerCase();
    const n = parseFloat(m[1]);
    return n * (unit === '' && assumeMm ? 1 : UNIT_MM[unit]);
}

function parseDoc(svg: string): SVGSVGElement | null {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    return root as unknown as SVGSVGElement;
}

/** Physical size of an SVG. Unitless values are CSS px (96 DPI) unless assumeMm (e.g. DXF exports). */
export function getSvgInfo(svg: string, assumeMm = false): SvgInfo {
    const root = parseDoc(svg);
    if (!root) return { viewBox: [0, 0, 100, 100], widthMm: 100, heightMm: 100 };
    const vbAttr = root.getAttribute('viewBox');
    const vb = vbAttr?.trim().split(/[\s,]+/).map(Number);
    const w = parseLength(root.getAttribute('width'), assumeMm);
    const h = parseLength(root.getAttribute('height'), assumeMm);
    const unitScale = assumeMm ? 1 : PX_MM;
    if (vb && vb.length === 4 && vb.every(n => isFinite(n)) && vb[2] > 0 && vb[3] > 0) {
        const viewBox = vb as [number, number, number, number];
        if (w && h) return { viewBox, widthMm: w, heightMm: h };
        if (w) return { viewBox, widthMm: w, heightMm: w * vb[3] / vb[2] };
        if (h) return { viewBox, widthMm: h * vb[2] / vb[3], heightMm: h };
        return { viewBox, widthMm: vb[2] * unitScale, heightMm: vb[3] * unitScale };
    }
    const wmm = w ?? 100, hmm = h ?? 100;
    const toUser = (mm: number) => assumeMm ? mm : mm / PX_MM;
    return { viewBox: [0, 0, toUser(wmm), toUser(hmm)], widthMm: wmm, heightMm: hmm };
}

/** Returns the SVG with explicit pixel width/height + viewBox so it rasterizes crisply as a texture. */
export function svgForTexture(svg: string, info: SvgInfo, pxPerMm = 6, maxPx = 2048): string {
    const root = parseDoc(svg);
    if (!root) return svg;
    const scale = Math.min(pxPerMm, maxPx / Math.max(info.widthMm, info.heightMm, 1));
    root.setAttribute('viewBox', info.viewBox.join(' '));
    root.setAttribute('width', String(Math.max(1, Math.round(info.widthMm * scale))));
    root.setAttribute('height', String(Math.max(1, Math.round(info.heightMm * scale))));
    root.setAttribute('preserveAspectRatio', 'none');
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(root);
}

/** Split a path "d" string into subpaths, each starting with an absolute M. */
export function splitSubpaths(d: string): string[] {
    const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    const argc: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    const out: string[] = [];
    let cur = '';
    let x = 0, y = 0, sx = 0, sy = 0;
    let i = 0;
    let cmd = '';
    while (i < tokens.length) {
        if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
        else if (!cmd) { i++; continue; }
        const up = cmd.toUpperCase();
        const rel = cmd !== up;
        const n = argc[up];
        if (n === 0) { cur += ' Z'; x = sx; y = sy; if (i < tokens.length && !/[a-z]/i.test(tokens[i])) i++; continue; }
        const args = tokens.slice(i, i + n).map(Number);
        if (args.length < n) break;
        i += n;
        if (up === 'M') {
            x = rel ? x + args[0] : args[0];
            y = rel ? y + args[1] : args[1];
            sx = x; sy = y;
            if (cur.trim()) out.push(cur.trim());
            cur = `M ${x} ${y}`;
            cmd = rel ? 'l' : 'L';
            continue;
        }
        cur += ` ${cmd} ${args.join(' ')}`;
        if (up === 'H') x = rel ? x + args[0] : args[0];
        else if (up === 'V') y = rel ? y + args[0] : args[0];
        else {
            x = rel ? x + args[n - 2] : args[n - 2];
            y = rel ? y + args[n - 1] : args[n - 1];
        }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Ramer–Douglas–Peucker simplification (iterative). */
export function simplify(points: [number, number][], tol: number): [number, number][] {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop()!;
        let maxD = 0, idx = -1;
        for (let k = s + 1; k < e; k++) {
            const d = perpDist(points[k], points[s], points[e]);
            if (d > maxD) { maxD = d; idx = k; }
        }
        if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return points.filter((_, k) => keep[k]);
}

/**
 * Flattens all geometry of an SVG into polylines in object-local mm coordinates:
 * origin at the object's center, +Y up (machine convention).
 */
export function flattenSvg(svg: string, info: SvgInfo, toleranceMm = 0.05): Polyline[] {
    const root = parseDoc(svg);
    if (!root) return [];
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;';
    const live = document.importNode(root, true) as unknown as SVGSVGElement;
    live.setAttribute('viewBox', info.viewBox.join(' '));
    live.setAttribute('width', String(info.widthMm));
    live.setAttribute('height', String(info.heightMm));
    live.setAttribute('preserveAspectRatio', 'none');
    host.appendChild(live);
    document.body.appendChild(host);

    const [vx, vy, vw, vh] = info.viewBox;
    const sx = info.widthMm / vw, sy = info.heightMm / vh;
    const toMm = (px: number, py: number): [number, number] => [
        (px - vx) * sx - info.widthMm / 2,
        info.heightMm / 2 - (py - vy) * sy,
    ];
    const step = Math.max(toleranceMm * 2, 0.05);
    const result: Polyline[] = [];

    try {
        const rootCtm = live.getScreenCTM();
        if (!rootCtm) return [];
        const rootInv = rootCtm.inverse();
        const shapes = Array.from(live.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) as SVGGeometryElement[];
        for (const el of shapes) {
            if (el.closest('defs,clipPath,mask,symbol,marker,pattern')) continue;
            const elCtm = el.getScreenCTM();
            if (!elCtm) continue;
            const m = rootInv.multiply(elCtm);
            let pieces: SVGGeometryElement[] = [el];
            const temp: SVGGeometryElement[] = [];
            if (el.tagName.toLowerCase() === 'path') {
                const subs = splitSubpaths(el.getAttribute('d') || '');
                if (subs.length > 1) {
                    pieces = subs.map(d => {
                        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        p.setAttribute('d', d);
                        el.parentNode!.insertBefore(p, el);
                        temp.push(p);
                        return p;
                    });
                }
            }
            const avgScale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * Math.sqrt(sx * sy) || 1;
            for (const piece of pieces) {
                const len = piece.getTotalLength();
                if (!(len > 0)) continue;
                const n = Math.min(20000, Math.max(2, Math.ceil(len * avgScale / step)));
                const pts: [number, number][] = [];
                for (let k = 0; k <= n; k++) {
                    const p = piece.getPointAtLength((len * k) / n);
                    pts.push(toMm(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f));
                }
                const tag = el.tagName.toLowerCase();
                const d = piece.getAttribute('d') || '';
                const closed = ['rect', 'circle', 'ellipse', 'polygon'].includes(tag) || /z\s*$/i.test(d)
                    || Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01;
                const simple = simplify(pts, toleranceMm);
                if (closed && simple.length > 2) simple[simple.length - 1] = simple[0];
                result.push({ points: simple, closed });
            }
            temp.forEach(t => t.remove());
        }
    } finally {
        document.body.removeChild(host);
    }
    return result;
}
