import React from 'react';
import type { CamOperation, OperationType } from './interfaces';

interface Props {
    operations: CamOperation[];
    onChange: (ops: CamOperation[]) => void;
    onSelect: (opId: string) => void;
    selectedId: string | null;
}

export const LaserOperationStack: React.FC<Props> = ({ operations, onChange, onSelect, selectedId }) => {

    const addOperation = (type: OperationType) => {
        const newOp: CamOperation = {
            id: Date.now().toString(),
            type,
            enabled: true,
            order: operations.length,
            settings: {
                power: 100,
                speed: 1000,
                passes: 1
            }
        };
        // Set defaults
        if (type === 'raster') {
            newOp.settings.mode = 'grayscale';
            newOp.settings.dither = false;
        }
        onChange([...operations, newOp]);
    };

    const removeOperation = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onChange(operations.filter(op => op.id !== id));
    };

    const toggleEnabled = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onChange(operations.map(op =>
            op.id === id ? { ...op, enabled: !op.enabled } : op
        ));
    };

    const moveOp = (e: React.MouseEvent, index: number, direction: -1 | 1) => {
        e.stopPropagation();
        if (index + direction < 0 || index + direction >= operations.length) return;

        const newOps = [...operations];
        const temp = newOps[index];
        newOps[index] = newOps[index + direction];
        newOps[index + direction] = temp;
        onChange(newOps);
    };

    return (
        <div className="bg-white/5 rounded p-4">
            <h3 className="text-lg font-bold mb-4 text-white">Operations</h3>

            <div className="flex gap-2 mb-4">
                <button onClick={() => addOperation('raster')} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm">
                    + Raster
                </button>
                <button onClick={() => addOperation('vector_cut')} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-sm">
                    + Cut
                </button>
                <button onClick={() => addOperation('vector_engrave')} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded text-sm">
                    + Vector
                </button>
            </div>

            <div className="space-y-2">
                {operations.map((op, idx) => (
                    <div
                        key={op.id}
                        onClick={() => onSelect(op.id)}
                        className={`p-3 rounded cursor-pointer border ${selectedId === op.id ? 'border-blue-500 bg-white/10' : 'border-transparent hover:bg-white/5'}`}
                    >
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={op.enabled}
                                    onChange={(e) => toggleEnabled(e as any, op.id)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="font-medium text-white capitalize">{op.type.replace('_', ' ')}</span>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={(e) => moveOp(e, idx, -1)} disabled={idx === 0} className="text-gray-400 hover:text-white px-1">↑</button>
                                <button onClick={(e) => moveOp(e, idx, 1)} disabled={idx === operations.length - 1} className="text-gray-400 hover:text-white px-1">↓</button>
                                <button onClick={(e) => removeOperation(e, op.id)} className="text-red-400 hover:text-red-300 ml-2">×</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
