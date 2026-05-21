import React, { useState, useEffect } from 'react';
import { Trash2, Plus, Save } from 'lucide-react';

interface Material {
    id: string;
    name: string;
    type: 'cut' | 'engrave' | 'raster';
    thickness: number; // mm
    speed: number;
    power: number;
    passes: number;
}

interface MaterialsPanelProps {
    onSelect?: (mat: Material) => void;
}

const MaterialsPanel: React.FC<MaterialsPanelProps> = ({ onSelect }) => {
    const [materials, setMaterials] = useState<Material[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editMat, setEditMat] = useState<Partial<Material>>({
        name: 'New Material',
        type: 'cut',
        thickness: 3,
        speed: 1000,
        power: 100,
        passes: 1
    });

    const fetchMaterials = async () => {
        try {
            const res = await fetch('http://localhost:3000/materials');
            const data = await res.json();
            setMaterials(data);
        } catch {
            console.error('Failed to load materials');
        }
    };

    useEffect(() => {
        // eslint-disable-next-line
        void fetchMaterials();
    }, []);

    const handleSave = async () => {
        try {
            await fetch('http://localhost:3000/materials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editMat)
            });
            setIsEditing(false);
            void fetchMaterials();
        } catch {
            alert('Failed to save');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete material?')) return;
        try {
            await fetch(`http://localhost:3000/materials/${id}`, { method: 'DELETE' });
            void fetchMaterials();
        } catch {
            alert('Failed to delete');
        }
    };

    return (
        <div className="bg-black/30 p-4 rounded border border-white/10 text-sm">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-300">Materials Library</h3>
                <button
                    onClick={() => setIsEditing(true)}
                    className="p-1 hover:bg-white/10 rounded"
                >
                    <Plus size={16} />
                </button>
            </div>

            {isEditing && (
                <div className="bg-black/50 p-3 rounded mb-4 space-y-2 border border-blue-500/30">
                    <input
                        className="w-full bg-black border border-gray-700 rounded p-1 text-white"
                        placeholder="Material Name"
                        value={editMat.name}
                        onChange={e => setEditMat({ ...editMat, name: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <select
                            className="bg-black border border-gray-700 rounded p-1 text-white"
                            value={editMat.type}
                            onChange={e => setEditMat({ ...editMat, type: e.target.value as 'cut' | 'engrave' | 'raster' })}
                        >
                            <option value="cut">Cut</option>
                            <option value="engrave">Engrave</option>
                        </select>
                        <input
                            type="number"
                            className="bg-black border border-gray-700 rounded p-1 text-white"
                            placeholder="Thickness (mm)"
                            title="Thickness (mm)"
                            value={editMat.thickness}
                            onChange={e => setEditMat({ ...editMat, thickness: Number(e.target.value) })}
                        />
                        <input
                            type="number"
                            className="bg-black border border-gray-700 rounded p-1 text-white"
                            placeholder="Speed"
                            title="Speed (mm/min)"
                            value={editMat.speed}
                            onChange={e => setEditMat({ ...editMat, speed: Number(e.target.value) })}
                        />
                        <input
                            type="number"
                            className="bg-black border border-gray-700 rounded p-1 text-white"
                            placeholder="Power %"
                            title="Power %"
                            value={editMat.power}
                            onChange={e => setEditMat({ ...editMat, power: Number(e.target.value) })}
                        />
                        <input
                            type="number"
                            className="bg-black border border-gray-700 rounded p-1 text-white"
                            placeholder="Passes"
                            title="Passes"
                            value={editMat.passes}
                            onChange={e => setEditMat({ ...editMat, passes: Number(e.target.value) })}
                        />
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setIsEditing(false)} className="text-gray-400">Cancel</button>
                        <button onClick={handleSave} className="flex items-center gap-1 text-blue-400">
                            <Save size={14} /> Save
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {materials.map(mat => (
                    <div key={mat.id} className="flex justify-between items-center bg-white/5 p-2 rounded hover:bg-white/10 group">
                        <div onClick={() => onSelect && onSelect(mat)} className="cursor-pointer flex-1">
                            <div className="font-medium text-gray-200">{mat.name}</div>
                            <div className="text-xs text-gray-500 capitalize">
                                {mat.type} • {mat.thickness}mm • S{mat.speed} P{mat.power}% {mat.passes > 1 ? `(${mat.passes}x)` : ''}
                            </div>
                        </div>
                        <button
                            onClick={() => handleDelete(mat.id)}
                            className="text-red-900 group-hover:text-red-500"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
                {materials.length === 0 && <p className="text-gray-600 italic text-center">No materials saved</p>}
            </div>
        </div>
    );
};

export default MaterialsPanel;
