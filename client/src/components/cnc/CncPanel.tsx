import React, { useState } from 'react';
import { ToolManager } from './ToolManager';
import FileUpload from '../FileUpload';
import GcodePreview from '../GcodePreview';
import { parseGcodeBounds } from '../../utils/gcodeUtils';
// import ImageTracer from 'imagetracerjs'; // Import was misplaced, and logic broken. Commenting out for now.

interface CncPanelProps {
    onGenerate: (gcode: string) => void;
}

export const CncPanel: React.FC<CncPanelProps> = ({ onGenerate }) => {
    const [subTab, setSubTab] = useState<'setup' | '2.5d' | '3d'>('setup');
    const [gcode, setGcode] = useState<string>('');
    const [autoCenter, setAutoCenter] = useState(true);

    const testZ = () => {
        // Moves Z UP by 10mm then DOWN by 10mm
        const cmd = `G91\nG0 Z10\nG0 Z-10\nG90`;
        console.log("Test Z:", cmd);
        alert("Sending Z Test: Up 10mm -> Down 10mm. If it goes DOWN first, your motor is inverted!");
    };

    /* 
    // Broken Logic from previous edit (missing addObject, misplaced import)
    const handleTrace = () => {
        if (!fileContent || !fileName) return;
        // ...
    };
    */

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
                {/* Sub Tabs */}
                <div className="flex gap-2 bg-black/20 p-1 rounded">
                    <button onClick={() => setSubTab('setup')} className={`flex-1 py-1 rounded text-xs ${subTab === 'setup' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>Setup & Tools</button>
                    <button onClick={() => setSubTab('2.5d')} className={`flex-1 py-1 rounded text-xs ${subTab === '2.5d' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>2.5D CAM</button>
                    <button onClick={() => setSubTab('3d')} className={`flex-1 py-1 rounded text-xs ${subTab === '3d' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>3D CAM</button>
                </div>

                {subTab === 'setup' && (
                    <div className="space-y-4">
                        <div className="bg-white/5 p-4 rounded">
                            <h4 className="font-bold text-orange-400 mb-2">Z-Probe & Setup</h4>
                            <div className="flex gap-2">
                                <button className="flex-1 bg-cyan-700 hover:bg-cyan-600 py-1 rounded text-xs">Probe Z-Zero (Touch Top)</button>
                                <button className="flex-1 bg-gray-700 hover:bg-gray-600 py-1 rounded text-xs">Check Height</button>
                            </div>
                            <button onClick={testZ} className="w-full mt-2 border border-gray-600 text-gray-400 text-[10px] py-1 hover:text-white">
                                Test Z Direction (Move Up 10mm)
                            </button>
                        </div>

                        <div className="bg-white/5 p-4 rounded">
                            <h4 className="font-bold text-orange-400 mb-2">Tool Management</h4>
                            <button className="w-full py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-bold mt-2">
                                Tool Change: Re-Probe Z (Current Tool)
                            </button>
                            <div className="text-[10px] text-gray-500 mt-1">
                                After changing tool, place sensor on stock and click to re-zero Z.
                            </div>
                        </div>
                    </div>
                )}

                {subTab === '2.5d' && (
                    <div className="space-y-4 bg-white/5 p-4 rounded text-white">
                        {/* Auto Center Toggle */}
                        <div className="flex items-center gap-2 mb-2">
                            <input type="checkbox" checked={autoCenter} onChange={e => setAutoCenter(e.target.checked)} />
                            <label className="text-sm">Auto-Center on Bed</label>
                        </div>

                        <div>
                            <label className="text-xs text-gray-400 block">Operation</label>
                            <div className="text-center py-10 text-gray-500 italic">
                                2.5D CAM Module (DXF/SVG)<br />Under Construction
                            </div>
                        </div>
                    </div>
                )}

                {subTab === '3d' && (
                    <div className="text-center py-10 text-gray-500 italic">
                        3D CAM Module (STL/STEP)<br />Under Construction
                    </div>
                )}
            </div>

            <div className="md:col-span-2 space-y-4">
                {subTab === 'setup' && (
                    <ToolManager />
                )}

                {gcode && (
                    <div className="bg-black/40 p-4 rounded border border-white/10">
                        <h4 className="text-sm text-gray-300 mb-2">G-Code Preview</h4>
                        <GcodePreview gcode={gcode} />
                    </div>
                )}
            </div>
        </div>
    );
};
