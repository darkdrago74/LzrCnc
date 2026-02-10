import React, { useState } from 'react';
import FileUpload from './FileUpload';
import GcodePreview from './GcodePreview';
import TestGeneratorPanel from './TestGeneratorPanel';
import MaterialsPanel from './MaterialsPanel';
import type { VectorOptions } from '../types';
import { LaserOperationStack } from './cam/LaserOperationStack';
import { OperationSettings } from './cam/OperationSettings';
import { DitheringPreview } from './cam/DitheringPreview';
import VisualizerScene from './Visualizer/VisualizerScene';
import { CncPanel } from './cnc/CncPanel';
import type { CamOperation } from './cam/interfaces';
import { DesignerToolbar } from './cam/DesignerToolbar';
import { HelpIcon } from './ui/Tooltip';
import { ObjectProperties } from './cam/ObjectProperties';
import { ChevronRight, ChevronLeft, Zap, Wrench, Library, FlaskConical, Trash2, Save, Play } from 'lucide-react';
import type { SceneObject } from '../types';
// Simple random ID generator (avoiding uuid dep)
const uuidv4 = () => Math.random().toString(36).substring(2, 10);

// Updated Prop Interface
interface CamPanelProps {
    onGenerate: (gcode: string) => void;
    objects: SceneObject[];
    setObjects: React.Dispatch<React.SetStateAction<SceneObject[]>>;
    setSidebarWidth: (w: number) => void;
}

