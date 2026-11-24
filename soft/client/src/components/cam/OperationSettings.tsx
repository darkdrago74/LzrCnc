import React, { useEffect, useRef, useState } from 'react';
import type { CamOperation } from './interfaces';
import type { SceneObject } from '../../types';
import { HelpIcon } from '../ui/Tooltip';
import { OP_COLORS, OP_TYPE_LABEL, objectBaseSize, objectRaster } from '../../utils/laserJob';
import { burnMap, rgbaToGray, type RasterSettings } from '../../utils/rasterPreview';

interface Props {
    operation: CamOperation;
    onChange: (op: CamOperation) => void;
    /** Objects currently routed to this operation */
    assignedCount?: number;
    /** Objects that can be assigned (laser-able), with whether they currently use this operation */
    objects?: { obj: SceneObject; assigned: boolean; otherOp?: CamOperation }[];
    onAssign?: (objectId: string, assign: boolean) => void;
}

const field = 'w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white font-mono focus:border-cyan-500/60 focus:outline-none';
const lbl = 'text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1 flex items-center gap-1';

const PREVIEW_MAX_PX = 360;

/** Shows what the raster operation will burn for one object (same maths as the G-code generator). */
const RasterBurnPreview: React.FC<{ object: SceneObject; settings: RasterSettings & { lineInterval?: number } }> = ({ object, settings }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [src, setSrc] = useState<{ gray: Uint8ClampedArray; w: number; h: number; interval: number } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const li = settings.lineInterval ?? 0.1;

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [bw, bh] = await objectBaseSize(object);
                const maxMm = Math.max(bw * Math.abs(object.scale[0]), bh * Math.abs(object.scale[1]));
                const interval = Math.max(li, maxMm / PREVIEW_MAX_PX);
                const tile = await objectRaster(object, interval);
                const img = new Image();
                await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('preview')); img.src = tile.dataUrl; });
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                const ctx = c.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                const gray = rgbaToGray(ctx.getImageData(0, 0, c.width, c.height).data);
                if (alive) { setSrc({ gray, w: c.width, h: c.height, interval }); setErr(null); }
            } catch (e) {
                if (alive) setErr((e as Error).message);
            }
        })();
        return () => { alive = false; };
    }, [object.content, object.size, object.scale, object.rotation, object.svgUnitsMm, li]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const cv = canvasRef.current;
        if (!cv || !src) return;
        cv.width = src.w; cv.height = src.h;
        const ctx = cv.getContext('2d')!;
        const burn = burnMap(src.gray, src.w, src.h, settings);
        const out = ctx.createImageData(src.w, src.h);
        for (let i = 0; i < burn.length; i++) {
            // Burn shown as dark wood-brown on a light background
            const k = burn[i];
            out.data[i * 4] = 245 - k * 200; out.data[i * 4 + 1] = 232 - k * 200; out.data[i * 4 + 2] = 210 - k * 190; out.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
    }, [src, settings]);

    if (err) return <div className="text-[10px] text-red-400">{err}</div>;
    return (
        <div>
            <canvas ref={canvasRef} className="w-full max-h-48 object-contain rounded border border-white/10 bg-[#f5e8d2]" style={{ imageRendering: 'pixelated' }} />
            {src && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                    Burn preview of "{object.name}"{src.interval > li + 1e-9 ? ` (shown at ${src.interval.toFixed(2)} mm/px; job uses ${li} mm)` : ` at ${li} mm/px`}
                </div>
            )}
        </div>
    );
};

