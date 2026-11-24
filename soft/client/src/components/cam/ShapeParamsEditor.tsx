import React from 'react';
import type { ParametricConfig } from '../../types';
import { NUT_PRESETS, polygonAcrossFlats, polygonCircleDiameter } from '../../utils/shapes';

const input = 'w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:border-cyan-500/60 focus:outline-none';
const lbl = 'text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1 block';
const FONTS = ['Arial', 'Arial Black', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS', 'Consolas'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const Num: React.FC<{ label: string; value: number | undefined; onChange: (v: number) => void; min?: number; max?: number; step?: number; title?: string }> = ({ label, value, onChange, min = 0, max, step = 0.1, title }) => (
    <div title={title}>
        <label className={lbl}>{label}</label>
        <input type="number" step={step} min={min} max={max} className={input} value={value ?? 0}
            onChange={e => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                onChange(Math.min(max ?? Infinity, Math.max(min, v)));
            }} />
    </div>
);

/** Editor for the parameters of a drawn shape (used by the drawing dialog and the object properties). */
export const ShapeParamsEditor: React.FC<{ value: ParametricConfig; onChange: (p: ParametricConfig) => void }> = ({ value: p, onChange }) => {
    const set = (patch: Partial<ParametricConfig>) => onChange({ ...p, ...patch });
    const isPoly = p.shape === 'polygon' || p.shape === 'star';
    const isCircle = p.shape === 'ellipse' && Math.abs((p.width ?? 0) - (p.height ?? 0)) < 1e-9;

    if (p.shape === 'text') {
        return (
            <div className="space-y-2">
                <div>
                    <label className={lbl}>Text</label>
                    <textarea className={`${input} font-sans h-16`} value={p.text ?? ''} onChange={e => set({ text: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Num label="Font size (mm)" value={p.textHeight} min={0.5} step={0.5} onChange={v => set({ textHeight: v })} title="Em height of the font; capital letters are ~70 % of it." />
                    <div>
                        <label className={lbl}>Font</label>
                        <select className={input} value={p.font} onChange={e => set({ font: e.target.value })}>
                            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={!!p.bold} onChange={e => set({ bold: e.target.checked })} /> Bold</label>
                <div>
                    <label className={lbl}>Output</label>
                    <div className="grid grid-cols-2 gap-1">
                        {(['raster', 'vector'] as const).map(m => (
                            <button key={m} onClick={() => set({ textMode: m })}
                                className={`text-xs py-1 rounded border ${(p.textMode ?? 'raster') === m ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-100' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}>
                                {m === 'raster' ? 'Raster (image)' : 'Vector outline'}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                        {p.textMode === 'vector'
                            ? 'Letters are traced into closed outlines: cut or line-engrave them, or raster-fill them. Inner holes (o, e, a…) are kept.'
                            : 'Letters are an image: engrave with a Raster operation (best for small text).'}
                    </p>
                </div>
                {p.textMode === 'vector' && (
                    <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={!!p.fill} onChange={e => set({ fill: e.target.checked })} /> Filled (shown solid, for raster fill)</label>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {p.shape === 'polygon' && (
                <div>
                    <label className={lbl}>Hex nut preset (across flats)</label>
                    <select className={input} value=""
                        onChange={e => {
                            const n = NUT_PRESETS.find(x => x.label === e.target.value);
                            if (n) set({ sides: 6, sizeBy: 'flats', diameter: n.flats, angle: 0 });
                        }}>
                        <option value="">Choose a nut size…</option>
                        {NUT_PRESETS.map(n => <option key={n.label} value={n.label}>{n.label} — {n.flats} mm A/F</option>)}
                    </select>
                </div>
            )}

            {isPoly && (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        <Num label={p.shape === 'star' ? 'Points' : 'Sides'} value={p.sides} min={3} max={64} step={1} onChange={v => set({ sides: Math.round(v) })} />
                        <Num label="Rotation (°)" value={p.angle} min={-360} max={360} step={1} onChange={v => set({ angle: v })} />
                    </div>
                    {p.shape === 'polygon' && (
                        <div className="grid grid-cols-2 gap-1">
                            {(['circle', 'flats'] as const).map(m => (
                                <button key={m}
                                    onClick={() => {
                                        if ((p.sizeBy ?? 'circle') === m) return;
                                        // Keep the same physical size when switching how it is measured.
                                        set({ sizeBy: m, diameter: r3(m === 'flats' ? polygonAcrossFlats(p) : polygonCircleDiameter(p)) });
                                    }}
                                    className={`text-xs py-1 rounded border ${(p.sizeBy ?? 'circle') === m ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-100' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}>
                                    {m === 'circle' ? 'Circle Ø (corners)' : 'Across flats'}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        <Num label={p.shape === 'polygon' && p.sizeBy === 'flats' ? 'Across flats (mm)' : 'Construction Ø (mm)'} value={p.diameter} min={0.1} onChange={v => set({ diameter: v })} />
                        {p.shape === 'star'
                            ? <Num label="Inner radius %" value={p.innerRadius} min={5} max={95} step={1} onChange={v => set({ innerRadius: v })} />
                            : <Num label="Centre hole Ø (mm)" value={p.hole} min={0} onChange={v => set({ hole: v })} />}
                    </div>
                    {p.shape === 'polygon' && (
                        <div className="text-[10px] text-gray-500 font-mono">
                            corners on Ø{r3(polygonCircleDiameter(p))} · flats {r3(polygonAcrossFlats(p))} mm · side {r3(polygonCircleDiameter(p) * Math.sin(Math.PI / Math.max(3, p.sides ?? 6)))} mm
                        </div>
                    )}
                </>
            )}

            {p.shape === 'ellipse' && (
                <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input type="checkbox" checked={isCircle} onChange={e => set(e.target.checked ? { height: p.width } : { height: r3((p.width ?? 10) * 0.6) })} /> Circle (equal width and height)
                </label>
            )}
            {p.shape === 'ellipse' && isCircle ? (
                <div className="grid grid-cols-2 gap-2">
                    <Num label="Diameter (mm)" value={p.width} min={0.1} onChange={v => set({ width: v, height: v })} />
                    <Num label="Centre hole Ø (mm)" value={p.hole} min={0} onChange={v => set({ hole: v })} />
                </div>
            ) : !isPoly && (
                <div className="grid grid-cols-2 gap-2">
                    <Num label={p.shape === 'slot' ? 'Length (mm)' : 'Width (mm)'} value={p.width} min={0.1} onChange={v => set({ width: v })} />
                    <Num label={p.shape === 'slot' ? 'Slot width (mm)' : 'Height (mm)'} value={p.height} min={0.1} onChange={v => set({ height: v })} />
                </div>
            )}
            {p.shape === 'rect' && (
                <div className="grid grid-cols-2 gap-2">
                    <Num label="Corner radius (mm)" value={p.radius} min={0} onChange={v => set({ radius: v })} />
                    <Num label="Centre hole Ø (mm)" value={p.hole} min={0} onChange={v => set({ hole: v })} />
                </div>
            )}

            <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={!!p.fill} onChange={e => set({ fill: e.target.checked })} /> Filled (engrave the area with a Raster operation)</label>
        </div>
    );
};
