import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ParametricConfig, SceneObject } from '../../types';
import type { ShapeKind } from './DesignerToolbar';
import { ShapeParamsEditor } from './ShapeParamsEditor';
import { DEFAULT_SHAPES, SHAPE_TITLES, buildShape, shapeSize } from '../../utils/shapes';

export interface DrawnObject {
    type: SceneObject['type'];
    name: string;
    content: string;
    size: [number, number];
    svgUnitsMm?: boolean;
    parametric: ParametricConfig;
}

interface DrawingModalProps {
    isOpen: boolean;
    kind: ShapeKind;
    onClose: () => void;
    onCreate: (obj: DrawnObject) => void;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Adds the (non-output) construction circle and centre mark to a shape SVG, for the preview only. */
export function withConstruction(svg: string, p: ParametricConfig): string {
    const [w, h] = shapeSize(p);
    const s = Math.max(w, h) / 100;
    const sw = s * 0.8;
    let extra = `<path d="M${w / 2 - 4 * s} ${h / 2}H${w / 2 + 4 * s}M${w / 2} ${h / 2 - 4 * s}V${h / 2 + 4 * s}" stroke="#0891b2" stroke-width="${sw}" fill="none"/>`;
    if (p.shape === 'polygon' || p.shape === 'star') {
        extra = `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - sw / 2}" fill="none" stroke="#0891b2" stroke-width="${sw}" stroke-dasharray="${s * 4} ${s * 3}"/>` + extra;
    }
    return svg.replace(/<\/svg>\s*$/, `${extra}</svg>`);
}

export const DrawingModal: React.FC<DrawingModalProps> = ({ isOpen, kind, onClose, onCreate }) => {
    // Remember the last parameters per shape kind for the session.
    const [params, setParams] = useState<Record<ShapeKind, ParametricConfig>>(DEFAULT_SHAPES);
    const p = params[kind];
    const setP = (np: ParametricConfig) => setParams(all => ({ ...all, [kind]: np }));

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const built = useMemo(() => (isOpen ? buildShape(p) : null), [isOpen, p]);

    if (!isOpen) return null;

    const previewUrl = built
        ? built.type === 'image' ? built.content : `data:image/svg+xml;utf8,${encodeURIComponent(withConstruction(built.content, p))}`
        : null;

    const create = () => {
        if (!built) return;
        onCreate({ ...built, parametric: p });
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onClose}>
            <div className="glass-panel w-full max-w-xl p-5 bg-slate-900/95" onMouseDown={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Add {SHAPE_TITLES[kind]}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-[1fr_200px] gap-4">
                    <ShapeParamsEditor value={p} onChange={setP} />

                    <div className="flex flex-col items-center justify-center bg-slate-100 rounded-lg p-3 min-h-[200px]">
                        {previewUrl ? <img src={previewUrl} alt="preview" className="w-full h-[160px] object-contain" /> : <span className="text-slate-400 text-xs">Nothing to preview</span>}
                        {built && <div className="text-[10px] text-slate-600 font-mono mt-2">{fmt(built.size[0])} × {fmt(built.size[1])} mm</div>}
                        {(kind === 'polygon' || kind === 'star') && <div className="text-[10px] text-cyan-700 mt-1 text-center">Dashed: construction circle (not cut). The object is placed by its centre.</div>}
                    </div>
                </div>

                <div className="flex justify-between items-center mt-5">
                    <span className="text-[10px] text-gray-500">The shape stays editable in its properties after it is placed.</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                        <button onClick={create} disabled={!built} className="btn-primary text-sm">Add to bed</button>
                    </div>
                </div>
            </div>
        </div>,
        // Portal: the side panel uses backdrop-blur, which would otherwise confine a fixed overlay to the panel
        document.body
    );
};
