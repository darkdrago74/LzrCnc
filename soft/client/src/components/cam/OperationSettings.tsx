import React from 'react';
import type { CamOperation } from './interfaces';

interface Props {
    operation: CamOperation;
    onChange: (op: CamOperation) => void;
}

export const OperationSettings: React.FC<Props> = ({ operation, onChange }) => {

    const updateSetting = (key: string, value: any) => {
        onChange({
            ...operation,
            settings: { ...operation.settings, [key]: value }
        });
    };

    return (
        <div className="bg-white/5 rounded p-4 text-white">
            <h3 className="text-lg font-bold mb-4 capitalize">{operation.type.replace('_', ' ')} Settings</h3>

            <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                    <label className="text-xs text-gray-400 mb-1">Laser Power (%)</label>
                    <input
                        type="range" min="0" max="100"
                        value={operation.settings.power || 0}
                        onChange={(e) => updateSetting('power', parseInt(e.target.value))}
                        className="w-full"
                    />
                    <span className="text-right text-sm">{operation.settings.power}%</span>
                </div>

                <div className="flex flex-col">
                    <label className="text-xs text-gray-400 mb-1">Feed Rate (mm/min)</label>
                    <input
                        type="number"
                        value={operation.settings.speed || 1000}
                        onChange={(e) => updateSetting('speed', parseInt(e.target.value))}
                        className="bg-black/20 border border-white/10 rounded px-2 py-1"
                    />
                </div>

                <div className="flex flex-col">
                    <label className="text-xs text-gray-400 mb-1">Passes</label>
                    <input
                        type="number" min="1" max="10"
                        value={operation.settings.passes || 1}
                        onChange={(e) => updateSetting('passes', parseInt(e.target.value))}
                        className="bg-black/20 border border-white/10 rounded px-2 py-1"
                    />
                </div>

                {operation.type === 'raster' && (
                    <>
                        <div className="col-span-2 border-t border-white/10 pt-4 mt-2">
                            <h4 className="text-sm font-bold mb-2">Raster Mode</h4>
                            <div className="flex gap-4">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="mode"
                                        checked={operation.settings.mode === 'grayscale'}
                                        onChange={() => updateSetting('mode', 'grayscale')}
                                    /> Grayscale
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="mode"
                                        checked={operation.settings.mode === 'dither'}
                                        onChange={() => updateSetting('mode', 'dither')}
                                    /> Dithering (1-bit)
                                </label>
                            </div>
                        </div>

                        {operation.settings.mode === 'dither' && (
                            <div className="col-span-2">
                                <label className="text-xs text-gray-400 mb-1">White Threshold (Clip)</label>
                                <input
                                    type="range" min="0" max="255"
                                    value={operation.settings.threshold || 250}
                                    onChange={(e) => updateSetting('threshold', parseInt(e.target.value))}
                                    className="w-full"
                                />
                                <span className="text-right text-sm">{operation.settings.threshold} / 255</span>
                                <p className="text-xs text-gray-500 mt-1">Pixels brighter than this will be pure white (no dots)</p>
                            </div>
                        )}

                        <div className="col-span-2">
                            <label className="text-xs text-gray-400 mb-1">Overscan (mm)</label>
                            <input
                                type="number"
                                value={operation.settings.overscan || 2}
                                onChange={(e) => updateSetting('overscan', parseFloat(e.target.value))}
                                className="bg-black/20 border border-white/10 rounded px-2 py-1 w-20"
                            />
                        </div>
                    </>
                )}

                {(operation.type === 'vector_cut' || operation.type === 'vector_engrave') && (
                    <div className="col-span-2">
                        <label className="text-xs text-gray-400 mb-1">Turd Size (Speckle Removal)</label>
                        <input
                            type="range" min="0" max="100"
                            value={operation.settings.turdSize || 2}
                            onChange={(e) => updateSetting('turdSize', parseInt(e.target.value))}
                            className="w-full"
                        />
                        <span className="text-right text-sm">{operation.settings.turdSize} px</span>
                    </div>
                )}
            </div>
        </div>
    );
};
