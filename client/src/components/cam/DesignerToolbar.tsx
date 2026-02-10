import React, { useState } from 'react';
import { Square, Circle, Type, Move, RotateCcw } from 'lucide-react';
import type { SceneObject } from '../../types';

interface DesignerToolbarProps {
    onAddRect: () => void;
    onAddCircle: () => void;
    onAddText: (text: string) => void;
}

export const DesignerToolbar: React.FC<DesignerToolbarProps> = ({ onAddRect, onAddCircle, onAddText }) => {
    const [textInput, setTextInput] = useState("Text");
    const [showText, setShowText] = useState(false);

    return (
        <div className="flex gap-2 bg-white/5 p-2 rounded mb-2">
            <button onClick={onAddRect} className="p-2 hover:bg-white/10 rounded" title="Add Square">
                <Square size={20} className="text-orange-400" />
            </button>
            <button onClick={onAddCircle} className="p-2 hover:bg-white/10 rounded" title="Add Circle">
                <Circle size={20} className="text-orange-400" />
            </button>
            <div className="relative">
                <button onClick={() => setShowText(!showText)} className="p-2 hover:bg-white/10 rounded" title="Add Text">
                    <Type size={20} className="text-orange-400" />
                </button>
                {showText && (
                    <div className="absolute top-full left-0 bg-gray-900 border border-gray-700 p-2 rounded z-20 flex gap-1">
                        <input className="bg-black text-white text-xs p-1 w-24" value={textInput} onChange={e => setTextInput(e.target.value)} />
                        <button onClick={() => { onAddText(textInput); setShowText(false); }} className="px-2 bg-blue-600 rounded text-xs">Add</button>
                    </div>
                )}
            </div>
            <div className="border-l border-gray-700 mx-1" />
            <div className="flex items-center text-xs text-gray-500 px-2 italic">
                <Move size={14} className="mr-1" /> Drag to Move
                <RotateCcw size={14} className="ml-2 mr-1" /> R to Rotate
            </div>
        </div>
    );
};