export const OperationSettings: React.FC<Props> = ({ operation, onChange, assignedCount, objects, onAssign }) => {
    const s = operation.settings;
    const set = (key: string, value: unknown) => onChange({ ...operation, settings: { ...s, [key]: value } });
    const num = (key: string, fallback: number) => (s[key] ?? fallback) as number;
    const isRaster = operation.type === 'raster';
    const previewObj = isRaster ? objects?.find(o => o.assigned)?.obj : undefined;

    return (
        <div className="space-y-3 text-white">
            <div className="flex items-center gap-2">
                <input type="color" value={operation.color ?? OP_COLORS[0]} onChange={e => onChange({ ...operation, color: e.target.value })}
                    className="w-7 h-7 rounded bg-transparent border border-white/10 cursor-pointer shrink-0" title="Profile colour (tags the objects that use it)" />
                <input className={`${field} font-sans`} value={operation.name ?? ''} placeholder={OP_TYPE_LABEL[operation.type]}
                    onChange={e => onChange({ ...operation, name: e.target.value })} title="Profile name, e.g. 'Cut 3 mm plywood'" />
                <span className="text-[10px] text-gray-500 whitespace-nowrap">{OP_TYPE_LABEL[operation.type]}</span>
            </div>

            {assignedCount !== undefined && (
                <div className="text-[11px] text-gray-500">
                    {assignedCount === 0 ? 'No objects use this operation yet.' : `${assignedCount} object${assignedCount > 1 ? 's' : ''} assigned.`}
                </div>
            )}

            {objects && objects.length > 0 && onAssign && (
                <div>
                    <label className={lbl}>Objects using this profile <HelpIcon text="Tick objects to route them to this profile. Unticking an object sets it to 'None – don't burn'; choose another profile in its properties." /></label>
                    <div className="max-h-28 overflow-y-auto bg-black/30 rounded border border-white/5 p-1 space-y-0.5">
                        {objects.map(({ obj, assigned, otherOp }) => (
                            <label key={obj.id} className="flex items-center gap-2 text-xs px-1 py-0.5 rounded hover:bg-white/5 cursor-pointer">
                                <input type="checkbox" checked={assigned} onChange={e => onAssign(obj.id, e.target.checked)} />
                                <span className="truncate flex-1">{obj.name}</span>
                                {!assigned && (
                                    <span className="text-[10px] text-gray-500 flex items-center gap-1 shrink-0">
                                        {otherOp ? <><span className="w-2 h-2 rounded-sm" style={{ background: otherOp.color }} />{otherOp.name ?? OP_TYPE_LABEL[otherOp.type]}</> : 'skipped'}
                                    </span>
                                )}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <label className={lbl}>{isRaster ? 'Max power' : 'Power'} <span className="ml-auto font-mono text-cyan-300 normal-case">{num('power', 100)}%</span></label>
                <input type="range" min={0} max={100} value={num('power', 100)} onChange={e => set('power', Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {isRaster && (
                <div>
                    <label className={lbl}>Min power <HelpIcon text="Power used for the lightest grey (grayscale mode)." /><span className="ml-auto font-mono text-cyan-300 normal-case">{num('minPower', 0)}%</span></label>
                    <input type="range" min={0} max={100} value={num('minPower', 0)} onChange={e => set('minPower', Number(e.target.value))} className="w-full accent-cyan-500" />
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={lbl}>Speed (mm/min)</label>
                    <input type="number" min={1} value={num('speed', 1000)} onChange={e => set('speed', Math.max(1, Number(e.target.value) || 1))} className={field} />
                </div>
                <div>
                    <label className={lbl}>Passes</label>
                    <input type="number" min={1} max={50} value={num('passes', 1)} onChange={e => set('passes', Math.max(1, Math.round(Number(e.target.value) || 1)))} className={field} />
                </div>
            </div>

            {isRaster && (
                <>
                    <div>
                        <label className={lbl}>Mode</label>
                        <div className="grid grid-cols-3 gap-1">
                            {(['grayscale', 'dither', 'threshold'] as const).map(m => (
                                <button key={m} onClick={() => set('mode', m)}
                                    className={`text-xs py-1.5 rounded border capitalize ${s.mode === m ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-100' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}>
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    {s.mode !== 'grayscale' && (
                        <div>
                            <label className={lbl}>Threshold <HelpIcon text="Pixels darker than this are burned (threshold) or used as the dithering mid-point." /><span className="ml-auto font-mono text-cyan-300 normal-case">{num('threshold', 128)}</span></label>
                            <input type="range" min={0} max={255} value={num('threshold', 128)} onChange={e => set('threshold', Number(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={lbl}>Line interval <HelpIcon text="Distance between scan lines in mm (0.1 mm = 254 DPI)." /></label>
                            <input type="number" step={0.01} min={0.02} max={2} value={num('lineInterval', 0.1)} onChange={e => set('lineInterval', Math.max(0.02, Number(e.target.value) || 0.1))} className={field} />
                            <div className="text-[10px] text-gray-500 mt-0.5">{Math.round(25.4 / num('lineInterval', 0.1))} DPI</div>
                        </div>
                        <div>
                            <label className={lbl}>Overscan (mm) <HelpIcon text="Extra travel at the end of each line so the head reaches full speed before burning." /></label>
                            <input type="number" step={0.5} min={0} value={num('overscan', 3)} onChange={e => set('overscan', Math.max(0, Number(e.target.value) || 0))} className={field} />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input type="checkbox" checked={!!s.invert} onChange={e => set('invert', e.target.checked)} /> Invert image (burn light areas)
                    </label>

                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className={lbl}>Bright. <span className="ml-auto font-mono text-cyan-300 normal-case">{num('brightness', 0)}</span></label>
                            <input type="range" min={-100} max={100} value={num('brightness', 0)} onChange={e => set('brightness', Number(e.target.value))} className="w-full accent-cyan-500" title="Positive = lighter = less burn" />
                        </div>
                        <div>
                            <label className={lbl}>Contrast <span className="ml-auto font-mono text-cyan-300 normal-case">{num('contrast', 0)}</span></label>
                            <input type="range" min={-100} max={100} value={num('contrast', 0)} onChange={e => set('contrast', Number(e.target.value))} className="w-full accent-cyan-500" />
                        </div>
                        <div>
                            <label className={lbl}>Gamma <span className="ml-auto font-mono text-cyan-300 normal-case">{num('gamma', 1).toFixed(2)}</span></label>
                            <input type="range" min={0.2} max={3} step={0.05} value={num('gamma', 1)} onChange={e => set('gamma', Number(e.target.value))} className="w-full accent-cyan-500" title="> 1 lightens mid-tones (wood burns dark quickly)" />
                        </div>
                    </div>
                    {(num('brightness', 0) !== 0 || num('contrast', 0) !== 0 || num('gamma', 1) !== 1) && (
                        <button onClick={() => onChange({ ...operation, settings: { ...s, brightness: 0, contrast: 0, gamma: 1 } })} className="text-[10px] text-cyan-400 hover:underline">Reset tone</button>
                    )}

                    {previewObj
                        ? <RasterBurnPreview object={previewObj} settings={s as RasterSettings & { lineInterval?: number }} />
                        : <div className="text-[10px] text-gray-500">Assign an image, text or filled shape to see a burn preview.</div>}
                </>
            )}
        </div>
    );
};
