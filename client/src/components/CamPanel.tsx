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
import { DesignerToolbar, type SceneObject } from './cam/DesignerToolbar';
// Simple random ID generator (avoiding uuid dep)
const uuidv4 = () => Math.random().toString(36).substring(2, 10);

interface CamPanelProps {
    onGenerate: (gcode: string) => void;
}

const CamPanel: React.FC<CamPanelProps> = ({ onGenerate }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [operations, setOperations] = useState<CamOperation[]>([]);
    const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
    const [gcode, setGcode] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [objects, setObjects] = useState<SceneObject[]>([]);
    // Legacy file state kept for compatibility, but primarily using objects now
    const [activeTab, setActiveTab] = useState<'laser' | 'cnc' | 'materials' | 'generator'>('laser');

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
        const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100" fill="none" stroke="black" stroke-width="2"/></svg>`;
        addObject('rect', svg);
    };

    const handleAddCircle = () => {
        const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="none" stroke="black" stroke-width="2"/></svg>`;
        addObject('circle', svg);
    };

    const handleAddText = (text: string) => {
        // Basic SVG Text
        const svg = `<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg"><text x="0" y="40" font-family="Arial" font-size="40" fill="none" stroke="black">${text}</text></svg>`;
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
            const response = await fetch('http://localhost:3000/cam/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName,
                    fileContent: content, // Sends DataURL or SVG content
                    operations,
                    options: {} // Global options if needed
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
        <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
            {/* Main Tabs */}
            <div className="flex gap-4 mb-6 border-b border-white/10 pb-2">
                <button onClick={() => setActiveTab('laser')} className={`px-4 py-2 rounded ${activeTab === 'laser' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                    Laser CAM
                </button>
                <button onClick={() => setActiveTab('cnc')} className={`px-4 py-2 rounded ${activeTab === 'cnc' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                    CNC (Machining)
                </button>
                <button onClick={() => setActiveTab('materials')} className={`px-4 py-2 rounded ${activeTab === 'materials' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                    Library
                </button>
                <button onClick={() => setActiveTab('generator')} className={`px-4 py-2 rounded ${activeTab === 'generator' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}>
                    Test Gen
                </button>
            </div>

            {activeTab === 'laser' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1 space-y-4">
                        <FileUpload onFileLoaded={handleFile} />

                        <DesignerToolbar
                            onAddRect={handleAddRect}
                            onAddCircle={handleAddCircle}
                            onAddText={handleAddText}
                        />
                        <button onClick={handleDeleteObject} className="text-xs text-red-500 mb-2">Delete Selected</button>

                        {/* Operation Stack (Needs to apply to Combined Scene) */}
                        {fileName && (
                            <>
                                <LaserOperationStack
                                    operations={operations}
                                    onChange={setOperations}
                                    onSelect={setSelectedOpId}
                                    selectedId={selectedOpId}
                                />

                                {selectedOp && (
                                    <OperationSettings
                                        operation={selectedOp}
                                        onChange={handleOpChange}
                                    />
                                )}

                                <div className="flex gap-2">
                                    <button
                                        onClick={generateGcode}
                                        disabled={loading}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold disabled:opacity-50"
                                    >
                                        {loading ? 'Processing...' : 'Generate G-Code'}
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
                                            className="px-4 bg-white/10 hover:bg-white/20 rounded text-white"
                                            title="Download G-Code"
                                        >
                                            💾
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="md:col-span-2 bg-black/40 rounded p-4 min-h-[500px] border border-white/10">

                        <div className="mt-4">
                            {gcode && <GcodePreview gcode={gcode} />}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'cnc' && (
                <CncPanel onGenerate={onGenerate} />
            )}

            {activeTab === 'materials' && (
                <MaterialsPanel onSelect={applyMaterial} />
            )}

            {activeTab === 'generator' && (
                <TestGeneratorPanel onGenerate={handleTestGenerate} />
            )}
        </div>
    );
};

export default CamPanel;
