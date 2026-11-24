import React from 'react';
import type { CamOperation, OperationType } from './interfaces';
import { OP_TYPE_LABEL, defaultOperation } from '../../utils/laserJob';

interface Props {
    operations: CamOperation[];
    onChange: (ops: CamOperation[]) => void;
    onSelect: (opId: string) => void;
    selectedId: string | null;
    /** Number of objects routed to each operation id */
    counts?: Record<string, number>;
}

export const LaserOperationStack: React.FC<Props> = ({ operations, onChange, onSelect, selectedId, counts }) => {

    const addOperation = (type: OperationType) => {
        const newOp: CamOperation = defaultOperation(type, operations.length);
        onChange([...operations, newOp]);
        onSelect(newOp.id);
    };

    const removeOperation = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onChange(operations.filter(op => op.id !== id));
    };

    const toggleEnabled = (id: string) => {
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
                        <div className="grid grid-cols-3 gap-2 mb-4">
                <button
                    onClick={() => addOperation('raster')}
                    className="flex flex-col items-center justify-center p-3 bg-gradient-to-br from-blue-900/30 to-blue-800/30 hover:from-blue-800/50 hover:to-blue-700/50 border border-blue-500/20 rounded-lg transition-all text-blue-200 hover:text-blue-100 group shadow-lg"
                    title="Add Raster/Engrave Layer"
                >
                    <span className="text-xl mb-1 opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform">▒</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider">Raster</span>
                </button>

                <button
                    onClick={() => addOperation('vector_cut')}
                    className="flex flex-col items-center justify-center p-3 bg-gradient-to-br from-red-900/30 to-red-800/30 hover:from-red-800/50 hover:to-red-700/50 border border-red-500/20 rounded-lg transition-all text-red-200 hover:text-red-100 group shadow-lg"
                    title="Add Cut Layer"
                >
                    <span className="text-xl mb-1 opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform">✂️</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider">Cut</span>
                </button>

                <button
                    onClick={() => addOperation('vector_engrave')}
                    className="flex flex-col items-center justify-center p-3 bg-gradient-to-br from-green-900/30 to-green-800/30 hover:from-green-800/50 hover:to-green-700/50 border border-green-500/20 rounded-lg transition-all text-green-200 hover:text-green-100 group shadow-lg"
                    title="Add Vector Path Layer"
                >
                    <span className="text-xl mb-1 opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform">✏️</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider">Vector</span>
                </button>
            </div>

            <div className="space-y-2">
                {operations.map((op, idx) => (
                    <div
                        key={op.id}
                        onClick={() => onSelect(op.id)}
                        className={`p-3 rounded cursor-pointer border ${selectedId === op.id ? 'border-blue-500 bg-white/10' : 'border-transparent hover:bg-white/5'}`}
                    >
                        <div className="flex justify-between items-center gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <input
                                    type="checkbox"
                                    checked={op.enabled}
                                    onChange={() => toggleEnabled(op.id)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: op.color ?? '#6b7280' }} />
                                <div className="min-w-0">
                                    <div className="font-medium text-white truncate">{op.name || OP_TYPE_LABEL[op.type]}</div>
                                    <div className="text-[10px] text-gray-500 font-mono truncate">
                                        {OP_TYPE_LABEL[op.type]} · {op.settings.power}% · {op.settings.speed} mm/min{op.settings.passes > 1 ? ` · ×${op.settings.passes}` : ''}
                                        {counts && ` · ${counts[op.id] ?? 0} obj`}
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
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
