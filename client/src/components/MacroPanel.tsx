import React, { useState } from 'react';
import { Unlock, RefreshCw, ArrowDownToLine, TriangleAlert, Activity, Flame, Scan, Square } from 'lucide-react';
import type { MachineStatus } from '../types';

interface MacroPanelProps {
    status: MachineStatus;
    hasGcode: boolean;
    onCommand: (cmd: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onProbe: (options: any) => void;
    onLaserTest: (power: number, duration: number) => void;
    onFrame: () => void;
}

const MacroPanel: React.FC<MacroPanelProps> = ({ status, hasGcode, onCommand, onProbe, onLaserTest, onFrame }) => {
    const [showProbe, setShowProbe] = useState(false);

    // Laser Test Settings
    const [testPower, setTestPower] = useState(1);
    const [pulseDuration, setPulseDuration] = useState(0.1); // Default 0.1s

    // Probe settings
    const [plateThickness, setPlateThickness] = useState(15.0);
    const [isFiring, setIsFiring] = useState(false);

    // Get settings from status or defaults
    const maxSpindle = status.grblSettings?.[30] || 1000;
    const laserMode = status.grblSettings?.[32] === 1;

    const handleFireToggle = () => {
        if (isFiring) {
            // Manual Stop Force
            onCommand('M5');
            setTimeout(() => onCommand('$32=1'), 100);
            setIsFiring(false);
            return;
        }

        // FIRE SEQUENCE
        // Scale 0-100% to 0-maxSpindle
        const sVal = Math.floor((testPower / 100) * maxSpindle);

        // 1. Disable Laser Mode (Safety Bypass)
        onCommand('$32=0');

        // 2. Fire Laser (Delayed slightly to ensure mode switch)
        setTimeout(() => {
            onCommand(`M3 S${sVal}`);
            setIsFiring(true);

            // 3. Handle Duration (if > 0)
            if (pulseDuration > 0) {
                setTimeout(() => {
                    onCommand('M5');
                    setTimeout(() => {
                        onCommand('$32=1'); // Restore Safety
                        setIsFiring(false);
                    }, 100);
                }, pulseDuration * 1000); // Convert sec to ms
            }
        }, 100);
    };

    const [retract, setRetract] = useState(5.0);
    const [dist, setDist] = useState(-20.0);

    const handleProbeStart = () => {
        onProbe({
            axis: 'z',
            feedrate: 100, // Slow probe
            dist,
            plateThickness,
            retract
        });
        setShowProbe(false);
    };

    return (
        <div className="glass-panel p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Macros</h3>

            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={() => onCommand('$X')}
                    className="flex items-center gap-2 p-2 bg-red-900/30 hover:bg-red-900/50 text-red-200 rounded border border-red-800/50 transition-colors"
                    title="Unlock Alarm"
                >
                    <Unlock size={16} />
                    <span>Unlock</span>
                </button>

                <button
                    onClick={() => onCommand('$H')}
                    className="flex items-center gap-2 p-2 bg-blue-900/30 hover:bg-blue-900/50 text-blue-200 rounded border border-blue-800/50 transition-colors"
                >
                    <RefreshCw size={16} />
                    <span>Home All</span>
                </button>

                {/* Laser Tools */}
                <div className="col-span-2 bg-black/20 p-2 rounded border border-white/5 space-y-2 mt-2">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs text-gray-400 gap-2">
                            <span>Laser Test</span>
                            <div className="flex gap-2 text-[10px] text-gray-500">
                                <span title="Max Spindle Speed ($30)">Max: S{maxSpindle}</span>
                                <span title="Laser Mode ($32)" className={laserMode ? 'text-green-500/50' : 'text-yellow-500/50'}>
                                    Mode: {laserMode ? 'Laser' : 'Spindle'}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1" title="Power %">
                                <input
                                    type="number"
                                    value={testPower}
                                    onChange={e => setTestPower(Number(e.target.value))}
                                    className="w-10 bg-black border border-gray-700 text-center rounded text-white"
                                    min={0} max={100}
                                />
                                <span>%</span>
                            </div>
                            <div className="flex items-center gap-1" title="Duration (sec). 0 = Toggle">
                                <input
                                    type="number"
                                    value={pulseDuration}
                                    onChange={e => setPulseDuration(Number(e.target.value))}
                                    className="w-12 bg-black border border-gray-700 text-center rounded نصtext-white"
                                    min={0} max={10} step={0.1}
                                />
                                <span>s</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleFireToggle}
                            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded border transition-colors ${isFiring
                                ? 'bg-red-900/30 hover:bg-red-900/50 text-red-200 border-red-800/50 animate-pulse'
                                : 'bg-orange-900/30 hover:bg-orange-900/50 text-orange-200 border-orange-800/50'
                                }`}
                        >
                            {isFiring ? <Square size={16} /> : <Flame size={16} />}
                            <span>{isFiring && pulseDuration > 0 ? 'Firing...' : (isFiring ? 'Stop' : 'Fire')}</span>
                        </button>
                        <button
                            onClick={onFrame}
                            disabled={!hasGcode}
                            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded border transition-colors ${hasGcode ? 'bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-200 border-cyan-800/50' : 'bg-gray-800/30 text-gray-600 border-gray-800 opacity-50 cursor-not-allowed'}`}
                        >
                            <Scan size={16} />
                            <span>Frame</span>
                        </button>
                    </div>

                    <button
                        onClick={() => setShowProbe(!showProbe)}
                        className="col-span-2 flex items-center justify-center gap-2 p-2 bg-purple-900/30 hover:bg-purple-900/50 text-purple-200 rounded border border-purple-800/50 transition-colors mt-2"
                    >
                        <ArrowDownToLine size={16} />
                        <span>Z-Probe Wizard</span>
                    </button>
                </div>

                {/* Probe Modal */}
                {showProbe && (
                    <div className="col-span-2 bg-black/50 p-4 rounded border border-purple-500/30 space-y-3">
                        <p className="text-xs text-purple-300 flex items-center gap-1">
                            <TriangleAlert size={12} />
                            Ensure probe plate is connected!
                        </p>

                        <div className="bg-black/40 p-2 rounded text-xs flex justify-between items-center">
                            <span className="text-gray-400">Probe Signal:</span>
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${status.ports?.includes('P') || status.ports?.includes('Z') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/10 text-red-500'}`}>
                                <Activity size={10} />
                                <span>{status.ports?.includes('P') || status.ports?.includes('Z') ? 'TRIGGERED' : 'OPEN'}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <label className="block text-gray-500">Plate (mm)</label>
                                <input
                                    type="number"
                                    value={plateThickness}
                                    onChange={(e) => setPlateThickness(Number(e.target.value))}
                                    className="w-full bg-black/50 border border-gray-700 rounded p-1 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-500">Retract (mm)</label>
                                <input
                                    type="number"
                                    value={retract}
                                    onChange={(e) => setRetract(Number(e.target.value))}
                                    className="w-full bg-black/50 border border-gray-700 rounded p-1 text-white"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-gray-500">Max Dist (mm)</label>
                                <input
                                    type="number"
                                    value={dist}
                                    onChange={(e) => setDist(Number(e.target.value))}
                                    className="w-full bg-black/50 border border-gray-700 rounded p-1 text-white"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleProbeStart}
                            className="w-full py-2 bg-[var(--accent-color)] hover:bg-cyan-600 text-white rounded font-medium text-xs shadow-lg shadow-cyan-900/20"
                        >
                            Start Probe Sequence
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MacroPanel;