const CamPanel: React.FC<CamPanelProps> = ({ onGenerate, objects, setObjects, setSidebarWidth }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [operations, setOperations] = useState<CamOperation[]>([]);
    const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
    const [gcode, setGcode] = useState<string>('');
    const [loading, setLoading] = useState(false);

    // Legacy file state kept for compatibility, but primarily using objects now
    const [activeTab, setActiveTab] = useState<'laser' | 'cnc' | 'materials' | 'generator'>('laser');
    const [isExpanded, setIsExpanded] = useState(true);

    const [materialThickness, setMaterialThickness] = useState(3);
    const [baseFocusZ, setBaseFocusZ] = useState(-60);
    const [safeZ, setSafeZ] = useState<number | null>(5);

    const workingZ = baseFocusZ + materialThickness;

    // Sync Sidebar Width with App.tsx
    React.useEffect(() => {
        const navWidth = 64;

        const updateWidth = () => {
            if (isExpanded) {
                // Adaptive Mode
                const screenWidth = window.innerWidth;
                const idealWidth = screenWidth * 0.40; // Aim for 40%

                // Constraints: Min 350px (usable), Max 900px (too wide)
                const clamped = Math.min(Math.max(idealWidth, 350), 900);

                // Hard Limit: Never exceed 50% of available screen space (minus nav)
                const finalWidth = Math.min(clamped, (screenWidth - navWidth) * 0.5);

                setSidebarWidth(finalWidth);
            } else {
                // Compact Mode
                setSidebarWidth(navWidth + 400);
            }
        };

        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, [isExpanded, setSidebarWidth]);

    const items = [
        { id: 'laser', icon: Zap, label: 'Laser' },
        { id: 'cnc', icon: Wrench, label: 'CNC' },
        { id: 'materials', icon: Library, label: 'Lib' },
        { id: 'generator', icon: FlaskConical, label: 'Test' },
    ];

    const addObject = (type: SceneObject['type'], content: string) => {
        const newObj: SceneObject = {
            id: Math.random().toString(36).substr(2, 9),
            name: `${type}_${objects.length + 1}`,
            type,
            content,
            position: [0, 0, 0], // Center?
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            selected: true
        };
        // Deselect others
        const updated = objects.map(o => ({ ...o, selected: false }));
        setObjects([...updated, newObj]);
    };

    const handleAddRect = () => {
        const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100" fill="none" stroke="cyan" stroke-width="5"/></svg>`;
        addObject('rect', svg);
    };

    const handleAddCircle = () => {
        const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="none" stroke="cyan" stroke-width="5"/></svg>`;
        addObject('circle', svg);
    };

    const handleAddText = (text: string) => {
        // Basic SVG Text
        const svg = `<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg"><text x="0" y="40" font-family="Arial" font-size="40" fill="cyan" stroke="none">${text}</text></svg>`;
        addObject('text', svg);
    };

    const handleFile = (name: string, content: string | File, type: 'vector' | 'raster') => {
        setFileName(name);

        // Handle file content reading for preview
        if (typeof content === 'string') {
            setFileContent(content); // SVG or path?
            // Add as Object
            addObject('file', content);
        } else {
            // Read as DataURL for preview
            const reader = new FileReader();
            reader.onload = (e) => {
                setFileContent(e.target?.result as string);
            };
            reader.readAsDataURL(content);
            // Handle blobs/files (STLs, Images)
            if (name.endsWith('.stl')) {
                const url = URL.createObjectURL(content as File);
                addObject('stl', url);
            }
        }

        // Initialize default operation based on file type
        if (operations.length === 0) {
            const initialOp: CamOperation = {
                id: 'op-1',
                type: type === 'raster' ? 'raster' : 'vector_cut',
                enabled: true,
                order: 0,
                settings: {
                    power: 100,
                    speed: 1000,
                    passes: 1,
                    mode: type === 'raster' ? 'grayscale' : undefined
                }
            };
            setOperations([initialOp]);
            setSelectedOpId('op-1');
        }
    };

    const handleOpChange = (updatedOp: CamOperation) => {
        setOperations(ops => ops.map(op => op.id === updatedOp.id ? updatedOp : op));
    };

    const handleSelectObject = (id: string) => {
        setObjects(objs => objs.map(o => ({ ...o, selected: o.id === id })));
    };

    const handleUpdateObject = (id: string, props: Partial<SceneObject>) => {
        setObjects(objs => objs.map(o => o.id === id ? { ...o, ...props } : o));
    };

    const handleDeleteObject = () => {
        setObjects(objs => objs.filter(o => !o.selected));
    };

    // Auto-Center / Alignment Helpers could go here...

    const composeScene = () => {
        // Merge all vector objects into one SVG for CAM processing
        // We need to bake transforms.
        // Simplified: Just wrap in <g transform>
        let combinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">`;

        objects.forEach(obj => {
            if (obj.type === 'stl') return; // Skip 3D for 2.5D CAM
            // We need to parse the inner content of the object's SVG and wrap it.
            // Be careful with stripping <svg> tags.
            // Regex to grab content inside <svg>
            const innerMatch = obj.content.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
            const inner = innerMatch ? innerMatch[1] : '';

            // Transform (React Three Fiber uses radians, SVG uses degrees)
            // Position is likely pixels/mm? Visualizer uses units. 
            // Warning: SCALE in Visualizer might be different. 
            // Assume 1 unit = 1 mm.

            const tx = obj.position[0];
            const ty = obj.position[1];
            const rDeg = obj.rotation[2] * (180 / Math.PI);

            combinedSvg += `<g transform="translate(${tx}, ${ty}) rotate(${rDeg}) scale(${obj.scale[0]}, ${obj.scale[1]})">${inner}</g>`;
        });

        combinedSvg += `</svg>`;
        return combinedSvg;
    };

    const generateGcode = async () => {
        // Override fileContent with Composed Scene if multiple objects exist
        const content = objects.length > 0 ? composeScene() : null;
        if (!content) return;

        setLoading(true);
        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${apiUrl}/cam/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName,
                    fileContent: content, // Sends DataURL or SVG content
                    operations,
                    options: {
                        workingZ,
                        safeZ: safeZ ?? undefined
                    } // Global options
                })
            });

            const data = await response.json();
            if (data.status === 'success') {
                setGcode(data.gcode);
                onGenerate(data.gcode);
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            alert('Failed to generate: ' + (e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyMaterial = (mat: any) => {
        if (selectedOpId) {
            const op = operations.find(o => o.id === selectedOpId);
            if (op) {
                handleOpChange({
                    ...op,
                    settings: {
                        ...op.settings,
                        speed: mat.speed,
                        power: mat.power,
                        passes: mat.passes
                    }
                });
            }
        }
        setActiveTab('laser');
    };

    const handleTestGenerate = (code: string) => {
        setGcode(code);
        onGenerate(code);
    };

    const selectedOp = operations.find(o => o.id === selectedOpId);

    return (
        <div className="flex h-full w-full bg-transparent text-gray-100">
            {/* 1. Vertical Navigation Sidebar (Leftmost) */}
            <div className="w-16 flex-none flex flex-col gap-4 border-r border-white/10 pr-2 pt-4 bg-black/40 items-center">
                {items.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id as any)}
                        className={`
                            nav-btn w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-200 group relative
                            ${activeTab === item.id
                                ? 'bg-blue-600/20 text-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.3)] ring-1 ring-blue-500/50'
                                : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'}
                        `}
                        title={item.label}
                    >
                        <item.icon size={20} className={`transition-transform duration-300 ${activeTab === item.id ? 'scale-110' : 'group-hover:scale-110'}`} />
                        <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">{item.label}</span>

                        {activeTab === item.id && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] bg-blue-500 rounded-r-full shadow-[0_0_8px_#3b82f6]"></div>
                        )}
                    </button>
                ))}
            </div>

            {/* 2. Control Stack (Fills the Sidebar Width) */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-black/20">
                {/* Fixed Header for Toggle */}
                <div className="flex items-center gap-3 p-2 border-b border-white/10 bg-black/40 backdrop-blur shrink-0">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-2">
                        {activeTab === 'laser' ? 'Laser CAM' : activeTab}
                    </span>
                    {/* Hidden by user request (default adaptive width is correct)
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="ml-auto p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-colors flex items-center justify-center shadow-sm"
                        title={isExpanded ? "Collapse View" : "Expand View"}
                    >
                        {isExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                    </button>
                    */}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide relative">

                    {activeTab === 'laser' && (
                        <>
                            {/* Materials & Config */}
                            <div className="glass-panel p-4 rounded-xl border border-white/10 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)] animate-pulse"></div>
                                </div>
                                <h3 className="text-orange-400 font-bold mb-4 uppercase text-[10px] tracking-[0.2em] flex items-center gap-2">
                                    <span>Setup & Material</span>
                                </h3>

                                <div className="space-y-4">
                                    {/* Library Select */}
                                    <div className="bg-black/30 rounded-lg p-3 border border-white/5">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-gray-400 text-xs font-medium">Library Preset</span>
                                            <HelpIcon text="Load speed/power settings from database" />
                                        </div>
                                        <MaterialsPanel onSelect={(mat) => {
                                            setMaterialThickness(mat.thickness);
                                            applyMaterial(mat);
                                        }} />
                                    </div>

                                    {/* Manual Overrides */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <label className="text-gray-500 text-[10px] uppercase font-bold">Thickness</label>
                                                <HelpIcon text="Material thickness in mm. Affects Z-height." />
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={materialThickness}
                                                    onChange={e => setMaterialThickness(Number(e.target.value))}
                                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-orange-500/50 focus:outline-none transition-colors"
                                                />
                                                <span className="absolute right-3 top-2 text-gray-600 text-xs pointer-events-none">mm</span>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <label className="text-gray-500 text-[10px] uppercase font-bold">Focus Offset</label>
                                                <HelpIcon text="Z-offset from bed (usually -height)." />
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={baseFocusZ}
                                                    onChange={e => setBaseFocusZ(Number(e.target.value))}
                                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-orange-500/50 focus:outline-none transition-colors"
                                                />
                                                <span className="absolute right-3 top-2 text-gray-600 text-xs pointer-events-none">mm</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between bg-white/5 p-2 rounded-lg border border-white/5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500 text-xs">Safe Z</span>
                                            <HelpIcon text="Retract height for rapid moves" />
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-blue-400 text-sm">{safeZ ?? 'OFF'}</span>
                                            <div className={`w-3 h-3 rounded-full ${safeZ ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'bg-gray-700'}`}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Designer & Ops */}
                            <div className="glass-panel p-4 rounded-xl border border-white/10">
                                <h3 className="text-blue-400 font-bold mb-4 uppercase text-[10px] tracking-[0.2em] flex items-center justify-between">
                                    <span>Designer</span>
                                    {/* FileUpload is now minimal text, maybe put it below? Or keep it here but it's large. 
                                        Let's keep FileUpload prominent for now. */}
                                </h3>

                                <FileUpload onFileLoaded={handleFile} />

                                <div className="mb-4 mt-4 p-2 bg-gradient-to-r from-black/60 to-transparent rounded-lg border border-white/5">
                                    <div className="flex justify-between items-center mb-2">
                                        <DesignerToolbar
                                            onAddRect={handleAddRect}
                                            onAddCircle={handleAddCircle}
                                            onAddText={handleAddText}
                                        />
                                        <button onClick={handleDeleteObject} className="text-xs text-red-500 hover:text-red-400 hover:bg-red-900/10 px-2 py-1 rounded transition-colors flex items-center gap-1">
                                            <span className="text-lg">🗑️</span>
                                        </button>
                                    </div>

                                    {/* Properties Panel for Selected Object */}
                                    {objects.find(o => o.selected) && (
                                        <div className="mt-2 pt-2 border-t border-white/10 animate-in fade-in slide-in-from-top-1">
                                            <ObjectProperties
                                                object={objects.find(o => o.selected)!}
                                                onUpdate={handleUpdateObject}
                                            />
                                        </div>
                                    )}
                                </div>

                                <h3 className="text-green-400 font-bold mb-4 uppercase text-[10px] tracking-[0.2em]">Operations</h3>
                                <LaserOperationStack
                                    operations={operations}
                                    onChange={setOperations}
                                    onSelect={setSelectedOpId}
                                    selectedId={selectedOpId}
                                />

                                {selectedOp && (
                                    <div className="mt-4 bg-black/40 rounded-lg p-3 border border-white/10">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] uppercase text-gray-500 font-bold">Settings</span>
                                            <HelpIcon text="Configure speed, power, and passes for this layer" />
                                        </div>
                                        <OperationSettings
                                            operation={selectedOp}
                                            onChange={handleOpChange}
                                        />
                                    </div>
                                )}

                                <div className="mt-6 space-y-3">
                                    <button
                                        onClick={generateGcode}
                                        disabled={loading}
                                        className="w-full py-3 bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 rounded-lg text-white font-bold disabled:opacity-50 shadow-lg shadow-blue-900/30 border border-blue-500/30 transition-all flex items-center justify-center gap-2 group"
                                    >
                                        {loading ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                <span>Calculating...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>🚀</span>
                                                <span>Generate G-Code</span>
                                            </>
                                        )}
                                    </button>

                                    {gcode && (
                                        <button
                                            onClick={() => {
                                                const blob = new Blob([gcode], { type: 'text/plain' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = fileName?.replace(/\.[^/.]+$/, "") + ".gcode" || "output.gcode";
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            }}
                                            className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 border border-white/10 flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <span>💾</span> Download File
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'cnc' && <CncPanel onGenerate={onGenerate} />}
                    {activeTab === 'materials' && <MaterialsPanel onSelect={applyMaterial} />}
                    {activeTab === 'generator' && <TestGeneratorPanel onGenerate={handleTestGenerate} />}
                </div>
            </div>
        </div>
    );
};

export default CamPanel;
