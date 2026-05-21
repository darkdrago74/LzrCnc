import React, { useState } from 'react';
import { Settings, Link, Wifi } from 'lucide-react';
import type { MachineStatus } from '../types';

interface ConnectionPanelProps {
    status: MachineStatus;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onConnect: (type: 'grbl' | 'klipper', config: any) => void;
    onDisconnect: () => void;
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ status, onConnect, onDisconnect }) => {
    const [mode, setMode] = useState<'grbl' | 'klipper'>('grbl');
    const [port, setPort] = useState('/dev/ttyUSB0');
    const [baud, setBaud] = useState(115200);
    const [host, setHost] = useState('192.168.1.100');
    const [availablePorts, setAvailablePorts] = useState<string[]>([]);
    const [isLoadingPorts, setIsLoadingPorts] = useState(false);

    const fetchPorts = async () => {
        setIsLoadingPorts(true);
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const res = await fetch(`${API_URL}/api/ports`);
            if (res.ok) {
                const data = await res.json();
                if (data.ports && data.ports.length > 0) {
                    setAvailablePorts(data.ports);
                    // Only auto-select if current port is not in the new list or empty
                    if (!data.ports.includes(port)) {
                        setPort(data.ports[0]);
                    }
                } else {
                    setAvailablePorts([]);
                }
            }
        } catch (err) {
            console.error('Failed to fetch ports', err);
        } finally {
            setIsLoadingPorts(false);
        }
    };

    React.useEffect(() => {
        fetchPorts();
    }, []);

    const isConnected = status.state !== 'Disconnected';

    const handleConnect = () => {
        if (mode === 'grbl') {
            onConnect('grbl', { port, baud });
        } else {
            onConnect('klipper', { host });
        }
    };

    return (
        <div className="glass-panel p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-4 text-accent">
                <Settings size={20} className="text-[var(--accent-color)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Connection</h2>
            </div>

            <div className="flex gap-2 mb-4 bg-[rgba(15,23,42,0.5)] p-1 rounded-lg">
                <button
                    className={`flex-1 py-1 text-sm rounded ${mode === 'grbl' ? 'bg-[var(--accent-color)] text-white' : 'text-[var(--text-secondary)] hover:text-white'}`}
                    onClick={() => setMode('grbl')}
                    disabled={isConnected}
                >
                    GRBL (Serial)
                </button>
                <button
                    className={`flex-1 py-1 text-sm rounded ${mode === 'klipper' ? 'bg-[var(--accent-color)] text-white' : 'text-[var(--text-secondary)] hover:text-white'}`}
                    onClick={() => setMode('klipper')}
                    disabled={isConnected}
                >
                    Klipper (Net)
                </button>
            </div>

            <div className="space-y-4">
                {mode === 'grbl' ? (
                    <>
                        <div>
                            <label className="label">Serial Port</label>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 flex items-center gap-2 bg-[rgba(15,23,42,0.5)] rounded-md px-2 border border-[var(--border-color)]">
                                    <Link size={16} className="text-[var(--text-secondary)]" />
                                    {isLoadingPorts ? (
                                        <span className="text-sm text-[var(--text-secondary)] py-2 w-full">Scanning...</span>
                                    ) : availablePorts.length > 0 ? (
                                        <select
                                            value={port}
                                            onChange={(e) => setPort(e.target.value)}
                                            className="bg-transparent border-none text-[var(--text-primary)] w-full py-2 focus:outline-none [&>option]:bg-[#1e293b]"
                                            disabled={isConnected}
                                        >
                                            {availablePorts.map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={port}
                                            onChange={(e) => setPort(e.target.value)}
                                            className="bg-transparent border-none text-[var(--text-primary)] w-full py-2 focus:outline-none"
                                            disabled={isConnected}
                                            placeholder="/dev/ttyUSB0 or COM3"
                                        />
                                    )}
                                </div>
                                <button 
                                    onClick={fetchPorts}
                                    disabled={isConnected || isLoadingPorts}
                                    className="p-2 bg-[rgba(15,23,42,0.5)] border border-[var(--border-color)] rounded-md text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent-color)] transition-colors disabled:opacity-50"
                                    title="Rescan USB Ports"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isLoadingPorts ? "animate-spin" : ""}>
                                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                        <path d="M3 3v5h5"></path>
                                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                                        <path d="M16 21v-5h5"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="label">Baud Rate</label>
                            <select
                                value={baud}
                                onChange={(e) => setBaud(Number(e.target.value))}
                                className="input-field"
                                disabled={isConnected}
                            >
                                <option value={115200}>115200</option>
                                <option value={250000}>250000</option>
                                <option value={9600}>9600</option>
                            </select>
                        </div>
                    </>
                ) : (
                    <div>
                        <label className="label">IP Address / Hostname</label>
                        <div className="flex items-center gap-2 bg-[rgba(15,23,42,0.5)] rounded-md px-2 border border-[var(--border-color)]">
                            <Wifi size={16} className="text-[var(--text-secondary)]" />
                            <input
                                type="text"
                                value={host}
                                onChange={(e) => setHost(e.target.value)}
                                className="bg-transparent border-none text-[var(--text-primary)] w-full py-2 focus:outline-none"
                                placeholder="192.168.1.x"
                                disabled={isConnected}
                            />
                        </div>
                    </div>
                )}

                <div className="pt-2">
                    {!isConnected ? (
                        <button className="btn-primary w-full shadow-lg shadow-[rgba(6,182,212,0.2)]" onClick={handleConnect}>
                            Connect Machine
                        </button>
                    ) : (
                        <button className="w-full py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 transition-colors" onClick={onDisconnect}>
                            Disconnect
                        </button>
                    )}
                </div>

                {isConnected && (
                    <div className="flex items-center justify-center gap-2 text-xs text-green-400 mt-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                        Connected
                    </div>
                )}
            </div>
        </div>
    );
};
