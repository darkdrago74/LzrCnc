/**
 * PathSelectorPanel.tsx
 *
 * Shows all DetectedPath objects returned by /cam/analyze-paths.
 * Lets the user select paths (single or multi) to assign milling operations.
 *
 * Selection rules:
 *   - Click → select only that path
 *   - Ctrl/Shift+Click → toggle path in multi-selection
 *   - "Select all closed" / "Select all open" buttons for quick workflow
 */

import React from 'react';
import { Circle, Square, Triangle, GitBranch, Waves, CheckSquare, Square as SquareIcon } from 'lucide-react';
import type { DetectedPath, PathClassification } from '../../types';

// ── Classification helpers ────────────────────────────────────────────────────

const classificationLabel: Record<PathClassification, string> = {
    circle:       'Circle',
    ellipse:      'Ellipse',
    rectangle:    'Rectangle',
    polygon:      'Polygon',
    closed_curve: 'Closed Curve',
    open_curve:   'Open Curve',
};

const classificationColor: Record<PathClassification, string> = {
    circle:       'text-cyan-400',
    ellipse:      'text-teal-400',
    rectangle:    'text-blue-400',
    polygon:      'text-indigo-400',
    closed_curve: 'text-violet-400',
    open_curve:   'text-amber-400',
};

function ClassificationIcon({ c }: { c: PathClassification }) {
    const cls = 'w-4 h-4 flex-shrink-0 ' + classificationColor[c];
    switch (c) {
        case 'circle':       return <Circle      className={cls} />;
        case 'ellipse':      return <Circle      className={cls + ' scale-x-75'} />;
        case 'rectangle':    return <Square      className={cls} />;
        case 'polygon':      return <Triangle    className={cls} />;
        case 'closed_curve': return <Waves       className={cls} />;
        case 'open_curve':   return <GitBranch   className={cls} />;
    }
}

function formatMm(v: number) {
    return v.toFixed(1) + ' mm';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PathSelectorPanelProps {
    paths: DetectedPath[];
    selectedIds: string[];
    onSelectionChange: (ids: string[]) => void;
    loading?: boolean;
}

export const PathSelectorPanel: React.FC<PathSelectorPanelProps> = ({
    paths,
    selectedIds,
    onSelectionChange,
    loading = false,
}) => {
    const closedPaths = paths.filter(p => p.closed);
    const openPaths   = paths.filter(p => !p.closed);

    const toggle = (id: string, multi: boolean) => {
        if (multi) {
            onSelectionChange(
                selectedIds.includes(id)
                    ? selectedIds.filter(x => x !== id)
                    : [...selectedIds, id]
            );
        } else {
            onSelectionChange(selectedIds.length === 1 && selectedIds[0] === id ? [] : [id]);
        }
    };

    const selectAllClosed = () => onSelectionChange(closedPaths.map(p => p.id));
    const selectAllOpen   = () => onSelectionChange(openPaths.map(p => p.id));
    const selectAll       = () => onSelectionChange(paths.map(p => p.id));
    const clearAll        = () => onSelectionChange([]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-24 text-gray-400 text-sm gap-2">
                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                Analyzing paths…
            </div>
        );
    }

    if (paths.length === 0) {
        return (
            <div className="text-gray-500 text-sm text-center py-4 italic">
                No paths detected. Upload a DXF or SVG file.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {/* Summary bar */}
            <div className="flex items-center justify-between text-xs text-gray-400 bg-white/5 rounded px-3 py-2">
                <span>
                    <span className="text-cyan-400 font-bold">{closedPaths.length}</span> closed &nbsp;·&nbsp;
                    <span className="text-amber-400 font-bold">{openPaths.length}</span> open
                </span>
                <span className="text-gray-500">
                    {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'None selected'}
                </span>
            </div>

            {/* Quick-select buttons */}
            <div className="flex flex-wrap gap-1 text-xs">
                <button onClick={selectAllClosed}
                    className="px-2 py-1 bg-cyan-900/40 hover:bg-cyan-800/60 border border-cyan-700/40 text-cyan-300 rounded transition-colors">
                    All closed
                </button>
                <button onClick={selectAllOpen}
                    className="px-2 py-1 bg-amber-900/40 hover:bg-amber-800/60 border border-amber-700/40 text-amber-300 rounded transition-colors">
                    All open
                </button>
                <button onClick={selectAll}
                    className="px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/10 text-gray-300 rounded transition-colors">
                    All
                </button>
                <button onClick={clearAll}
                    className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-500 rounded transition-colors">
                    None
                </button>
            </div>

            {/* Path list */}
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                {paths.map(path => {
                    const isSelected = selectedIds.includes(path.id);
                    return (
                        <button
                            key={path.id}
                            onClick={(e) => toggle(path.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                            className={`
                                flex items-center gap-2 px-3 py-2 rounded text-left text-xs transition-all
                                border
                                ${isSelected
                                    ? 'bg-white/10 border-white/30 text-white shadow-[0_0_8px_rgba(255,255,255,0.1)]'
                                    : 'bg-white/3 border-transparent hover:bg-white/7 text-gray-300'}
                            `}
                        >
                            {/* Selection checkbox */}
                            <span className="flex-shrink-0">
                                {isSelected
                                    ? <CheckSquare className="w-3.5 h-3.5 text-white" />
                                    : <SquareIcon  className="w-3.5 h-3.5 text-gray-600" />}
                            </span>

                            {/* Classification icon */}
                            <ClassificationIcon c={path.classification} />

                            {/* Label + dimensions */}
                            <span className="flex-1 min-w-0">
                                <span className={classificationColor[path.classification] + ' font-medium'}>
                                    {classificationLabel[path.classification]}
                                </span>
                                <span className="text-gray-500 ml-2">
                                    {formatMm(path.bounds.width)} × {formatMm(path.bounds.height)}
                                </span>
                            </span>

                            {/* Closed / Open badge */}
                            <span className={`
                                flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold
                                ${path.closed ? 'bg-cyan-900/60 text-cyan-300' : 'bg-amber-900/60 text-amber-300'}
                            `}>
                                {path.closed ? 'CLOSED' : 'OPEN'}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
