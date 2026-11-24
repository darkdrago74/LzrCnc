import React, { useEffect, useMemo, useState } from 'react';
import { X, Home, Crosshair, ScanLine, ShieldAlert, Play, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { MachineSettings, MachineStatus } from '../../types';
import { parseGcode, formatDuration } from '../../utils/gcodeParser';
import { getBedExtents } from '../../utils/machineGeometry';
import type { MillStock } from '../../utils/millJob';

interface JobWizardModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExecute: (setupCommands: string[]) => void;
    status: MachineStatus;
    gcodeData: string[];
    machineSettings?: MachineSettings;
    onCommand: (cmd: string) => Promise<void> | void;
    onFrame: () => Promise<void> | void;
    /** Set when the program is a milling job (XY = bed coordinates, Z0 on the stock top or bottom). */
    mill?: { stock: MillStock; zZero: 'top' | 'bottom' } | null;
}

type Origin = 'keep' | 'here';

export const JobWizardModal: React.FC<JobWizardModalProps> = ({ isOpen, onClose, onExecute, status, gcodeData, machineSettings, onFrame, mill }) => {
    const [home, setHome] = useState(false);
    const [origin, setOrigin] = useState<Origin>('keep');
    const [confirmed, setConfirmed] = useState(false);
    const [framing, setFraming] = useState(false);
    const [zHere, setZHere] = useState(false);

    const parsed = useMemo(() => (isOpen ? parseGcode(gcodeData) : null), [isOpen, gcodeData]);
    const bed = getBedExtents(machineSettings, status.limits);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen || !parsed) return null;

    const hasCuts = parsed.segments.some(s => s.kind === 'cut');
    const b = hasCuts ? parsed.cutBounds : parsed.bounds;
    // With "here" the job is placed relative to the current head position.
    // Mill jobs use bed coordinates: "here" means the head is over the stock's lower-left corner.
    const ox = origin === 'here' ? status.pos.x - (mill ? mill.stock.x : 0) : 0;
    const oy = origin === 'here' ? status.pos.y - (mill ? mill.stock.y : 0) : 0;
    const eps = 0.01;
    const outOfBed = b.min.x + ox < bed.minX - eps || b.max.x + ox > bed.maxX + eps || b.min.y + oy < bed.minY - eps || b.max.y + oy > bed.maxY + eps;
    const idle = status.state === 'Idle';

    // Zeroing "here" refers to where the head is now, so it can't be combined with homing first.
    const zeroHere = origin === 'here' || (!!mill && zHere);
    const setup: string[] = [];
    if (home && !zeroHere) setup.push('$H');
    if (origin === 'here') setup.push(mill ? `G10 L20 P1 X${mill.stock.x.toFixed(3)} Y${mill.stock.y.toFixed(3)}` : 'G10 L20 P1 X0 Y0');
    if (mill && zHere) setup.push('G10 L20 P1 Z0');

    const frame = async () => {
        setFraming(true);
        try { await onFrame(); } finally { setFraming(false); }
    };

    const run = () => {
        onExecute(setup);
        setConfirmed(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={onClose}>
            <div className="glass-panel bg-slate-900/95 w-full max-w-xl p-6 space-y-5" onMouseDown={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{mill ? 'Run milling job' : 'Run job'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                    <Info label="Size" value={`${(b.max.x - b.min.x).toFixed(1)} × ${(b.max.y - b.min.y).toFixed(1)} mm`} />
                    <Info label="Est. time" value={formatDuration(parsed.estimatedTime)} />
                    <Info label={mill ? 'Cut length' : 'Burn length'} value={`${(parsed.cutLength / 1000).toFixed(2)} m`} />
                </div>

                <section className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">1 · Position</h3>
                    <label className={`flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2 text-sm cursor-pointer ${zeroHere ? 'opacity-50' : ''}`}
                        title={zeroHere ? 'Disabled: zeroing "here" uses the current head position; homing would move the head away first.' : undefined}>
                        <input type="checkbox" checked={home && !zeroHere} disabled={zeroHere} onChange={e => setHome(e.target.checked)} />
                        <Home size={14} className="text-cyan-300" /> Home the machine first ($H)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <OriginButton active={origin === 'keep'} onClick={() => setOrigin('keep')} title="Use current work zero" text="Job coordinates are used as-is." />
                        <OriginButton active={origin === 'here'} onClick={() => setOrigin('here')} title="Start from head position"
                            text={mill ? `Head is over the stock's lower-left corner → sets it to X${mill.stock.x} Y${mill.stock.y}.` : 'Sets X0 Y0 at the current laser position.'} icon />
                    </div>
                    {mill && (
                        <label className="flex items-start gap-3 bg-white/5 rounded-lg px-3 py-2 text-sm cursor-pointer">
                            <input type="checkbox" className="mt-1" checked={zHere} onChange={e => setZHere(e.target.checked)} />
                            <span>Set Z0 here<span className="block text-[11px] text-gray-400">{mill.zZero === 'bottom'
                                ? `This program uses Z0 on the stock BOTTOM: the tool tip is touching the bed / spoilboard next to the stock right now.`
                                : `The tool tip is touching the top of the ${mill.stock.thickness} mm stock right now.`} Leave unchecked if Z0 is already set (probe / CNC tab).</span></span>
                        </label>
                    )}
                    <div className={`flex items-center gap-2 text-xs ${outOfBed ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {outOfBed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                        {outOfBed
                            ? `Job spans X${(b.min.x + ox).toFixed(0)}…${(b.max.x + ox).toFixed(0)} Y${(b.min.y + oy).toFixed(0)}…${(b.max.y + oy).toFixed(0)}, outside the ${bed.width}×${bed.height} mm bed.`
                            : 'Job fits inside the work area.'}
                    </div>
                </section>

                <section className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">2 · Check</h3>
                    <button onClick={frame} disabled={!idle || framing || origin === 'here'} className="btn-secondary text-sm flex items-center gap-2 w-full justify-center"
                        title={origin === 'here' ? 'Framing uses the current work zero; choose "Use current work zero" to frame first.' : mill ? 'Lift to safe Z and trace the job outline with the spindle off' : 'Trace the job outline with the laser off'}>
                        <ScanLine size={14} /> {framing ? 'Framing…' : mill ? 'Frame job outline (spindle off, safe Z)' : 'Frame job outline (laser off)'}
                    </button>
                    <label className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-100 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                        <span><ShieldAlert size={14} className="inline mr-1 text-amber-300" />{mill
                            ? `Stock is clamped and clamps are clear of the toolpath, the bit is tight in the collet, Z0 is on the stock ${mill.zZero === 'bottom' ? 'bottom (bed / spoilboard)' : 'top'}, GRBL is in spindle mode ($32=0), dust extraction is on, and eye & hearing protection are worn.`
                            : 'Laser is focused, material is secured, eye protection is worn, and someone will watch the machine for the whole job.'}</span>
                    </label>
                </section>

                <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-gray-500">{idle ? 'Machine ready' : `Machine state: ${status.state}`}</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                        <button onClick={run} disabled={!confirmed || !idle || gcodeData.length === 0} className="btn-primary text-sm flex items-center gap-2">
                            <Play size={14} /> Start
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="bg-black/30 border border-white/5 rounded-lg px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
        <div className="font-mono text-gray-100">{value}</div>
    </div>
);

const OriginButton: React.FC<{ active: boolean; onClick: () => void; title: string; text: string; icon?: boolean }> = ({ active, onClick, title, text, icon }) => (
    <button onClick={onClick} className={`text-left rounded-lg px-3 py-2 border transition-colors ${active ? 'border-cyan-500/70 bg-cyan-500/10' : 'border-white/10 hover:bg-white/5'}`}>
        <div className="text-sm font-semibold flex items-center gap-1.5">{icon && <Crosshair size={13} className="text-cyan-300" />}{title}</div>
        <div className="text-[11px] text-gray-400">{text}</div>
    </button>
);
