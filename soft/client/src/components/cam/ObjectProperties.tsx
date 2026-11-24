import React, { useState, useEffect } from 'react';
import { Lock, Unlock, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import type { ParametricConfig, SceneObject } from '../../types';
import type { CamOperation } from './interfaces';
import { OP_TYPE_LABEL, SKIP_OPERATION, objectBaseSize } from '../../utils/laserJob';
import { buildShape, shapeLabel, SHAPE_TITLES } from '../../utils/shapes';
import { ShapeParamsEditor } from './ShapeParamsEditor';

interface ObjectPropertiesProps {
    object: SceneObject;
    onUpdate: (id: string, updates: Partial<SceneObject>) => void;
    operations?: CamOperation[];
}

/** Number input that tolerates intermediate text like "1." or "-" while typing. */
const SmartInput: React.FC<{ value: number; onChange: (val: number) => void; className?: string; step?: string; digits?: number }> = ({ value, onChange, className, step = '0.1', digits = 2 }) => {
    const fmt = (v: number) => String(Math.round(v * 10 ** digits) / 10 ** digits);
    const [localVal, setLocalVal] = useState(fmt(value));

    useEffect(() => {
        if (!(Math.abs(parseFloat(localVal) - value) < 10 ** -digits)) setLocalVal(fmt(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <input
            type="number"
            step={step}
            value={localVal}
            onChange={e => {
                setLocalVal(e.target.value);
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed)) onChange(parsed);
            }}
            className={className}
        />
    );
};

const input = 'w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:border-cyan-500/60 focus:outline-none';
const lbl = 'text-gray-500 text-[10px] uppercase mb-1 block';

export const ObjectProperties: React.FC<ObjectPropertiesProps> = ({ object, onUpdate, operations }) => {
    const [base, setBase] = useState<[number, number] | null>(null);
    const [lockAspect, setLockAspect] = useState(true);
    const [shapeOpen, setShapeOpen] = useState(true);

    useEffect(() => {
        let alive = true;
        objectBaseSize(object).then(s => { if (alive) setBase(s); }).catch(() => setBase(null));
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [object.content, object.size, object.svgUnitsMm]);

    const width = base ? base[0] * object.scale[0] : 0;
    const height = base ? base[1] * object.scale[1] : 0;

    const setPos = (axis: 0 | 1, v: number) => {
        const p = [...object.position] as [number, number, number];
        p[axis] = v;
        onUpdate(object.id, { position: p });
    };

    const setSize = (axis: 0 | 1, mm: number) => {
        if (!base || mm <= 0) return;
        const k = mm / base[axis];
        const s = [...object.scale] as [number, number, number];
        if (lockAspect) {
            const ratio = k / s[axis];
            s[0] *= ratio;
            s[1] *= ratio;
        } else {
            s[axis] = k;
        }
        onUpdate(object.id, { scale: s });
    };

    const rotation = object.rotation[2] || 0;
    const setRotation = (deg: number) => onUpdate(object.id, { rotation: [0, 0, ((deg + 540) % 360) - 180] });

    const param = object.parametric;
    /** Geometry shapes are sized by their parameters; text and imported art by scaling. */
    const sizedByParams = !!param && param.shape !== 'text';

    const updateShape = (p: ParametricConfig) => {
        const built = buildShape(p);
        if (!built) return;
        const autoName = !param || object.name === shapeLabel(param);
        onUpdate(object.id, {
            parametric: p,
            type: built.type,
            content: built.content,
            size: built.size,
            svgUnitsMm: built.svgUnitsMm,
            // Parameters define the real size: drop any previous stretch (keep mirroring).
            scale: sizedByParams ? [Math.sign(object.scale[0]) || 1, Math.sign(object.scale[1]) || 1, 1] : object.scale,
            ...(autoName ? { name: built.name } : {}),
        });
    };

    const opValue = object.operationId ?? '';

    return (
        <div className="bg-black/30 p-3 rounded border border-white/5 space-y-3">
            <input className={`${input} font-sans font-semibold`} value={object.name} onChange={e => onUpdate(object.id, { name: e.target.value })} title="Object name" />

            {param && (
                <div className="border border-cyan-500/20 rounded bg-cyan-950/10">
                    <button onClick={() => setShapeOpen(o => !o)} className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-bold text-cyan-300">
                        {shapeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {SHAPE_TITLES[param.shape]} parameters
                    </button>
                    {shapeOpen && <div className="p-2 pt-0"><ShapeParamsEditor value={param} onChange={updateShape} /></div>}
                </div>
            )}

            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                    <label className={lbl}>Center X (mm)</label>
                    <SmartInput value={object.position[0]} onChange={v => setPos(0, v)} className={input} />
                </div>
                <div>
                    <label className={lbl}>Center Y (mm)</label>
                    <SmartInput value={object.position[1]} onChange={v => setPos(1, v)} className={input} />
                </div>
                {!sizedByParams && <>
                <div>
                    <label className={lbl}>Width (mm)</label>
                    <SmartInput value={width} onChange={v => setSize(0, v)} className={input} />
                </div>
                <div className="relative">
                    <label className={lbl}>Height (mm)</label>
                    <SmartInput value={height} onChange={v => setSize(1, v)} className={input} />
                    <button
                        onClick={() => setLockAspect(l => !l)}
                        className="absolute -left-3 top-6 text-gray-500 hover:text-cyan-300"
                        title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio free'}
                    >
                        {lockAspect ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                </div>
                </>}
            </div>

            <div>
                <label className={lbl}>Rotation (° counter-clockwise)</label>
                <div className="flex items-center gap-2">
                    <input type="range" min={-180} max={180} value={rotation} onChange={e => setRotation(Number(e.target.value))} className="flex-1 accent-cyan-500" />
                    <SmartInput value={rotation} onChange={setRotation} className={`${input} w-16 text-right`} step="1" digits={1} />
                    <button onClick={() => setRotation(rotation + 90)} className="text-gray-400 hover:text-white" title="Rotate 90°"><RotateCcw size={14} /></button>
                </div>
            </div>

            {operations && operations.length > 0 && (
                <div>
                    <label className={lbl}>Operation profile</label>
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                            style={{ background: opValue === SKIP_OPERATION ? 'transparent' : operations.find(o => o.id === opValue)?.color ?? '#6b7280' }} />
                        <select
                            className={input}
                            value={opValue}
                            onChange={e => onUpdate(object.id, { operationId: e.target.value || undefined })}
                        >
                            <option value="">Automatic (first matching)</option>
                            {operations.map((op, i) => (
                                <option key={op.id} value={op.id}>{i + 1}. {op.name ?? OP_TYPE_LABEL[op.type]} — {OP_TYPE_LABEL[op.type]} {op.settings.power}% / {op.settings.speed}{op.enabled ? '' : ' (disabled)'}</option>
                            ))}
                            <option value={SKIP_OPERATION}>None — don't burn (guide / reference)</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
};
