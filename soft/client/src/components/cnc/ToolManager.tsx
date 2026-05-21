import React, { useState, useEffect } from 'react';
import { Pen, Trash, Plus, Calculator } from 'lucide-react';

export interface CncTool {
    id: string;
    name: string;
    type: 'endmill' | 'ballnose' | 'vbit' | 'drill';
    diameter: number;
    flutes: number;
    material: 'hss' | 'carbide';
    maxRPM?: number;
}

export const ToolManager: React.FC = () => {
    const [tools, setTools] = useState<CncTool[]>([]);
    const [editing, setEditing] = useState<Partial<CncTool> | null>(null);
    const [showCalculator, setShowCalculator] = useState(false);

    // Calculator State
    const [calcRpm, setCalcRpm] = useState(12000);
    const [calcFlutes, setCalcFlutes] = useState(2);
    const [calcChipLoad, setCalcChipLoad] = useState(0.05); // mm per tooth
    const [calcFeed, setCalcFeed] = useState(0);

    useEffect(() => {
        fetchTools();
    }, []);

    useEffect(() => {
        // F = RPM * N * CL
        setCalcFeed(Math.round(calcRpm * calcFlutes * calcChipLoad));
    }, [calcRpm, calcFlutes, calcChipLoad]);

    const fetchTools = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/tools');
            const data = await res.json();
            setTools(data);
        } catch (err) {
            console.error(err);
        }
    };

    const handleSave = async () => {
        if (!editing) return;

        try {
            const method = editing.id ? 'PUT' : 'POST';
            const url = editing.id
                ? `http://localhost:3000/api/tools/${editing.id}`
                : 'http://localhost:3000/api/tools';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editing)
            });

            if (res.ok) {
                setEditing(null);
                fetchTools();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this tool?')) return;
        try {
            await fetch(`http://localhost:3000/api/tools/${id}`, { method: 'DELETE' });
            fetchTools();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-white">
            {/* Tool List */}
            <div className="bg-black/40 border border-white/10 rounded p-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold">Tool Library</h3>
                    <button
                        onClick={() => setEditing({ type: 'endmill', material: 'carbide', flutes: 2, diameter: 3.175 })}
                        className="bg-blue-600 hover:bg-blue-500 text-white rounded p-1"
                    >
                        <Plus size={20} />
                    </button>
                </div>

                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {tools.map(tool => (
                        <div key={tool.id} className="bg-white/5 p-3 rounded flex justify-between items-center hover:bg-white/10 transition">
                            <div>
                                <div className="font-bold">{tool.name}</div>
                                <div className="text-xs text-gray-400">
                                    {tool.type} | D{tool.diameter}mm | {tool.flutes}FL | {tool.material}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setEditing(tool)} className="p-1 hover:text-blue-400"><Pen size={16} /></button>
                                <button onClick={() => handleDelete(tool.id)} className="p-1 hover:text-red-400"><Trash size={16} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Editor / Calculator */}
            <div className="space-y-4">
                {editing && (
                    <div className="bg-black/40 border border-white/10 rounded p-4 space-y-3">
                        <h3 className="font-bold mb-2">{editing.id ? 'Edit Tool' : 'New Tool'}</h3>

                        <div>
                            <label className="text-xs text-gray-400 block">Name</label>
                            <input
                                className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1"
                                value={editing.name || ''}
                                onChange={e => setEditing({ ...editing, name: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs text-gray-400 block">Type</label>
                                <select
                                    className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1"
                                    value={editing.type}
                                    onChange={e => setEditing({ ...editing, type: e.target.value as any })}
                                >
                                    <option value="endmill">End Mill</option>
                                    <option value="ballnose">Ball Nose</option>
                                    <option value="vbit">V-Bit</option>
                                    <option value="drill">Drill</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block">Material</label>
                                <select
                                    className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1"
                                    value={editing.material}
                                    onChange={e => setEditing({ ...editing, material: e.target.value as any })}
                                >
                                    <option value="carbide">Carbide</option>
                                    <option value="hss">HSS</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs text-gray-400 block">Diameter (mm)</label>
                                <input
                                    type="number" step="0.01"
                                    className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1"
                                    value={editing.diameter}
                                    onChange={e => setEditing({ ...editing, diameter: parseFloat(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block">Flutes</label>
                                <input
                                    type="number"
                                    className="w-full bg-black/50 border border-gray-600 rounded px-2 py-1"
                                    value={editing.flutes}
                                    onChange={e => setEditing({ ...editing, flutes: parseFloat(e.target.value) })}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setEditing(null)} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600">Cancel</button>
                            <button onClick={handleSave} className="px-3 py-1 bg-green-600 rounded hover:bg-green-500">Save</button>
                        </div>
                    </div>
                )}

                {/* Feeds & Speeds Calculator */}
                <div className="bg-black/40 border border-white/10 rounded p-4">
                    <div className="flex items-center gap-2 mb-4 text-cyan-400">
                        <Calculator size={20} />
                        <h3 className="font-bold">Feeds & Speeds Calculator</h3>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                            <label className="text-gray-500 text-xs block">Target RPM</label>
                            <input
                                type="number"
                                className="w-full bg-black border border-gray-700 rounded p-1"
                                value={calcRpm}
                                onChange={e => setCalcRpm(Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="text-gray-500 text-xs block">Flutes</label>
                            <input
                                type="number"
                                className="w-full bg-black border border-gray-700 rounded p-1"
                                value={calcFlutes}
                                onChange={e => setCalcFlutes(Number(e.target.value))}
                            />
                        </div>
                        <div>
                            <label className="text-gray-500 text-xs block">Chip Load (mm)</label>
                            <input
                                type="number" step="0.001"
                                className="w-full bg-black border border-gray-700 rounded p-1"
                                value={calcChipLoad}
                                onChange={e => setCalcChipLoad(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    <div className="mt-4 p-2 bg-white/5 rounded text-center">
                        <div className="text-xs text-gray-400">Suggested Feed Rate</div>
                        <div className="text-2xl font-bold text-cyan-400">{calcFeed} <span className="text-sm text-gray-500">mm/min</span></div>
                        <div className="text-[10px] text-gray-600">Based on F = RPM × N × ChipLoad</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
