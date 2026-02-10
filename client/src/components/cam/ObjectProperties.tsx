import React, { useState, useEffect } from 'react';
import type { SceneObject } from '../../types';
import { HelpIcon } from '../ui/Tooltip';

interface ObjectPropertiesProps {
    object: SceneObject;
    onUpdate: (id: string, updates: Partial<SceneObject>) => void;
}

// Helper Component to handle "1." typing issue
const SmartInput: React.FC<{ value: number; onChange: (val: number) => void; className?: string; step?: string }> = ({ value, onChange, className, step = "0.1" }) => {
    const [localVal, setLocalVal] = useState(value.toString());

    useEffect(() => {
        // Sync with prop if it changes externally and doesn't match local (ignoring formatting diffs like "1." vs "1")
        // We use a small epsilon or just direct comparison if not focused? 
        // Simple heuristic: If prop changes significantly from parsed local, update local.
        if (Math.abs(parseFloat(localVal) - value) > 0.0001) {
            setLocalVal(value.toString());
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setLocalVal(v);
        const parsed = parseFloat(v);
        if (!isNaN(parsed)) {
            onChange(parsed);
        }
    };

    return <input type="number" step={step} value={localVal} onChange={handleChange} className={className} />;
};

export const ObjectProperties: React.FC<ObjectPropertiesProps> = ({ object, onUpdate }) => {

    const updatePosition = (axis: 0 | 1, value: number) => {
        const newPos = [...object.position] as [number, number, number];
        newPos[axis] = value;
        onUpdate(object.id, { position: newPos });
    };

    const updateScale = (axis: 0 | 1, value: number) => {
        const newScale = [...object.scale] as [number, number, number];
        newScale[axis] = value;
        onUpdate(object.id, { scale: newScale });
    };

    const updateRotation = (value: number) => {
        const rad = value * (Math.PI / 180);
        const newRot = [...object.rotation] as [number, number, number];
        newRot[2] = rad;
        onUpdate(object.id, { rotation: newRot });
    };

    const currentRotationDeg = (object.rotation[2] * (180 / Math.PI));

    return (
        <div className="bg-black/30 p-3 rounded border border-white/5 mb-4">
            <h4 className="text-gray-400 text-[10px] uppercase font-bold mb-2 flex items-center gap-2">
                <span>Selected: {object.name}</span>
            </h4>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {/* Position X */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-500 text-[10px] uppercase">Pos X (mm)</label>
                    </div>
                    <SmartInput
                        value={object.position[0]}
                        onChange={(v) => updatePosition(0, v)}
                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                    />
                </div>

                {/* Position Y */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-500 text-[10px] uppercase">Pos Y (mm)</label>
                    </div>
                    <SmartInput
                        value={object.position[1]}
                        onChange={(v) => updatePosition(1, v)}
                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                    />
                </div>

                {/* Scale X */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-500 text-[10px] uppercase">Scale X</label>
                        <HelpIcon text="Horizontal scaling factor (1 = 100%)" />
                    </div>
                    <SmartInput
                        value={object.scale[0]}
                        onChange={(v) => updateScale(0, v)}
                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                    />
                </div>

                {/* Scale Y */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-500 text-[10px] uppercase">Scale Y</label>
                        <HelpIcon text="Vertical scaling factor (1 = 100%)" />
                    </div>
                    <SmartInput
                        value={object.scale[1]}
                        onChange={(v) => updateScale(1, v)}
                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                    />
                </div>

                {/* Rotation */}
                <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-500 text-[10px] uppercase">Rotation (°)</label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min="-180"
                            max="180"
                            value={currentRotationDeg}
                            onChange={(e) => updateRotation(Number(e.target.value))}
                            className="flex-1"
                        />
                        <SmartInput
                            value={currentRotationDeg}
                            onChange={(v) => updateRotation(v)}
                            className="w-16 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white text-right"
                            step="1"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
