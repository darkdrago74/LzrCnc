import React, { useState } from 'react';
import { apiPost } from '../api';
import FileUpload from './FileUpload';
import TestGeneratorPanel from './TestGeneratorPanel';
import MaterialsPanel from './MaterialsPanel';
import type { MachineSettings } from '../types';
import { LaserOperationStack } from './cam/LaserOperationStack';
import { OperationSettings } from './cam/OperationSettings';
import type { CamOperation, OperationType } from './cam/interfaces';
import { DesignerToolbar, type ShapeKind } from './cam/DesignerToolbar';
import { DrawingModal, type DrawnObject } from './cam/DrawingModal';
import { HelpIcon } from './ui/Tooltip';
import { ObjectProperties } from './cam/ObjectProperties';
import { MillPanel, type MillController } from './cam/MillPanel';
import { Zap, Library, FlaskConical, Trash2, Drill, Copy } from 'lucide-react';
import type { ParametricConfig, SceneObject } from '../types';
import { getBedExtents } from '../utils/machineGeometry';
import { getSvgInfo } from '../utils/svgUtils';
import { SKIP_OPERATION, buildLaserJob, defaultOperation, isRasterObject, isVectorObject, resolveOperation } from '../utils/laserJob';
import { usePersistentState } from '../utils/usePersistentState';
import { formatDuration } from '../utils/gcodeParser';

export type CamTab = 'laser' | 'mill' | 'materials' | 'generator';

interface CamPanelProps {
    onGenerate: (gcode: string) => void;
    objects: SceneObject[];
    setObjects: React.Dispatch<React.SetStateAction<SceneObject[]>>;
    setSidebarWidth: (w: number) => void;
    machineSettings?: MachineSettings;
    /** GRBL $30 – spindle/laser value for 100 % power */
    maxS?: number;
    /** Milling workspace state (owned by App so the 3D view can show it). */
    mill?: MillController;
    activeTab?: CamTab;
    onTabChange?: (tab: CamTab) => void;
}

