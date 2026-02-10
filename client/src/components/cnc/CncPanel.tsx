import React, { useState } from 'react';
import { ToolManager } from './ToolManager';
import FileUpload from '../FileUpload';
import GcodePreview from '../GcodePreview';
import { parseGcodeBounds } from '../../utils/gcodeUtils';

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

    return (
        <div className="flex flex-col space-y-4 p-2 text-white">
            {/* Sub Tabs */}
            <div className="flex gap-2 bg-black/20 p-1 rounded">
                <button onClick={() => setSubTab('setup')} className={`flex-1 py-1 rounded text-xs ${subTab === 'setup' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>Setup</button>
                <button onClick={() => setSubTab('2.5d')} className={`flex-1 py-1 rounded text-xs ${subTab === '2.5d' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>2.5D</button>
                <button onClick={() => setSubTab('3d')} className={`flex-1 py-1 rounded text-xs ${subTab === '3d' ? 'bg-orange-600 text-white' : 'text-gray-400'}`}>3D</button>
            </div>

            {subTab === 'setup' && (
                <div className="space-y-4">
                    <div className="bg-white/5 p-4 rounded border border-white/5">
                        <h4 className="font-bold text-orange-400 mb-2 text-xs uppercase tracking-wider">Z-Probe & Setup</h4>
                        <div className="flex gap-2 text-white">
                            <button className="flex-1 bg-cyan-700/50 hover:bg-cyan-600 py-2 rounded text-xs border border-cyan-500/30">Probe Z-Zero</button>
                            <button className="flex-1 bg-gray-700/50 hover:bg-gray-600 py-2 rounded text-xs border border-gray-600/30">Check Height</button>
                        </div>
                        <button onClick={testZ} className="w-full mt-2 border border-gray-600 text-gray-400 text-[10px] py-1 hover:text-white hover:bg-white/5 transition-colors">
                            Test Z Direction (Move Up 10mm)
                        </button>
                    </div>

                    <ToolManager />

                    <div className="bg-white/5 p-4 rounded border border-white/5">
                        <h4 className="font-bold text-orange-400 mb-2 text-xs uppercase tracking-wider">Tool Management Hints</h4>
                        <div className="text-[10px] text-gray-500 mt-1 italic">
                            1. Select Tool in Manager above.<br />
                            2. Manually change physical bit.<br />
                            3. Place sensor on stock and Probe Z-Zero.
                        </div>
                    </div>
                </div>
            )}

            {subTab === '2.5d' && (
                <div className="space-y-4 bg-white/5 p-4 rounded text-white border border-white/5">
                    {/* Auto Center Toggle */}
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" checked={autoCenter} onChange={e => setAutoCenter(e.target.checked)} />
                        <label className="text-sm">Auto-Center on Bed</label>
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 block mb-2">Operation</label>
                        <div className="text-center py-10 text-gray-500 italic border border-dashed border-gray-700 rounded">
                            2.5D CAM Module (DXF/SVG)<br />Coming Soon
                        </div>
                    </div>
                </div>
            )}

            {subTab === '3d' && (
                <div className="text-center py-10 text-gray-500 italic bg-white/5 rounded border border-white/5">
                    3D CAM Module (STL/STEP)<br />Coming Soon
                </div>
            )}

            {gcode && (
                <div className="bg-black/40 p-4 rounded border border-white/10 mt-auto">
                    <h4 className="text-sm text-gray-300 mb-2">G-Code Preview</h4>
                    <GcodePreview gcode={gcode} />
                </div>
            )}
        </div>
    );
};
