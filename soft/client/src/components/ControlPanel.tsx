import React from 'react';
import { Move, Home } from 'lucide-react';
import type { MachineStatus } from '../types';

interface ControlPanelProps {
    status: MachineStatus;
    onJog: (axis: 'x' | 'y' | 'z', dist: number, feedrate: number) => void;
    onHome: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ status, onJog, onHome }) => {
    const [step, setStep] = React.useState(10);
    const [feed, setFeed] = React.useState(1000);

    const jog = (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
        onJog(axis, dir * step, feed);
    };

    return (
        <div className="glass-panel p-6">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2 text-accent">
                    <Move size={20} className="text-[var(--accent-color)]" />
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">Control</h2>
                </div>
                <div className="flex gap-2 text-xs font-mono bg-black/30 p-2 rounded">
                    <div className="px-2 border-r border-white/10"><span className="text-gray-400">X:</span> {status.pos.x.toFixed(2)}</div>
                    <div className="px-2 border-r border-white/10"><span className="text-gray-400">Y:</span> {status.pos.y.toFixed(2)}</div>
                    <div className="px-2"><span className="text-gray-400">Z:</span> {status.pos.z.toFixed(2)}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
                {/* XY Pad */}
                <div className="flex flex-col items-center gap-2">
                    <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] hover:border-[var(--accent-color)] border border-transparent transition-all" onClick={() => jog('y', 1)}>Y+</button>
                    <div className="flex gap-2">
                        <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] hover:border-[var(--accent-color)] border border-transparent transition-all" onClick={() => jog('x', -1)}>X-</button>
                        <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[var(--accent-color)] text-white hover:text-white border border-transparent flex items-center justify-center transition-all bg-[rgba(255,255,255,0.1)]" onClick={onHome}>
                            <Home size={20} />
                        </button>
                        <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] hover:border-[var(--accent-color)] border border-transparent transition-all" onClick={() => jog('x', 1)}>X+</button>
                    </div>
                    <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] hover:border-[var(--accent-color)] border border-transparent transition-all" onClick={() => jog('y', -1)}>Y-</button>
                </div>

                {/* Z & Settings */}
                <div className="flex flex-col gap-4">
                    <div className="flex justify-center gap-2">
                        <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] border border-transparent" onClick={() => jog('z', 1)}>Z+</button>
                        <button className="w-12 h-12 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(6,182,212,0.2)] border border-transparent" onClick={() => jog('z', -1)}>Z-</button>
                    </div>

                    <div className="space-y-2 mt-2">
                        <div>
                            <label className="label text-xs">Step Size (mm)</label>
                            <div className="flex gap-1">
                                {[0.1, 1, 10, 50].map(val => (
                                    <button
                                        key={val}
                                        onClick={() => setStep(val)}
                                        className={`flex-1 text-xs py-1 rounded border ${step === val ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-white/5'}`}
                                    >
                                        {val}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="label text-xs">Feed Rate (mm/min)</label>
                            <input
                                type="range"
                                min="100" max="5000" step="100"
                                value={feed}
                                onChange={(e) => setFeed(Number(e.target.value))}
                                className="w-full accent-[var(--accent-color)] h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="text-right text-xs text-[var(--accent-color)]">{feed}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
