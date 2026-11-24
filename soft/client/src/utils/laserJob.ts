/**
 * Builds the /cam/generate payload from scene objects.
 *
 * Everything sent to the server is already in final machine millimetres (Y up):
 *  - vector objects are flattened to polylines and transformed (size → scale → rotate → translate)
 *  - raster objects are resampled so that 1 px == lineInterval mm, with rotation baked in
 *    and a white background (white = no burn)
 */
import type { SceneObject } from '../types';
import type { CamOperation, OperationType } from '../components/cam/interfaces';
import { flattenSvg, getSvgInfo, svgForTexture } from './svgUtils';

export const isUrlContent = (s: string) => /^(https?:|blob:|data:)/.test(s);

/** Objects that carry vector geometry (SVG markup, including DXF converted to SVG). */
export const isVectorObject = (o: SceneObject) =>
    o.type !== 'gcode' && o.type !== 'stl' && o.type !== 'image' && !isUrlContent(o.content) && /<svg[\s>]/i.test(o.content);

export const isRasterObject = (o: SceneObject) => o.type === 'image' || (o.type !== 'gcode' && o.type !== 'stl' && isUrlContent(o.content));

/** Colour palette for operation profiles (also used to tag objects in the list and the 3D view). */
export const OP_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];

export const OP_TYPE_LABEL: Record<OperationType, string> = { raster: 'Raster engrave', vector_engrave: 'Line engrave', vector_cut: 'Cut' };

/** Object assignment meaning "do not burn this object". */
export const SKIP_OPERATION = 'none';

export function defaultOperation(type: OperationType, order = 0): CamOperation {
    const base = {
        id: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, type, enabled: true, order,
        name: `${OP_TYPE_LABEL[type]} ${order + 1}`, color: OP_COLORS[order % OP_COLORS.length],
    };
    if (type === 'raster') {
        return { ...base, settings: { power: 60, minPower: 0, speed: 3000, passes: 1, mode: 'grayscale', threshold: 128, lineInterval: 0.1, overscan: 3, invert: false, brightness: 0, contrast: 0, gamma: 1 } };
    }
    if (type === 'vector_engrave') {
        return { ...base, settings: { power: 30, speed: 1500, passes: 1 } };
    }
    return { ...base, settings: { power: 100, speed: 400, passes: 1 } };
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
});

/** Physical (unscaled) size of an object in mm. */
export async function objectBaseSize(o: SceneObject): Promise<[number, number]> {
    if (o.size) return o.size;
    if (!isUrlContent(o.content)) {
        const info = getSvgInfo(o.content, o.svgUnitsMm);
        return [info.widthMm, info.heightMm];
    }
    const img = await loadImage(o.content);
    return [img.naturalWidth * 25.4 / 96, img.naturalHeight * 25.4 / 96];
}

/** Transforms an object-local point (mm, centered, Y up) into machine coordinates. */
export function objectTransform(o: SceneObject) {
    const r = (o.rotation[2] || 0) * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const [sx, sy] = o.scale;
    const [tx, ty] = o.position;
    return (x: number, y: number): [number, number] => {
        const ax = x * sx, ay = y * sy;
        return [tx + ax * c - ay * s, ty + ax * s + ay * c];
    };
}

export interface VectorPath { points: [number, number][]; closed: boolean }
export interface RasterTile { dataUrl: string; x: number; y: number; width: number; height: number }

export function objectVectors(o: SceneObject): VectorPath[] {
    const info = getSvgInfo(o.content, o.svgUnitsMm);
    const polys = flattenSvg(o.content, info);
    const [w, h] = o.size ?? [info.widthMm, info.heightMm];
    const kx = w / info.widthMm, ky = h / info.heightMm;
    const tf = objectTransform(o);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return polys
        .filter(p => p.points.length >= 2)
        .map(p => ({
            closed: p.closed,
            points: p.points.map(([x, y]) => {
                const [mx, my] = tf(x * kx, y * ky);
                return [round(mx), round(my)] as [number, number];
            }),
        }));
}

const MAX_RASTER_PX = 8000;

