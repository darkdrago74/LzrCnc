import React, { useState } from 'react';

interface Props {
    onGenerate: (gcode: string) => void;
}

const TestGeneratorPanel: React.FC<Props> = ({ onGenerate }) => {
    const [testType, setTestType] = useState<'power_ramp' | 'focus_z' | 'vector_quality'>('power_ramp');

    // Power Ramp Settings
    const [minPower, setMinPower] = useState(10);
    const [maxPower, setMaxPower] = useState(100);
    const [steps, setSteps] = useState(10);
    const [speed, setSpeed] = useState(1000);

    // Focus Z Settings
    const [zStart, setZStart] = useState(0);
    const [zEnd, setZEnd] = useState(5);
    const [zSteps, setZSteps] = useState(5);

    const generatePowerRamp = () => {
        const lines: string[] = [];
        lines.push('; Power Ramp Test');
        lines.push('G21 G90');
        lines.push('M5');

        const stepWidth = 10; // mm
        const stepHeight = 10; // mm
        // const startX = 0;
        // const startY = 0;

        const powerStep = (maxPower - minPower) / (steps - 1);

        for (let i = 0; i < steps; i++) {
            const power = minPower + (i * powerStep);
            const x = i * (stepWidth + 2);

            // Move to start of block
            lines.push(`G0 X${x} Y0`);

            // Raster block
            // Simple zigzag fill
            const fillDensity = 0.5; // mm per line
            const yLines = Math.floor(stepHeight / fillDensity);

            // Convert % to S-value (assuming 1000 max)
            const sVal = (power / 100) * 1000;

            for (let j = 0; j < yLines; j++) {
                const y = j * fillDensity;
                // Move to line start
                lines.push(`G0 X${x} Y${y}`);
                lines.push(`G1 X${x + stepWidth} Y${y} S${sVal.toFixed(0)} F${speed}`);
                lines.push('M5');
            }
            // Label power (mockup)
        }

        lines.push('G0 X0 Y0');
        onGenerate(lines.join('\n'));
    };

    const generateFocusTest = () => {
        const lines: string[] = [];
        lines.push('; Focus Z-Ladder Test');
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
        // Generate a star pattern or similar geometry
        const lines: string[] = [];
        lines.push('; Vector Quality Test');
        lines.push('G21 G90');
        lines.push(`F${speed}`);

        const cx = 20, cy = 20, r = 15;

        lines.push(`G0 X${cx + r} Y${cy}`);
        lines.push('M3 S1000');
        lines.push(`G2 X${cx - r} Y${cy} R${r}`); // Half circle
        lines.push(`G2 X${cx + r} Y${cy} R${r}`); // Half circle

        // Square
        lines.push('M5');
        lines.push('G0 X40 Y40');
        lines.push('M3 S1000');
        lines.push('G1 X60 Y40');
        lines.push('G1 X60 Y60');
        lines.push('G1 X40 Y60');
        lines.push('G1 X40 Y40');

        lines.push('M5');
        lines.push('G0 X0 Y0');
        onGenerate(lines.join('\n'));
    };

    return (
        <div className="grid grid-cols-1 gap-6 p-4">
            <div className="flex gap-4 mb-4">
                <button
                    onClick={() => setTestType('power_ramp')}
                    className={`px-3 py-1 rounded ${testType === 'power_ramp' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}
                >Power Scale</button>
                <button
                    onClick={() => setTestType('focus_z')}
                    className={`px-3 py-1 rounded ${testType === 'focus_z' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}
                >Focus Z-Ladder</button>
                <button
                    onClick={() => setTestType('vector_quality')}
                    className={`px-3 py-1 rounded ${testType === 'vector_quality' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}
                >Vector Quality</button>
            </div>

            {testType === 'power_ramp' && (
                <div className="space-y-4">
                    <h3 className="text-white font-bold">Power Scale Generator</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-400 text-sm">Min Power (%)</label>
                            <input type="number" value={minPower} onChange={e => setMinPower(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm">Max Power (%)</label>
                            <input type="number" value={maxPower} onChange={e => setMaxPower(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm">Steps</label>
                            <input type="number" value={steps} onChange={e => setSteps(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm">Feed Rate</label>
                            <input type="number" value={speed} onChange={e => setSpeed(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                    </div>
                    <button onClick={generatePowerRamp} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 w-full">Generate G-Code</button>
                </div>
            )}

            {testType === 'focus_z' && (
                <div className="space-y-4">
                    <h3 className="text-white font-bold">Focus Z-Ladder Generator</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-gray-400 text-sm">Start Z (mm)</label>
                            <input type="number" value={zStart} onChange={e => setZStart(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm">End Z (mm)</label>
                            <input type="number" value={zEnd} onChange={e => setZEnd(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                        <div>
                            <label className="block text-gray-400 text-sm">Steps</label>
                            <input type="number" value={zSteps} onChange={e => setZSteps(Number(e.target.value))} className="bg-black/20 border border-white/10 text-white px-2 py-1 rounded w-full" />
                        </div>
                    </div>
                    <button onClick={generateFocusTest} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 w-full">Generate G-Code</button>
                </div>
            )}

            {testType === 'vector_quality' && (
                <div className="space-y-4">
                    <h3 className="text-white font-bold">Vector Quality Test</h3>
                    <p className="text-gray-400 text-sm">Generates circles and squares to test mechanical backlash and precision.</p>
                    <button onClick={generateVectorQuality} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 w-full">Generate G-Code</button>
                </div>
            )}
        </div>
    );
};

export default TestGeneratorPanel;
