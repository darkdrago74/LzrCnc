/**
 * Client-side mirror of the server raster pipeline (server/src/cam/LaserJobGenerator.ts:
 * toneCurve + computePowerMap) so the operation panel can preview what will be burned.
 */

export interface RasterSettings {
    power?: number;
    minPower?: number;
    mode?: 'grayscale' | 'dither' | 'threshold';
    threshold?: number;
    invert?: boolean;
    brightness?: number;
    contrast?: number;
    gamma?: number;
}

/** Brightness (-100..100), contrast (-100..100), gamma (0.2..5, > 1 lightens mid-tones) lookup table. */
export function toneCurve(s: Pick<RasterSettings, 'brightness' | 'contrast' | 'gamma'>): Float32Array {
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

/** Burn intensity 0..1 for each pixel of a grey image (same rules as the G-code generator). */
export function burnMap(gray: Uint8ClampedArray | Uint8Array, width: number, height: number, s: RasterSettings): Float32Array {
    const n = width * height;
    const lut = toneCurve(s);
    const vals = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const v = gray[i];
        const t = v >= 254.5 ? 255 : lut[Math.round(v)];
        vals[i] = s.invert ? 255 - t : t;
    }
    const out = new Float32Array(n);
    const mode = s.mode ?? 'grayscale';
    const th = s.threshold ?? 128;
    if (mode === 'threshold') {
        for (let i = 0; i < n; i++) out[i] = vals[i] < th ? 1 : 0;
    } else if (mode === 'dither') {
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const old = vals[i];
            const nv = old < th ? 0 : 255;
            vals[i] = nv;
            const err = old - nv;
            if (x + 1 < width) vals[i + 1] += (err * 7) / 16;
            if (y + 1 < height) {
                if (x > 0) vals[i + width - 1] += (err * 3) / 16;
                vals[i + width] += (err * 5) / 16;
                if (x + 1 < width) vals[i + width + 1] += err / 16;
            }
            out[i] = nv === 0 ? 1 : 0;
        }
    } else {
        const p = Math.max(1, s.power ?? 100);
        const minK = Math.max(0, Math.min(p, s.minPower ?? 0)) / p;
        for (let i = 0; i < n; i++) out[i] = vals[i] >= 254.5 ? 0 : minK + (1 - vals[i] / 255) * (1 - minK);
    }
    return out;
}

/** Luma of RGBA pixels composited on white (transparent = white = no burn). */
export function rgbaToGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
    const n = rgba.length / 4;
    const g = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
        const a = rgba[i * 4 + 3] / 255;
        const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
        g[i] = Math.round(l * a + 255 * (1 - a));
    }
    return g;
}
