import React from 'react';
import { Square, Circle, Hexagon, Star, Type, Pill } from 'lucide-react';
import type { ShapeType } from '../../types';

export type ShapeKind = ShapeType;

interface DesignerToolbarProps {
    onOpenShape: (kind: ShapeKind) => void;
}

const TOOLS: { kind: ShapeKind; icon: typeof Square; label: string }[] = [
    { kind: 'rect', icon: Square, label: 'Rectangle' },
    { kind: 'ellipse', icon: Circle, label: 'Circle / ellipse' },
    { kind: 'slot', icon: Pill, label: 'Slot (obround)' },
    { kind: 'polygon', icon: Hexagon, label: 'Polygon / hex nut (on a construction circle)' },
    { kind: 'star', icon: Star, label: 'Star' },
    { kind: 'text', icon: Type, label: 'Text' },
];

export const DesignerToolbar: React.FC<DesignerToolbarProps> = ({ onOpenShape }) => (
    <div className="flex gap-1">
        {TOOLS.map(t => (
            <button
                key={t.kind}
                onClick={() => onOpenShape(t.kind)}
                className="p-2 rounded-md text-orange-300 hover:bg-white/10 hover:text-orange-200 transition-colors"
                title={`Add ${t.label}`}
            >
                <t.icon size={18} />
            </button>
        ))}
    </div>
);