const CamPanel: React.FC<CamPanelProps> = ({
    onGenerate, objects, setObjects, setSidebarWidth, machineSettings, maxS = 1000,
    mill, activeTab: tabProp, onTabChange
}) => {
    const [fileName, setFileName] = useState<string | null>(null);
    // Operation profiles are kept across tab switches and reloads.
    const [operations, setOperations] = usePersistentState<CamOperation[]>('lzrcnc.laser.ops', []);
    const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
    const [gcode, setGcode] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [drawingKind, setDrawingKind] = useState<ShapeKind | null>(null);
    const [jobStats, setJobStats] = useState<{ lines: number; estimatedTimeSec: number; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null>(null);

    const [localTab, setLocalTab] = useState<CamTab>('laser');
    const activeTab = tabProp ?? localTab;
    const setActiveTab = (t: CamTab) => { setLocalTab(t); onTabChange?.(t); };
    const isExpanded = true;

    const [materialThickness, setMaterialThickness] = useState(3);
    const [laserMode, setLaserMode] = useState<'M4' | 'M3'>('M4');
    const [airAssist, setAirAssist] = useState(false);
    const [travelSpeed, setTravelSpeed] = useState(3000);

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
        { id: 'mill', icon: Drill, label: 'Mill' },
        { id: 'materials', icon: Library, label: 'Lib' },
        { id: 'generator', icon: FlaskConical, label: 'Test' },
    ];

    const bed = getBedExtents(machineSettings);

    interface AddOptions { name?: string; size?: [number, number]; svgUnitsMm?: boolean; parametric?: ParametricConfig }

    /**
     * Makes sure an enabled operation exists that can process this kind of object.
     * Returns its id (an existing one, or the newly created one).
     */
    const ensureOperationFor = (kind: 'raster' | 'vector'): string => {
        const match = (o: CamOperation) => o.enabled && (kind === 'raster' ? o.type === 'raster' : o.type !== 'raster');
        const existing = operations.find(match);
        if (existing) return existing.id;
        const op = defaultOperation((kind === 'raster' ? 'raster' : 'vector_cut') as OperationType, operations.length);
        setOperations(ops => (ops.some(match) ? ops : [...ops, op]));
        setSelectedOpId(op.id);
        return op.id;
    };

    const addObject = async (type: SceneObject['type'], content: string, opts: AddOptions = {}) => {
        let size = opts.size;
        if (!size && type !== 'gcode' && type !== 'stl') {
            if (/^(blob:|data:|https?:)/.test(content)) {
                size = await new Promise<[number, number]>(resolve => {
                    const img = new Image();
                    img.onload = () => resolve([img.naturalWidth * 25.4 / 96, img.naturalHeight * 25.4 / 96]);
                    img.onerror = () => resolve([50, 50]);
                    img.src = content;
                });
            } else {
                const info = getSvgInfo(content, opts.svgUnitsMm);
                size = [info.widthMm, info.heightMm];
            }
            // Fit oversized artwork into 80 % of the bed
            const k = Math.min(1, (bed.width * 0.8) / size[0], (bed.height * 0.8) / size[1]);
            if (k < 1) size = [size[0] * k, size[1] * k];
        }

        // Cascade new objects so they don't land exactly on top of each other
        const step = 10 * (objects.length % 8);
        // Filled shapes / filled vector text are meant to be engraved as an area → route them to a raster profile.
        const filled = !!opts.parametric?.fill && /<svg[\s>]/i.test(content);
        const newObj: SceneObject = {
            id: Math.random().toString(36).slice(2, 11),
            name: opts.name || `${type}_${objects.length + 1}`,
            type,
            content,
            size,
            svgUnitsMm: opts.svgUnitsMm,
            parametric: opts.parametric,
            position: [bed.centerX + step, bed.centerY - step, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            selected: true,
            gcodeOptions: type === 'gcode' ? { offsetX: 0, offsetY: 0, feedrateScale: 1.0, feedrateOverride: undefined } : undefined
        };
        if (filled) newObj.operationId = ensureOperationFor('raster');
        setObjects(prev => [...prev.map(o => ({ ...o, selected: false })), newObj]);
        setJobStats(null);

        if (filled) return;
        if (isRasterObject(newObj)) ensureOperationFor('raster');
        else if (isVectorObject(newObj)) ensureOperationFor('vector');
    };

    const handleFile = (name: string, content: string | File, type: 'vector' | 'raster' | 'gcode') => {
        setFileName(name);
        const lower = name.toLowerCase();

        if (typeof content !== 'string') {
            const url = URL.createObjectURL(content);
            if (lower.endsWith('.stl')) addObject('stl', url, { name });
            else addObject('image', url, { name });
            return;
        }

        if (type === 'gcode') {
            // Imported G-code is used as-is: show it and send it to the job tab.
            addObject('gcode', content, { name });
            setGcode(content);
            onGenerate(content);
            return;
        }

        const isDxf = lower.endsWith('.dxf');
        addObject('file', content, { name, svgUnitsMm: isDxf });
    };

    const handleOpChange = (updatedOp: CamOperation) => {
        setOperations(ops => ops.map(op => op.id === updatedOp.id ? updatedOp : op));
        setJobStats(null);
    };

    const handleSelectObject = (id: string) => {
        setObjects(objs => objs.map(o => ({ ...o, selected: o.id === id })));
    };

    const handleUpdateObject = (id: string, props: Partial<SceneObject>) => {
        setObjects(objs => objs.map(o => o.id === id ? { ...o, ...props } : o));
        setJobStats(null);
    };

    const handleDeleteObject = () => {
        setObjects(objs => objs.filter(o => !o.selected));
        setJobStats(null);
    };

    const handleDuplicateObject = () => {
        const src = objects.find(o => o.selected);
        if (!src) return;
        const copy: SceneObject = { ...src, id: Math.random().toString(36).slice(2, 11), name: `${src.name} copy`, position: [src.position[0] + 10, src.position[1] - 10, src.position[2]], selected: true };
        setObjects(prev => [...prev.map(o => ({ ...o, selected: false })), copy]);
    };

    const handleDrawn = (d: DrawnObject) => addObject(d.type, d.content, { name: d.name, size: d.size, svgUnitsMm: d.svgUnitsMm, parametric: d.parametric });

    const generateGcode = async () => {
        const camObjects = objects.filter(o => o.type !== 'gcode' && o.type !== 'stl');
        if (camObjects.length === 0) {
            alert('Add an image, SVG, DXF or shape to the bed first.');
            return;
        }
        setLoading(true);
        setJobStats(null);
        try {
            const job = await buildLaserJob(camObjects, operations);
            if (job.operations.length === 0) {
                alert('Nothing to generate. Make sure each object has an enabled operation (Raster for images/text, Cut or Vector for SVG/DXF/shapes).');
                return;
            }
            if (job.unassigned.length > 0) {
                console.warn('Objects without a matching operation:', job.unassigned);
            }
            const data = await apiPost<{ status: string; gcode: string; stats: { lines: number; estimatedTimeSec: number; bounds: { minX: number; minY: number; maxX: number; maxY: number } }; error?: string }>(
                '/cam/generate',
                { operations: job.operations, options: { maxS, laserMode, travelSpeed, airAssist } }
            );
            setGcode(data.gcode);
            setJobStats(data.stats);
            onGenerate(data.gcode);
            if (job.unassigned.length > 0) {
                alert(`Skipped (no matching operation): ${job.unassigned.join(', ')}`);
            }
        } catch (e) {
            alert('Failed to generate: ' + (e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const laserObjects = objects.filter(o => o.type !== 'gcode' && o.type !== 'stl');
    const opCounts: Record<string, number> = {};
    for (const o of laserObjects) {
        const op = resolveOperation(o, operations);
        if (op) opCounts[op.id] = (opCounts[op.id] ?? 0) + 1;
    }
    const assignedCount = (op: CamOperation) => opCounts[op.id] ?? 0;
    const assignObject = (objectId: string, opId: string, assign: boolean) =>
        handleUpdateObject(objectId, { operationId: assign ? opId : SKIP_OPERATION });

    const applyGCodeModifications = async () => {
        const gcodeObj = objects.find(o => o.type === 'gcode' && o.selected);
        if (!gcodeObj) return;

        setLoading(true);
        try {
            const data = await apiPost<{ status: string; gcode: string; error?: string }>('/cam/modify-gcode', {
                fileContent: gcodeObj.content,
                options: gcodeObj.gcodeOptions
            });
            if (data.status === 'success') {
                setGcode(data.gcode);
                onGenerate(data.gcode);
            } else {
                alert('G-Code Modification Error: ' + data.error);
            }
        } catch (e) {
            alert('Failed to modify G-Code: ' + (e as Error).message);
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
    const selectedObj = objects.find(o => o.selected);

    /** Toolbar + object list + properties, shared by the Laser and Mill tabs. */
    const designerCore = (
        <>
            <div className="flex justify-between items-center mb-2">
                <DesignerToolbar onOpenShape={setDrawingKind} />
                <div className="flex gap-1">
                    <button onClick={handleDuplicateObject} disabled={!selectedObj} className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Duplicate selected">
                        <Copy size={16} />
                    </button>
                    <button onClick={handleDeleteObject} disabled={!selectedObj} className="p-2 rounded-md text-red-400 hover:text-red-300 hover:bg-red-900/20 disabled:opacity-30" title="Delete selected">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {objects.length > 0 && (
                <div className="mb-2 max-h-40 overflow-y-auto bg-black/40 rounded border border-white/5 p-1">
                    {objects.map(obj => (
                        <div
                            key={obj.id}
                            onClick={() => handleSelectObject(obj.id)}
                            className={`cursor-pointer px-2 py-1.5 flex items-center justify-between rounded text-xs transition-colors mb-1 ${obj.selected ? 'bg-blue-600/50 border border-blue-500/50' : 'hover:bg-white/10'}`}
                        >
                            <div className="flex items-center gap-2 truncate">
                                {activeTab === 'laser' && obj.type !== 'gcode' && obj.type !== 'stl' && (() => {
                                    const op = resolveOperation(obj, operations);
                                    return <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/20"
                                        style={{ background: op?.color ?? 'transparent' }}
                                        title={op ? `${op.name ?? op.type}${obj.operationId ? '' : ' (automatic)'}` : obj.operationId === SKIP_OPERATION ? "Not burned (None)" : 'No matching operation'} />;
                                })()}
                                <span className="opacity-50 text-[10px] uppercase w-10 shrink-0">{obj.parametric?.shape ?? obj.type}</span>
                                <span className="truncate">{obj.name}</span>
                            </div>
                            <div className="text-[10px] opacity-40">
                                [{(obj.position[0] ?? 0).toFixed(0)}, {(obj.position[1] ?? 0).toFixed(0)}]
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedObj && selectedObj.type !== 'gcode' && (
                <div className="mt-2 pt-2 border-t border-white/10 animate-in fade-in slide-in-from-top-1">
                    <ObjectProperties object={selectedObj} onUpdate={handleUpdateObject} operations={activeTab === 'mill' ? [] : operations} />
                </div>
            )}
        </>
    );

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
                        {activeTab === 'laser' ? 'Laser CAM' : activeTab === 'mill' ? 'Mill CAM · 2.5D' : activeTab}
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

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-gray-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1">Thickness <HelpIcon text="Material thickness (informational, from the library preset). Focus your laser on the material surface." /></label>
                                            <div className="relative">
                                                <input type="number" value={materialThickness} onChange={e => setMaterialThickness(Number(e.target.value))}
                                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-orange-500/50 focus:outline-none" />
                                                <span className="absolute right-3 top-2 text-gray-600 text-xs pointer-events-none">mm</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-gray-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1">Travel speed <HelpIcon text="Feed rate for laser-off moves between shapes." /></label>
                                            <div className="relative">
                                                <input type="number" min={100} value={travelSpeed} onChange={e => setTravelSpeed(Math.max(100, Number(e.target.value) || 3000))}
                                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:border-orange-500/50 focus:outline-none" />
                                                <span className="absolute right-3 top-2 text-gray-600 text-xs pointer-events-none">mm/min</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="flex rounded-lg overflow-hidden border border-white/10">
                                            {(['M4', 'M3'] as const).map(m => (
                                                <button key={m} onClick={() => setLaserMode(m)} title={m === 'M4' ? 'Dynamic power (recommended for GRBL laser mode $32=1)' : 'Constant power'}
                                                    className={`flex-1 py-1.5 font-mono ${laserMode === m ? 'bg-orange-500/25 text-orange-200' : 'text-gray-400 hover:bg-white/5'}`}>
                                                    {m} {m === 'M4' ? 'dynamic' : 'constant'}
                                                </button>
                                            ))}
                                        </div>
                                        <label className="flex items-center gap-2 text-gray-300 px-2">
                                            <input type="checkbox" checked={airAssist} onChange={e => setAirAssist(e.target.checked)} /> Air assist (M8)
                                        </label>
                                    </div>
                                    <div className="text-[10px] text-gray-500">100 % power = S{maxS} (GRBL $30)</div>
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
                                    {designerCore}

                                    {objects.find(o => o.selected && o.type === 'gcode') && (
                                        <div className="mt-2 pt-2 border-t border-white/10 animate-in fade-in slide-in-from-top-1 bg-black/30 p-3 rounded">
                                            <h4 className="text-gray-400 text-[10px] uppercase font-bold mb-2 flex items-center gap-2">
                                                <span>Imported G-Code Properties</span>
                                            </h4>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
                                                <div>
                                                    <label className="text-gray-500 text-[10px] uppercase mb-1 block">Offset X</label>
                                                    <input
                                                        type="number"
                                                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                                        value={objects.find(o => o.selected)?.gcodeOptions?.offsetX || 0}
                                                        onChange={(e) => {
                                                            const obj = objects.find(o => o.selected)!;
                                                            handleUpdateObject(obj.id, { gcodeOptions: { ...obj.gcodeOptions!, offsetX: parseFloat(e.target.value) || 0 } });
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-gray-500 text-[10px] uppercase mb-1 block">Offset Y</label>
                                                    <input
                                                        type="number"
                                                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                                        value={objects.find(o => o.selected)?.gcodeOptions?.offsetY || 0}
                                                        onChange={(e) => {
                                                            const obj = objects.find(o => o.selected)!;
                                                            handleUpdateObject(obj.id, { gcodeOptions: { ...obj.gcodeOptions!, offsetY: parseFloat(e.target.value) || 0 } });
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-gray-500 text-[10px] uppercase mb-1 block">Feedrate Scale</label>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                                        value={objects.find(o => o.selected)?.gcodeOptions?.feedrateScale || 1.0}
                                                        onChange={(e) => {
                                                            const obj = objects.find(o => o.selected)!;
                                                            handleUpdateObject(obj.id, { gcodeOptions: { ...obj.gcodeOptions!, feedrateScale: parseFloat(e.target.value) || 1.0 } });
                                                        }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-gray-500 text-[10px] uppercase mb-1 block">Override F</label>
                                                    <input
                                                        type="number"
                                                        placeholder="e.g. 500"
                                                        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                                        value={objects.find(o => o.selected)?.gcodeOptions?.feedrateOverride || ''}
                                                        onChange={(e) => {
                                                            const obj = objects.find(o => o.selected)!;
                                                            const val = e.target.value ? parseFloat(e.target.value) : undefined;
                                                            handleUpdateObject(obj.id, { gcodeOptions: { ...obj.gcodeOptions!, feedrateOverride: val } });
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={applyGCodeModifications}
                                                disabled={loading}
                                                className="w-full py-2 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded text-xs font-bold transition-colors"
                                            >
                                                {loading ? 'Processing...' : 'Apply & Generate Output'}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <h3 className="text-green-400 font-bold mb-4 uppercase text-[10px] tracking-[0.2em]">Operations</h3>
                                <LaserOperationStack
                                    operations={operations}
                                    onChange={setOperations}
                                    onSelect={setSelectedOpId}
                                    selectedId={selectedOpId}
                                    counts={opCounts}
                                />

                                {selectedOp && (
                                    <div className="mt-4 bg-black/40 rounded-lg p-3 border border-white/10">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] uppercase text-gray-500 font-bold">Profile settings</span>
                                            <HelpIcon text="One profile = one set of laser settings. Assign as many objects as you like to it; change the profile once to update them all." />
                                        </div>
                                        <OperationSettings
                                            operation={selectedOp}
                                            onChange={handleOpChange}
                                            assignedCount={assignedCount(selectedOp)}
                                            objects={laserObjects
                                                .filter(o => (selectedOp.type === 'raster' ? true : isVectorObject(o)))
                                                .map(o => {
                                                    const op = resolveOperation(o, operations);
                                                    return { obj: o, assigned: op?.id === selectedOp.id, otherOp: op && op.id !== selectedOp.id ? op : undefined };
                                                })}
                                            onAssign={(id, assign) => assignObject(id, selectedOp.id, assign)}
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
                                                <Zap size={16} />
                                                <span>Generate G-Code</span>
                                            </>
                                        )}
                                    </button>

                                    {jobStats && (
                                        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-3 text-xs grid grid-cols-2 gap-y-1">
                                            <span className="text-gray-500">Lines</span><span className="font-mono text-right">{jobStats.lines.toLocaleString()}</span>
                                            <span className="text-gray-500">Est. time</span><span className="font-mono text-right text-emerald-300">{formatDuration(jobStats.estimatedTimeSec)}</span>
                                            <span className="text-gray-500">Burn area</span><span className="font-mono text-right">{(jobStats.bounds.maxX - jobStats.bounds.minX).toFixed(1)} × {(jobStats.bounds.maxY - jobStats.bounds.minY).toFixed(1)} mm</span>
                                            <span className="text-gray-500">From</span><span className="font-mono text-right">X{jobStats.bounds.minX.toFixed(1)} Y{jobStats.bounds.minY.toFixed(1)}</span>
                                        </div>
                                    )}

                                    {gcode && (
                                        <button
                                            onClick={() => {
                                                const blob = new Blob([gcode], { type: 'text/plain' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'lzrcnc-job') + '.gcode';
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            }}
                                            className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 border border-white/10 flex items-center justify-center gap-2 transition-colors"
                                        >
                                            Download .gcode
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'materials' && <MaterialsPanel onSelect={applyMaterial} />}
                    {activeTab === 'generator' && <TestGeneratorPanel onGenerate={handleTestGenerate} />}

                    {activeTab === 'mill' && (
                        <div className="space-y-4">
                            <div className="glass-panel p-4 rounded-xl border border-white/10">
                                <h3 className="text-blue-400 font-bold mb-3 uppercase text-[10px] tracking-[0.2em]">Drawing (shared with Laser)</h3>
                                <FileUpload onFileLoaded={handleFile} />
                                <div className="mt-3 p-2 bg-gradient-to-r from-black/60 to-transparent rounded-lg border border-white/5">
                                    {designerCore}
                                </div>
                            </div>
                            {mill
                                ? <MillPanel mill={mill} />
                                : <p className="text-xs text-gray-500">Milling workspace unavailable.</p>}
                        </div>
                    )}
                </div>
            </div>

            <DrawingModal
                isOpen={drawingKind !== null}
                kind={drawingKind ?? 'rect'}
                onClose={() => setDrawingKind(null)}
                onCreate={handleDrawn}
            />
        </div>
    );
};

export default CamPanel;
