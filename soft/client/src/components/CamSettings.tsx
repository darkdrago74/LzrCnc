import React, { useState, useEffect } from 'react';
import type { VectorOptions, LaserTool } from '../types';

interface CamSettingsProps {
    fileType: 'vector' | 'raster';
    onOptionsChanged: (options: VectorOptions) => void;
}

// Default Tool
const defaultLaser: LaserTool = {
    id: 'default',
    name: 'Generic Laser',
    units: 'mm',
    type: 'laser',
    spotSize: 0.1,
    powerMax: 1000
};

const CamSettings: React.FC<CamSettingsProps> = ({ fileType, onOptionsChanged }) => {
    const [feedrate, setFeedrate] = useState(1500);
    const [powerMax, setPowerMax] = useState(1000);
    const [spotSize, setSpotSize] = useState(0.1);

    useEffect(() => {
        // Debounce or just update on change
        const tool: LaserTool = { ...defaultLaser, spotSize, powerMax };
        const options: VectorOptions = {
            tool,
            format: 'svg', // Hardcoded for now, auto-detect later
            feedrate
        };
        onOptionsChanged(options);
    }, [feedrate, powerMax, spotSize, fileType, onOptionsChanged]);

    return (
        <div style={{ padding: '10px', background: '#222', borderRadius: '4px' }}>
            <h3>Settings ({fileType})</h3>

            <div style={{ marginBottom: '10px' }}>
                <label>Feedrate (mm/min)</label>
                <input
                    type="number"
                    value={feedrate}
                    onChange={(e) => setFeedrate(Number(e.target.value))}
                    style={{ width: '100%', padding: '5px' }}
                />
            </div>

            <div style={{ marginBottom: '10px' }}>
                <label>Laser Power Max (S-Value)</label>
                <input
                    type="number"
                    value={powerMax}
                    onChange={(e) => setPowerMax(Number(e.target.value))}
                    style={{ width: '100%', padding: '5px' }}
                />
            </div>

            <div style={{ marginBottom: '10px' }}>
                <label>Spot Size (mm)</label>
                <input
                    type="number"
                    step="0.05"
                    value={spotSize}
                    onChange={(e) => setSpotSize(Number(e.target.value))}
                    style={{ width: '100%', padding: '5px' }}
                />
            </div>
        </div>
    );
};

export default CamSettings;
