import React, { useState, useEffect } from 'react';
import { MaterialLibrary, type MaterialPreset } from '../utils/MaterialLibrary';

interface Props {
    onGenerate: (gcode: string) => void;
}

const TestGeneratorPanel: React.FC<Props> = ({ onGenerate }) => {
    const [testType, setTestType] = useState<'power_ramp' | 'focus_z' | 'vector_quality'>('power_ramp');

    // Machine / Focus Configuration
    const [baseFocusZ, setBaseFocusZ] = useState<number>(-60); // Z-height where laser is focused on the BED
    const [materialThickness, setMaterialThickness] = useState<number>(3); // mm
    const [safeZ, setSafeZ] = useState<number | null>(5); // Z-height for rapid moves (above material)

    // Manual / Preset Mode
    const [useLibrary, setUseLibrary] = useState(false);
    const [presets, setPresets] = useState<MaterialPreset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');

    // Power Ramp Settings
    const [minPower, setMinPower] = useState(10);
    const [maxPower, setMaxPower] = useState(100);
    const [limitMaxPower, setLimitMaxPower] = useState<number>(100); // Absolute safety limit
    const [steps, setSteps] = useState(10);
    const [speed, setSpeed] = useState(1000);

    // Focus Z Settings (Ladder Test)
    const [zStart, setZStart] = useState(-65);
    const [zEnd, setZEnd] = useState(-30);
    const [zSteps, setZSteps] = useState(10);

    useEffect(() => {
        const loadPresets = async () => {
            const mats = await MaterialLibrary.getAll();
            setPresets(mats);
        };
        void loadPresets();
    }, []);

    const handlePresetChange = (id: string) => {
        setSelectedPresetId(id);
        const preset = presets.find(p => p.id === id);
        if (preset) {
            setMaterialThickness(preset.thickness);
            setSpeed(preset.speed);
            // setMaxPower(preset.power); // Optional: override max power?
        }
    };

    // Helper: Calculate Working Z
    const getWorkingZ = () => {
        return baseFocusZ + materialThickness;
    };

    const generatePowerRamp = () => {
        const workingZ = getWorkingZ();
        const safeZAbs = safeZ !== null ? workingZ + safeZ : null;

        const lines: string[] = [];
        lines.push(`; Power Ramp Test`);
        lines.push(`; Material Thickness: ${materialThickness}mm`);
        lines.push(`; Working Z: ${workingZ.toFixed(2)}`);
        lines.push('G21 G90');
        lines.push('M5');
        if (safeZAbs !== null) lines.push(`G0 Z${safeZAbs.toFixed(2)}`); // Go to Safe Z

        const stepWidth = 10;
        const stepHeight = 10;
        const powerStep = (maxPower - minPower) / (steps - 1);

        for (let i = 0; i < steps; i++) {
            let power = minPower + (i * powerStep);
            if (power > limitMaxPower) power = limitMaxPower;

            const x = i * (stepWidth + 2);

            // Move to start of block
            lines.push(`G0 X${x} Y0`);
            lines.push(`G0 Z${workingZ.toFixed(2)}`); // Lower to working Z

            // Raster block (Zigzag)
            const fillDensity = 0.5;
            const yLines = Math.floor(stepHeight / fillDensity);
            const sVal = Math.floor((power / 100) * 1000);

            for (let j = 0; j < yLines; j++) {
                const y = j * fillDensity;
                lines.push(`G0 X${x} Y${y}`);
                lines.push(`G1 X${x + stepWidth} Y${y} S${sVal} F${speed}`);
                lines.push('M5');
            }
            if (safeZAbs !== null) lines.push(`G0 Z${safeZAbs.toFixed(2)}`); // Lift
        }

        lines.push('G0 X0 Y0');
        onGenerate(lines.join('\n'));
    };

    const generateFocusTest = () => {
        const lines: string[] = [];
        lines.push('; Focus Z-Ladder Test');
        lines.push(`; Range: ${zStart} to ${zEnd}`);
        lines.push('G21 G90');
        lines.push('M5');

        const zStepSize = (zEnd - zStart) / (zSteps - 1);
        const lineLength = 20;
        const lineSpacing = 5;

        for (let i = 0; i < zSteps; i++) {
            const z = zStart + (i * zStepSize);
            const y = i * lineSpacing;

            lines.push(`G0 Z${z.toFixed(2)}`);
            lines.push(`G0 X0 Y${y}`);
            lines.push(`G1 X${lineLength} Y${y} S1000 F${speed}`);
            lines.push('M5');
        }

        lines.push('G0 Z0');
        lines.push('G0 X0 Y0');
        onGenerate(lines.join('\n'));
    };

    const generateVectorQuality = () => {
        const workingZ = getWorkingZ();
        const safeZAbs = safeZ !== null ? workingZ + safeZ : null;

        const lines: string[] = [];
        lines.push('; Vector Quality Test');
        lines.push(`; Working Z: ${workingZ.toFixed(2)}`);
        lines.push('G21 G90');
        if (safeZAbs !== null) lines.push(`G0 Z${safeZAbs.toFixed(2)}`);

        // Shapes...
        const cx = 20, cy = 20, r = 15;

        lines.push(`G0 X${cx + r} Y${cy}`);
        lines.push(`G0 Z${workingZ.toFixed(2)}`);
        lines.push('M3 S1000');
        lines.push(`G2 X${cx - r} Y${cy} R${r} F${speed}`);
        lines.push(`G2 X${cx + r} Y${cy} R${r} F${speed}`);
        lines.push('M5');
        if (safeZAbs !== null) lines.push(`G0 Z${safeZAbs.toFixed(2)}`);

        // Square
        lines.push('G0 X40 Y40');
        lines.push(`G0 Z${workingZ.toFixed(2)}`);
        lines.push('M3 S1000');
        lines.push(`G1 X60 Y40 F${speed}`);
        lines.push(`G1 X60 Y60`);
        lines.push(`G1 X40 Y60`);
        lines.push(`G1 X40 Y40`);
        lines.push('M5');
        if (safeZAbs !== null) lines.push(`G0 Z${safeZAbs.toFixed(2)}`);

        lines.push('G0 X0 Y0');
        onGenerate(lines.join('\n'));
    };

    return (
        <div className="grid grid-cols-1 gap-6 p-4 text-sm">
            {/* Header / Tabs */}
            <div className="flex gap-2 mb-2">
                <button onClick={() => setTestType('power_ramp')} className={`flex-1 px-3 py-2 rounded ${testType === 'power_ramp' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}>Power Scale</button>
                <button onClick={() => setTestType('focus_z')} className={`flex-1 px-3 py-2 rounded ${testType === 'focus_z' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}>Focus Z-Ladder</button>
                <button onClick={() => setTestType('vector_quality')} className={`flex-1 px-3 py-2 rounded ${testType === 'vector_quality' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}>Vector Quality</button>
            </div>

            {/* Global Settings Section (For Z calc) */}
            <div className="bg-white/5 p-4 rounded border border-white/10">
                <h4 className="text-orange-400 font-bold mb-3 uppercase text-xs tracking-wider">Calibration & Material</h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-gray-400 text-xs mb-1" title="Z-Height where laser is focused on the bed surface">Base Focus Z (Bed)</label>
                        <input type="number" value={baseFocusZ} onChange={e => setBaseFocusZ(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <input
                                type="checkbox"
                                checked={safeZ !== null}
                                onChange={e => setSafeZ(e.target.checked ? 5 : null)}
                                className="rounded bg-white/10 border-white/20"
                            />
                            <label className="block text-gray-400 text-xs">Safe Z (Rapid)</label>
                        </div>
                        {safeZ !== null && (
                            <input type="number" value={safeZ} onChange={e => setSafeZ(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        )}
                    </div>
                </div>

                <div className="mt-3 pt-3 border-t border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" checked={useLibrary} onChange={e => setUseLibrary(e.target.checked)} className="rounded bg-white/10 border-white/20" />
                        <span className="text-gray-300">Use Material Library</span>
                    </div>

                    {useLibrary ? (
                        <select
                            value={selectedPresetId}
                            onChange={e => handlePresetChange(e.target.value)}
                            className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full"
                        >
                            <option value="">-- Select Material --</option>
                            {presets.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.thickness}mm)</option>
                            ))}
                        </select>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Material Thickness (mm)</label>
                                <input type="number" value={materialThickness} onChange={e => setMaterialThickness(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Max Power Limit (%)</label>
                                <input type="number" value={limitMaxPower} onChange={e => setLimitMaxPower(Number(e.target.value))} className="bg-black/30 border border-white/10 text-red-400 px-2 py-1 rounded w-full" />
                            </div>
                        </div>
                    )}
                </div>
                <div className="mt-2 text-right">
                    <span className="text-xs text-gray-500">Calculated Working Z: </span>
                    <span className="text-sm font-mono text-green-400 font-bold">{getWorkingZ().toFixed(2)}</span>
                </div>
            </div>

            {testType === 'power_ramp' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Min Power (%)</label>
                            <input type="number" value={minPower} onChange={e => setMinPower(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Max Power (%)</label>
                            <input type="number" value={maxPower} onChange={e => setMaxPower(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Steps</label>
                            <input type="number" value={steps} onChange={e => setSteps(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Feed Rate (mm/min)</label>
                            <input type="number" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                    </div>
                    <button onClick={generatePowerRamp} className="bg-blue-600 text-white px-4 py-3 rounded font-bold hover:bg-blue-500 w-full transition-all">Generate Power Scale</button>
                </div>
            )}

            {testType === 'focus_z' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Start Z (mm)</label>
                            <input type="number" value={zStart} onChange={e => setZStart(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">End Z (mm)</label>
                            <input type="number" value={zEnd} onChange={e => setZEnd(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Steps</label>
                            <input type="number" value={zSteps} onChange={e => setZSteps(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                    </div>
                    <button onClick={generateFocusTest} className="bg-blue-600 text-white px-4 py-3 rounded font-bold hover:bg-blue-500 w-full transition-all">Generate Focus Ladder</button>
                </div>
            )}

            {testType === 'vector_quality' && (
                <div className="space-y-4">
                    <p className="text-gray-400 text-xs">Generates circles and squares to test mechanical backlash and precision.</p>
                    <div>
                        <label className="block text-gray-400 text-xs mb-1">Feed Rate (mm/min)</label>
                        <input type="number" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="bg-black/30 border border-white/10 text-white px-2 py-1 rounded w-full" />
                    </div>
                    <button onClick={generateVectorQuality} className="bg-blue-600 text-white px-4 py-3 rounded font-bold hover:bg-blue-500 w-full transition-all">Generate Vector Test</button>
                </div>
            )}
        </div>
    );
};

export default TestGeneratorPanel;
