import React, { useEffect, useState } from 'react';
import { Play, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import type { MachineStatus } from '../types';

interface UserMacro { id: string; name: string; gcode: string }

const STORAGE_KEY = 'lzrcnc.userMacros';

const DEFAULTS: UserMacro[] = [
    { id: 'm-home', name: 'Home', gcode: '$H' },
    { id: 'm-zero-xy', name: 'Zero XY here', gcode: 'G10 L20 P1 X0 Y0' },
    { id: 'm-zero-z', name: 'Zero Z here', gcode: 'G10 L20 P1 Z0' },
    { id: 'm-goto-zero', name: 'Go to XY zero', gcode: 'G90\nG0 X0 Y0' },
    { id: 'm-unlock', name: 'Unlock ($X)', gcode: '$X' },
];

function load(): UserMacro[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return DEFAULTS;
}

interface Props {
    status: MachineStatus;
    onCommand: (cmd: string) => Promise<void> | void;
}

const UserMacrosPanel: React.FC<Props> = ({ status, onCommand }) => {
    const [macros, setMacros] = useState<UserMacro[]>(load);
    const [editing, setEditing] = useState<UserMacro | null>(null);
    const [running, setRunning] = useState<string | null>(null);
    const busy = status.job?.state === 'running' || status.job?.state === 'paused';

    useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(macros)); }, [macros]);

    const run = async (m: UserMacro) => {
        setRunning(m.id);
        try {
            for (const line of m.gcode.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
                await onCommand(line);
            }
        } finally {
            setRunning(null);
        }
    };

    const save = () => {
        if (!editing || !editing.name.trim()) return;
        setMacros(list => list.some(m => m.id === editing.id) ? list.map(m => m.id === editing.id ? editing : m) : [...list, editing]);
        setEditing(null);
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
                {macros.map(m => (
                    <div key={m.id} className="group relative">
                        <button
                            onClick={() => run(m)}
                            disabled={busy || running !== null}
                            className="w-full text-left bg-slate-800/70 hover:bg-cyan-900/40 border border-white/10 hover:border-cyan-500/50 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-40"
                            title={m.gcode}
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                                <Play size={12} className={running === m.id ? 'text-amber-400 animate-pulse' : 'text-cyan-400'} />
                                <span className="truncate">{m.name}</span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">{m.gcode.replace(/\n/g, ' · ')}</div>
                        </button>
                        <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                            <button onClick={() => setEditing({ ...m })} className="p-1 rounded bg-slate-900/90 text-slate-400 hover:text-white" title="Edit"><Pencil size={11} /></button>
                            <button onClick={() => setMacros(list => list.filter(x => x.id !== m.id))} className="p-1 rounded bg-slate-900/90 text-slate-400 hover:text-red-400" title="Delete"><Trash2 size={11} /></button>
                        </div>
                    </div>
                ))}
            </div>

            {editing ? (
                <div className="bg-slate-900/70 border border-white/10 rounded-lg p-3 space-y-2">
                    <input
                        className="input-field"
                        placeholder="Macro name"
                        value={editing.name}
                        onChange={e => setEditing({ ...editing, name: e.target.value })}
                    />
                    <textarea
                        className="input-field font-mono text-xs h-28"
                        placeholder={'G-code, one command per line\nG0 X0 Y0'}
                        value={editing.gcode}
                        onChange={e => setEditing({ ...editing, gcode: e.target.value })}
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditing(null)} className="btn-secondary flex items-center gap-1"><X size={14} /> Cancel</button>
                        <button onClick={save} className="btn-primary flex items-center gap-1"><Check size={14} /> Save</button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setEditing({ id: `m-${Date.now()}`, name: '', gcode: '' })}
                    className="w-full border border-dashed border-white/15 hover:border-cyan-500/60 rounded-lg py-2 text-sm text-slate-400 hover:text-cyan-300 flex items-center justify-center gap-2"
                >
                    <Plus size={14} /> New macro
                </button>
            )}

            {status.macros && status.macros.length > 0 && (
                <div>
                    <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">Klipper macros</h3>
                    <div className="flex flex-wrap gap-2">
                        {status.macros.map(name => (
                            <button key={name} onClick={() => onCommand(name)} disabled={busy}
                                className="px-3 py-1.5 rounded-md bg-slate-800 border border-white/10 text-xs font-mono hover:border-cyan-500/60 disabled:opacity-40">
                                {name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserMacrosPanel;
