/**
 * MillingOperationEditor.tsx
 *
 * Form to configure a milling operation for the currently selected paths.
 * Emits an onAdd callback with all form values when "Add to Queue" is clicked.
 *
 * Defaults are reasonable starting points for a 6mm endmill on wood/MDF:
 *   feedrate 800 mm/min · plunge 200 mm/min · spindle 12 000 RPM
 */

import React, { useState } from 'react';
import type { CutSide } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OperationFormValues {
    cutSide: CutSide;
    toolDiameter: number;
    depth: number;
    depthPerPass: number;
    feedrate: number;
    plungeRate: number;
    spindleSpeed: number;
    safeZ: number;
}

interface MillingOperationEditorProps {
    selectedPathIds: string[];
    onAdd: (values: OperationFormValues) => void;
}

// ── Small reusable number field ───────────────────────────────────────────────

const NumField: React.FC<{
    label: string;
    unit: string;
    value: number;
    onChange: (v: number) => void;
    step?: number;
    min?: number;
    hint?: string;
}> = ({ label, unit, value, onChange, step = 1, min = 0, hint }) => (
    <div>
        <label className="text-gray-500 text-[10px] uppercase font-bold mb-1 block">{label}</label>
        <div className="relative">
            <input
                type="number"
                value={value}
                step={step}
                min={min}
                onChange={e => onChange(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/50 border border-white/10 rounded px-2 py-1.5 text-white text-xs font-mono focus:border-emerald-500/50 focus:outline-none pr-14"
            />
            <span className="absolute right-2 top-1.5 text-gray-600 text-[10px] pointer-events-none">{unit}</span>
        </div>
        {hint && <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>}
    </div>
);

// ── Editor component ──────────────────────────────────────────────────────────

export const MillingOperationEditor: React.FC<MillingOperationEditorProps> = ({
    selectedPathIds,
    onAdd,
}) => {
    const [form, setForm] = useState<OperationFormValues>({
        cutSide:      'inside',
        toolDiameter: 6,
        depth:        5,
        depthPerPass: 1,
        feedrate:     800,
        plungeRate:   200,
        spindleSpeed: 12000,
        safeZ:        5,
    });

    const set = <K extends keyof OperationFormValues>(k: K, v: OperationFormValues[K]) =>
        setForm(prev => ({ ...prev, [k]: v }));

    const passCount = form.depthPerPass > 0
        ? Math.ceil(form.depth / form.depthPerPass)
        : 1;

    const canAdd = selectedPathIds.length > 0 && form.depth > 0 && form.toolDiameter > 0;

    const CUT_SIDES: { id: CutSide; label: string; desc: string }[] = [
        { id: 'inside',  label: 'Inside',   desc: 'Tool follows inside the contour' },
        { id: 'on',      label: 'On Line',  desc: 'Tool center follows the path' },
        { id: 'outside', label: 'Outside',  desc: 'Tool follows outside the contour' },
    ];

    return (
        <div className="space-y-3">
            {/* Selection info */}
            <p className="text-xs text-gray-400">
                Configuring for{' '}
                <span className="text-white font-bold">{selectedPathIds.length}</span>{' '}
                path{selectedPathIds.length !== 1 ? 's' : ''}
            </p>

            {/* Cut side */}
            <div>
                <label className="text-gray-500 text-[10px] uppercase font-bold mb-2 block">
                    Cut Side
                </label>
                <div className="flex gap-1">
                    {CUT_SIDES.map(({ id, label, desc }) => (
                        <button
                            key={id}
                            title={desc}
                            onClick={() => set('cutSide', id)}
                            className={`
                                flex-1 py-2 text-xs rounded border font-medium transition-all
                                ${form.cutSide === id
                                    ? 'bg-emerald-600/50 border-emerald-500/60 text-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}
                            `}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {form.cutSide !== 'on' && (
                    <p className="text-[10px] text-gray-600 mt-1">
                        Offset = {(form.toolDiameter / 2).toFixed(2)} mm ({form.toolDiameter}mm ÷ 2)
                    </p>
                )}
            </div>

            {/* Tool diameter */}
            <NumField
                label="Tool Diameter"
                unit="mm"
                value={form.toolDiameter}
                onChange={v => set('toolDiameter', v)}
                step={0.5}
                min={0.1}
            />

            {/* Depth */}
            <div className="grid grid-cols-2 gap-2">
                <NumField
                    label="Total Depth"
                    unit="mm"
                    value={form.depth}
                    onChange={v => set('depth', v)}
                    step={0.5}
                    min={0.1}
                />
                <NumField
                    label="Depth / Pass"
                    unit="mm"
                    value={form.depthPerPass}
                    onChange={v => set('depthPerPass', v)}
                    step={0.1}
                    min={0.1}
                    hint={`→ ${passCount} pass${passCount !== 1 ? 'es' : ''}`}
                />
            </div>

            {/* Feed rates */}
            <div className="grid grid-cols-2 gap-2">
                <NumField
                    label="Feedrate"
                    unit="mm/min"
                    value={form.feedrate}
                    onChange={v => set('feedrate', v)}
                    step={50}
                    min={1}
                />
                <NumField
                    label="Plunge Rate"
                    unit="mm/min"
                    value={form.plungeRate}
                    onChange={v => set('plungeRate', v)}
                    step={10}
                    min={1}
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <NumField
                    label="Spindle"
                    unit="RPM"
                    value={form.spindleSpeed}
                    onChange={v => set('spindleSpeed', v)}
                    step={1000}
                    min={0}
                />
                <NumField
                    label="Safe Z"
                    unit="mm"
                    value={form.safeZ}
                    onChange={v => set('safeZ', v)}
                    step={1}
                    min={0}
                />
            </div>

            {/* Add button */}
            <button
                onClick={() => canAdd && onAdd(form)}
                disabled={!canAdd}
                className={`
                    w-full py-2.5 rounded border text-sm font-bold transition-all
                    ${canAdd
                        ? 'bg-emerald-600/50 hover:bg-emerald-600/70 border-emerald-500/50 text-emerald-200'
                        : 'bg-white/5 border-white/10 text-gray-600 cursor-not-allowed'}
                `}
            >
                + Add to Queue
            </button>
        </div>
    );
};