export async function objectRaster(o: SceneObject, lineInterval: number): Promise<RasterTile> {
    let url = o.content;
    let revoke = false;
    if (!isUrlContent(o.content)) {
        const info = getSvgInfo(o.content, o.svgUnitsMm);
        url = URL.createObjectURL(new Blob([svgForTexture(o.content, info, 20, 4096)], { type: 'image/svg+xml' }));
        revoke = true;
    }
    try {
        const img = await loadImage(url);
        const [bw, bh] = await objectBaseSize(o);
        const w = bw * Math.abs(o.scale[0]);
        const h = bh * Math.abs(o.scale[1]);
        const r = (o.rotation[2] || 0) * Math.PI / 180;
        const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
        const boxW = w * c + h * s;
        const boxH = w * s + h * c;

        const pxW = Math.max(1, Math.round(boxW / lineInterval));
        const pxH = Math.max(1, Math.round(boxH / lineInterval));
        if (pxW > MAX_RASTER_PX || pxH > MAX_RASTER_PX) {
            throw new Error(`"${o.name}" is too large for a ${lineInterval} mm line interval (${pxW}×${pxH} px). Increase the line interval.`);
        }

        const canvas = document.createElement('canvas');
        canvas.width = pxW;
        canvas.height = pxH;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pxW, pxH);
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(pxW / 2, pxH / 2);
        // Canvas Y points down, so a counter-clockwise machine rotation is negative here
        ctx.rotate(-r);
        ctx.scale(Math.sign(o.scale[0]) || 1, Math.sign(o.scale[1]) || 1);
        ctx.drawImage(img, -w / lineInterval / 2, -h / lineInterval / 2, w / lineInterval, h / lineInterval);

        return {
            dataUrl: canvas.toDataURL('image/png'),
            x: o.position[0] - (pxW * lineInterval) / 2,
            y: o.position[1] - (pxH * lineInterval) / 2,
            width: pxW * lineInterval,
            height: pxH * lineInterval,
        };
    } finally {
        if (revoke) URL.revokeObjectURL(url);
    }
}

/** Which operation an object belongs to: explicit assignment ('none' = skip), else first matching enabled op. */
export function resolveOperation(o: SceneObject, ops: CamOperation[]): CamOperation | undefined {
    if (o.operationId === SKIP_OPERATION) return undefined;
    if (o.operationId) {
        const op = ops.find(x => x.id === o.operationId);
        if (op) return op;
    }
    if (isRasterObject(o)) return ops.find(x => x.enabled && x.type === 'raster');
    if (isVectorObject(o)) return ops.find(x => x.enabled && x.type !== 'raster');
    return undefined;
}

export interface LaserJobPayload {
    operations: Array<{
        id: string;
        type: OperationType;
        enabled: boolean;
        settings: Record<string, unknown>;
        vectors?: VectorPath[];
        rasters?: RasterTile[];
    }>;
    unassigned: string[];
}

export async function buildLaserJob(objects: SceneObject[], ops: CamOperation[]): Promise<LaserJobPayload> {
    const out: LaserJobPayload['operations'] = ops.filter(op => op.enabled).map(op => ({
        id: op.id, type: op.type, enabled: true, settings: { ...op.settings },
        vectors: op.type === 'raster' ? undefined : [],
        rasters: op.type === 'raster' ? [] : undefined,
    }));
    const unassigned: string[] = [];

    for (const o of objects) {
        if (o.type === 'gcode' || o.type === 'stl' || o.operationId === SKIP_OPERATION) continue;
        const op = resolveOperation(o, ops);
        const target = op && out.find(x => x.id === op.id);
        if (!target) { unassigned.push(o.name); continue; }
        if (target.type === 'raster') {
            const li = Number(target.settings.lineInterval) || 0.1;
            target.rasters!.push(await objectRaster(o, li));
        } else if (isVectorObject(o)) {
            target.vectors!.push(...objectVectors(o));
        } else {
            unassigned.push(o.name);
        }
    }

    return {
        operations: out.filter(op => (op.vectors?.length ?? 0) > 0 || (op.rasters?.length ?? 0) > 0),
        unassigned,
    };
}
