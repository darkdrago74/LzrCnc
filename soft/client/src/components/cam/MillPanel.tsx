/**
 * Mill tab: stock setup → contour selection → operations (face / pocket / profile) → generate,
 * review warnings, simulate material removal.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Info, Layers, Pause, Play, Plus, Trash2, XCircle, Drill, Box } from 'lucide-react';
import { apiGet } from '../../api';
import { HelpIcon } from '../ui/Tooltip';
import {
    DEFAULT_TOOL, MATERIALS, chipLoad, defaultMillOp, opDepth, suggestFeeds,
    type MillContour, type MillOp, type MillOpType, type MillResult, type MillStock, type MillTool, type CutSide,
} from '../../utils/millJob';
import { formatDuration } from '../../utils/gcodeParser';

export interface MillController {
    stock: MillStock;
    setStock: (s: MillStock) => void;
    ops: MillOp[];
    setOps: React.Dispatch<React.SetStateAction<MillOp[]>>;
    contours: MillContour[];
    selectedContourIds: string[];
    setSelectedContourIds: (ids: string[]) => void;
    result: MillResult | null;
    loading: boolean;
    generate: () => void;
    sendToJob: () => void;
    simEnabled: boolean;
    setSimEnabled: (v: boolean) => void;
    simProgress: number;
    setSimProgress: (v: number) => void;
    simBusy?: boolean;
    /** Area swept by the tool (incl. radius) of the computed toolpaths, in bed mm. */
    cutArea?: { minX: number; minY: number; maxX: number; maxY: number } | null;
    /** Machine connected, idle and not running a job. */
    machineReady?: boolean;
    machineState?: string;
    sendCommands?: (cmds: string[]) => Promise<void>;
}

const num = (v: string, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };

const Field: React.FC<{ label: string; unit?: string; help?: string; value: number; step?: number; min?: number; onChange: (v: number) => void; warn?: boolean }> = ({ label, unit, help, value, step = 0.1, min, onChange, warn }) => (
    <label className="block">
        <span className="text-gray-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1">{label}{help && <HelpIcon text={help} />}</span>
        <span className="relative block">
            <input type="number" step={step} min={min} value={Number.isFinite(value) ? value : ''} onChange={e => onChange(num(e.target.value, value))}
                className={`w-full bg-black/50 border rounded-lg px-2 py-1.5 text-white text-xs font-mono focus:outline-none pr-12 ${warn ? 'border-amber-500/70' : 'border-white/10 focus:border-emerald-500/50'}`} />
            {unit && <span className="absolute right-2 top-1.5 text-gray-600 text-[10px] pointer-events-none">{unit}</span>}
        </span>
    </label>
);

const Card: React.FC<{ title: string; color?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, color = 'text-emerald-400', right, children }) => (
    <div className="glass-panel p-4 rounded-xl border border-white/10">
        <div className="flex items-center justify-between mb-3">
            <h3 className={`${color} font-bold uppercase text-[10px] tracking-[0.2em]`}>{title}</h3>
            {right}
        </div>
        {children}
    </div>
);

const TYPE_INFO: Record<MillOpType, { label: string; badge: string; help: string }> = {
    face: { label: 'Facing', badge: 'bg-violet-900/60 text-violet-300', help: 'Flattens the whole stock top (zig-zag), lowering the surface by the depth. Use it to get a flat, parallel reference surface.' },
    pocket: { label: 'Pocket', badge: 'bg-cyan-900/60 text-cyan-300', help: 'Clears all material inside the selected closed contours (inner contours are kept as islands).' },
    profile: { label: 'Profile', badge: 'bg-orange-900/60 text-orange-300', help: 'Follows the contour: outside (cut a part out), inside (cut a hole) or on the line (engrave / open paths).' },
};

const SIDE_LABEL: Record<CutSide, string> = { outside: 'Outside', inside: 'Inside', on: 'On line' };

export const MillPanel: React.FC<{ mill: MillController; onOpenTools?: () => void }> = ({ mill, onOpenTools }) => {
    const { stock, setStock, ops, setOps, contours, selectedContourIds, setSelectedContourIds, result } = mill;
    const [tools, setTools] = useState<(MillTool & { id: string })[]>([]);
    const [toolId, setToolId] = useState<string>('');
    const [editId, setEditId] = useState<string | null>(ops[0]?.id ?? null);
    const [playing, setPlaying] = useState(false);
    const progressRef = React.useRef(mill.simProgress);
    progressRef.current = mill.simProgress;

    useEffect(() => {
        if (!playing || !mill.simEnabled) return;
        const t = setInterval(() => {
            const next = Math.min(1, progressRef.current + 0.01);
            mill.setSimProgress(next);
            if (next >= 1) setPlaying(false);
        }, 120);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, mill.simEnabled]);

    useEffect(() => {
        apiGet<(MillTool & { id: string })[]>('/api/tools').then(t => {
            const list = Array.isArray(t) ? t.filter(x => x && x.diameter > 0) : [];
            setTools(list);
            if (list.length && !toolId) {
                const flats = list.filter(x => x.type === 'endmill').sort((a, b) => Math.abs(a.diameter - 6) - Math.abs(b.diameter - 6));
                setToolId((flats[0] ?? list[0]).id);
            }
        }).catch(() => setTools([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentTool: MillTool = tools.find(t => t.id === toolId) ?? DEFAULT_TOOL;
    const editing = ops.find(o => o.id === editId) ?? null;
    const contourName = useMemo(() => new Map(contours.map(c => [c.id, c.name])), [contours]);

    const update = (id: string, patch: Partial<MillOp>) => setOps(list => list.map(o => o.id === id ? { ...o, ...patch } : o));

    const addOp = (type: MillOpType) => {
        if (type !== 'face' && selectedContourIds.length === 0) {
            alert('Select one or more contours first (click them in the 3D view or in the list).');
            return;
        }
        const op = defaultMillOp(type, currentTool, stock, type === 'face' ? [] : [...selectedContourIds], ops.length + 1, ops);
        setOps(list => [...list, op]);
        setEditId(op.id);
    };

    const move = (id: string, dir: -1 | 1) => setOps(list => {
        const i = list.findIndex(o => o.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
    });

    const toggleContour = (id: string) => setSelectedContourIds(selectedContourIds.includes(id) ? selectedContourIds.filter(x => x !== id) : [...selectedContourIds, id]);

    /** Example from the docs: 13 mm board, face 4 mm, cut an 8 mm square part out leaving a 1 mm skin. */
    const loadExample = () => {
        const closed = contours.filter(c => c.closed);
        const t = currentTool;
        const s: MillStock = { ...stock, material: 'Wood', thickness: 13 };
        setStock(s);
        const face = { ...defaultMillOp('face', t, s, [], 1), depth: 4, stepdown: 2, label: 'Face to 9 mm' };
        const prof: MillOp = { ...defaultMillOp('profile', t, s, closed.slice(0, 1).map(c => c.id), 2, [face]), startDepth: 4, depth: 12, depthRef: 'bottom', floor: 1, label: 'Part outline (1 mm skin)' };
        setOps(closed.length ? [face, prof] : [face]);
        setEditId(prof.id);
        if (!closed.length) alert('Facing op added. Draw or import a closed shape (e.g. a 100 × 100 rectangle on the stock) to add the outline op.');
    };

    const errors = result?.warnings.filter(w => w.level === 'error').length ?? 0;
    const opWarnings = (id: string) => result?.warnings.filter(w => w.opId === id) ?? [];
    const finalTop = stock.thickness - Math.max(0, ...ops.filter(o => o.enabled && o.type === 'face').map(o => opDepth(o, stock)));
    const zBottom = stock.zZero === 'bottom';
    /** Stock-top-relative depth → G-code Z for the chosen work zero. */
    const gz = (depthBelowTop: number) => (zBottom ? stock.thickness - depthBelowTop : -depthBelowTop);

    return (
        <div className="space-y-4">
            <Card title="1 · Stock (raw material)" color="text-amber-400">
                <div className="grid grid-cols-3 gap-2">
                    <Field label="Width X" unit="mm" value={stock.width} min={1} step={1} onChange={v => setStock({ ...stock, width: Math.max(1, v) })} />
                    <Field label="Depth Y" unit="mm" value={stock.height} min={1} step={1} onChange={v => setStock({ ...stock, height: Math.max(1, v) })} />
                    <Field label="Thickness" unit="mm" value={stock.thickness} min={0.5} step={0.5} onChange={v => setStock({ ...stock, thickness: Math.max(0.5, v) })} />
                    <Field label="Corner X" unit="mm" value={stock.x} step={1} help="Position of the stock's lower-left corner on the bed" onChange={v => setStock({ ...stock, x: v })} />
                    <Field label="Corner Y" unit="mm" value={stock.y} step={1} onChange={v => setStock({ ...stock, y: v })} />
                    <Field label="Safe Z" unit="mm" value={stock.safeZ} min={1} step={1} help="Retract height above the stock top for rapid moves (clear your clamps!)" onChange={v => setStock({ ...stock, safeZ: Math.max(1, v) })} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <span className="text-gray-500 text-[10px] uppercase font-bold flex items-center gap-1">Work Z0
                        <HelpIcon text="Where you touch off Z before running. Top: tool tip on the top of the raw stock (most common, insensitive to thickness variations). Bottom: tool tip on the bed / spoilboard; the program then uses Z = height above the bed (stock top = Z thickness), handy for the 2nd side or when the top is uneven. XY are bed coordinates; the stock's lower-left corner is the red dot." /></span>
                    <div className="flex flex-1 rounded-lg overflow-hidden border border-white/10 text-xs">
                        {(['top', 'bottom'] as const).map(z => (
                            <button key={z} onClick={() => setStock({ ...stock, zZero: z })}
                                className={`flex-1 py-1 ${(stock.zZero ?? 'top') === z ? 'bg-amber-500/25 text-amber-200' : 'text-gray-400 hover:bg-white/5'}`}>
                                {z === 'top' ? 'Stock top' : 'Stock bottom (bed)'}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <span className="text-gray-500 text-[10px] uppercase font-bold">Material</span>
                    <select value={stock.material} onChange={e => setStock({ ...stock, material: e.target.value })}
                        className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
                        {MATERIALS.map(m => <option key={m}>{m}</option>)}
                    </select>
                    <button onClick={loadExample} className="text-[10px] px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10" title="13 mm wood: face 4 mm, cut the first closed shape out leaving a 1 mm skin">
                        13 mm example
                    </button>
                </div>
                {finalTop < stock.thickness && (
                    <p className="text-[10px] text-gray-500 mt-2">After facing the top is at {finalTop.toFixed(2)} mm above the bed (Z{gz(stock.thickness - finalTop).toFixed(2)}).</p>
                )}
            </Card>

            <Card title={`2 · Contours (${selectedContourIds.length}/${contours.length} selected)`}
                right={contours.length > 0 && (
                    <div className="flex gap-2 text-[10px]">
                        <button className="text-gray-400 hover:text-white" onClick={() => setSelectedContourIds(contours.filter(c => c.closed).map(c => c.id))}>all closed</button>
                        <button className="text-gray-400 hover:text-white" onClick={() => setSelectedContourIds([])}>none</button>
                    </div>
                )}>
                {contours.length === 0 ? (
                    <p className="text-xs text-gray-500">Draw shapes above (or import an SVG / DXF); the drawing is shared with the Laser tab. Each closed or open path becomes a contour, shown on top of the stock in the 3D view, where you can click it to select it (Ctrl/Shift to add).</p>
                ) : (
                    <>
                        <p className="text-[10px] text-gray-500 mb-2">Click contours in the 3D view (Ctrl/Shift = multi-select) or tick them here. Cyan = closed, amber = open.</p>
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                            {contours.map(c => {
                                const w = c.bounds.maxX - c.bounds.minX, h = c.bounds.maxY - c.bounds.minY;
                                const sel = selectedContourIds.includes(c.id);
                                const outside = c.bounds.minX < stock.x - 0.01 || c.bounds.minY < stock.y - 0.01 || c.bounds.maxX > stock.x + stock.width + 0.01 || c.bounds.maxY > stock.y + stock.height + 0.01;
                                return (
                                    <label key={c.id} className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer ${sel ? 'bg-emerald-600/25 border border-emerald-500/40' : 'hover:bg-white/5 border border-transparent'}`}>
                                        <input type="checkbox" checked={sel} onChange={() => toggleContour(c.id)} />
                                        <span className={`w-2 h-2 rounded-full ${c.closed ? 'bg-cyan-400' : 'bg-amber-400'}`} />
                                        <span className="flex-1 truncate">{c.name}</span>
                                        {outside && <span title="Partly outside the stock"><AlertTriangle size={12} className="text-amber-400" /></span>}
                                        <span className="font-mono text-[10px] text-gray-500">{w.toFixed(1)}×{h.toFixed(1)}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </>
                )}
            </Card>

            <Card title="3 · Tool & operations" right={onOpenTools && <button className="text-[10px] text-gray-400 hover:text-white" onClick={onOpenTools}>Tool library →</button>}>
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-gray-500 text-[10px] uppercase font-bold">Tool</span>
                    <select value={toolId} onChange={e => setToolId(e.target.value)} className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
                        {tools.length === 0 && <option value="">{DEFAULT_TOOL.name} (default)</option>}
                        {tools.map(t => <option key={t.id} value={t.id}>{t.name} — Ø{t.diameter} {t.type} {t.flutes}FL</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                    {(['face', 'pocket', 'profile'] as MillOpType[]).map(t => (
                        <button key={t} onClick={() => addOp(t)} title={TYPE_INFO[t].help}
                            className="py-2 rounded-lg text-xs font-semibold border border-white/10 bg-white/5 hover:bg-emerald-600/25 hover:border-emerald-500/40 flex items-center justify-center gap-1">
                            <Plus size={12} /> {TYPE_INFO[t].label}
                        </button>
                    ))}
                </div>

                {ops.length === 0 && <p className="text-xs text-gray-500">No operations yet. Typical order: Facing → Pockets → inside Profiles → outside Profile last.</p>}

                <div className="space-y-1.5">
                    {ops.map((op, i) => {
                        const ws = opWarnings(op.id);
                        const lvl = ws.some(w => w.level === 'error') ? 'error' : ws.some(w => w.level === 'warning') ? 'warning' : null;
                        return (
                            <div key={op.id} onClick={() => setEditId(op.id)}
                                className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs cursor-pointer border ${editId === op.id ? 'bg-white/10 border-emerald-500/40' : 'bg-white/5 border-white/5 hover:bg-white/10'} ${op.enabled ? '' : 'opacity-50'}`}>
                                <div className="flex flex-col">
                                    <button onClick={e => { e.stopPropagation(); move(op.id, -1); }} disabled={i === 0} className="text-gray-500 hover:text-white disabled:opacity-20"><ChevronUp size={11} /></button>
                                    <button onClick={e => { e.stopPropagation(); move(op.id, 1); }} disabled={i === ops.length - 1} className="text-gray-500 hover:text-white disabled:opacity-20"><ChevronDown size={11} /></button>
                                </div>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${TYPE_INFO[op.type].badge}`}>{op.type === 'profile' ? SIDE_LABEL[op.cutSide] : TYPE_INFO[op.type].label}</span>
                                <span className="flex-1 truncate text-gray-200">{op.label}</span>
                                {lvl === 'error' && <XCircle size={13} className="text-red-400" />}
                                {lvl === 'warning' && <AlertTriangle size={13} className="text-amber-400" />}
                                <span className="font-mono text-[10px] text-gray-500 whitespace-nowrap">Ø{op.tool.diameter} · {op.startDepth > 0 ? `${op.startDepth}→` : ''}{opDepth(op, stock)} mm{op.depthRef === 'bottom' ? ` (${op.floor ?? 0} left)` : ''}</span>
                                <button onClick={e => { e.stopPropagation(); update(op.id, { enabled: !op.enabled }); }} className="text-gray-500 hover:text-white" title={op.enabled ? 'Disable' : 'Enable'}>{op.enabled ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                                <button onClick={e => { e.stopPropagation(); const c = { ...op, id: `${op.id}c${Date.now() % 1000}`, label: `${op.label} copy` }; setOps(l => [...l.slice(0, i + 1), c, ...l.slice(i + 1)]); setEditId(c.id); }} className="text-gray-500 hover:text-white" title="Duplicate"><Copy size={12} /></button>
                                <button onClick={e => { e.stopPropagation(); setOps(l => l.filter(o => o.id !== op.id)); }} className="text-gray-500 hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
                            </div>
                        );
                    })}
                </div>

                {editing && <OpEditor key={editing.id} op={editing} stock={stock} tools={tools}
                    contourName={contourName} selectedContourIds={selectedContourIds}
                    onChange={patch => update(editing.id, patch)} warnings={opWarnings(editing.id)} />}
            </Card>

            <Card title="4 · Generate & simulate">
                <button onClick={mill.generate} disabled={mill.loading || ops.filter(o => o.enabled).length === 0}
                    className="w-full py-3 rounded-lg border text-sm font-bold flex items-center justify-center gap-2 bg-emerald-600/60 hover:bg-emerald-600/80 border-emerald-500/50 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                    {mill.loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Computing toolpaths…</> : <><Drill size={16} /> Compute toolpaths</>}
                </button>

                {result && (
                    <div className="mt-3 space-y-3">
                        <WarningList warnings={result.warnings.filter(w => !w.opId)} />
                        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-3 text-xs grid grid-cols-2 gap-y-1">
                            <span className="text-gray-500">Est. time</span><span className="font-mono text-right text-emerald-300">{formatDuration(result.stats.estimatedTime)}</span>
                            <span className="text-gray-500">Cutting length</span><span className="font-mono text-right">{(result.stats.cutLength / 1000).toFixed(2)} m</span>
                            <span className="text-gray-500">Lines</span><span className="font-mono text-right">{result.stats.lines.toLocaleString()}</span>
                            <span className="text-gray-500">Deepest</span><span className="font-mono text-right">Z{result.stats.bounds.min[2].toFixed(2)}</span>
                        </div>
                        {result.operations.length > 0 && (
                            <table className="w-full text-[10px] font-mono">
                                <thead className="text-gray-500"><tr><th className="text-left font-normal">Operation</th><th className="font-normal">Passes</th><th className="font-normal">Ramp</th><th className="text-right font-normal">Time</th></tr></thead>
                                <tbody>
                                    {result.operations.map(o => (
                                        <tr key={o.id} className="text-gray-300"><td className="truncate max-w-[9rem]">{o.label}</td><td className="text-center">{o.passes}×{o.stepdown.toFixed(2)}</td><td className="text-center">{o.rampLength > 0 ? `${o.rampLength.toFixed(1)} mm` : 'plunge'}</td><td className="text-right">{formatDuration(o.time)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        <div className="bg-black/30 rounded-lg p-3 border border-white/5 space-y-2">
                            <label className="flex items-center gap-2 text-xs text-gray-200">
                                <input type="checkbox" checked={mill.simEnabled} onChange={e => mill.setSimEnabled(e.target.checked)} />
                                <Box size={13} className="text-amber-400" /> Simulate material removal
                                {mill.simBusy && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            </label>
                            {mill.simEnabled && (
                                <div className="flex items-center gap-2">
                                    <button className="text-gray-400 hover:text-white" title={playing ? 'Pause' : 'Play'} onClick={() => { if (!playing && mill.simProgress >= 1) mill.setSimProgress(0); setPlaying(p => !p); }}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
                                    <input type="range" min={0} max={1} step={0.005} value={mill.simProgress} onChange={e => { setPlaying(false); mill.setSimProgress(parseFloat(e.target.value)); }} className="flex-1 accent-amber-500" />
                                    <span className="font-mono text-[10px] text-gray-400 w-9 text-right">{Math.round(mill.simProgress * 100)}%</span>
                                </div>
                            )}
                        </div>

                        <button onClick={mill.sendToJob} disabled={errors > 0 || !result.gcode}
                            className="w-full py-2 rounded-lg bg-blue-600/40 hover:bg-blue-600/60 border border-blue-500/40 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                            title={errors > 0 ? 'Fix the errors first' : 'Open the G-code job tab (run, frame, save)'}>
                            <Layers size={14} /> Use this G-code ({errors > 0 ? `${errors} error${errors > 1 ? 's' : ''}` : 'open job tab'})
                        </button>
                    </div>
                )}
            </Card>

            <ShowOnMachine mill={mill} />
        </div>
    );
};

/**
 * "Jog" preview: moves the head (spindle off) a few mm above the stock top to show where the stock
 * and the cut area are on the real machine, before anything is cut.
 */
const ShowOnMachine: React.FC<{ mill: MillController }> = ({ mill }) => {
    const { stock, cutArea, result } = mill;
    const [clearance, setClearance] = useState(5);
    const [feed, setFeed] = useState(1500);
    const [busy, setBusy] = useState(false);
    const ready = !!mill.machineReady && !!mill.sendCommands && !busy;
    const topZ = stock.zZero === 'bottom' ? stock.thickness : 0;
    const f = (n: number) => n.toFixed(3);
    const first = result?.toolpaths.find(tp => tp.points.length)?.points[0];

    const run = async (moves: string[]) => {
        if (!mill.sendCommands) return;
        setBusy(true);
        try { await mill.sendCommands(['M5', 'G90', `G0 Z${f(topZ + Math.max(0.5, clearance))}`, ...moves]); } finally { setBusy(false); }
    };
    const rect = (a: { minX: number; minY: number; maxX: number; maxY: number }) => [
        `G0 X${f(a.minX)} Y${f(a.minY)}`,
        `G1 X${f(a.maxX)} Y${f(a.minY)} F${Math.round(feed)}`,
        `G1 X${f(a.maxX)} Y${f(a.maxY)}`,
        `G1 X${f(a.minX)} Y${f(a.maxY)}`,
        `G1 X${f(a.minX)} Y${f(a.minY)}`,
    ];
    const stockBox = { minX: stock.x, minY: stock.y, maxX: stock.x + stock.width, maxY: stock.y + stock.height };

    return (
        <Card title="5 · Show on machine (frame)" color="text-sky-400"
            right={<HelpIcon text="Moves the head with the spindle OFF, a few mm above the stock top, so you can check on the real machine where the stock and the cuts are (clamps, bed edges…). Work zero (XY and Z on the stock top/bottom as chosen in step 1) must be set first." />}>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Clearance" unit="mm" value={clearance} min={0.5} step={1} help="Height above the stock TOP while tracing" onChange={v => setClearance(Math.max(0.5, v))} />
                <Field label="Trace feed" unit="mm/min" value={feed} min={50} step={100} onChange={v => setFeed(Math.max(50, v))} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <button disabled={!ready} onClick={() => run(rect(stockBox))} className="btn-secondary py-1.5 disabled:opacity-40">Trace stock outline</button>
                <button disabled={!ready || !cutArea} onClick={() => cutArea && run(rect(cutArea))} className="btn-secondary py-1.5 disabled:opacity-40"
                    title={cutArea ? 'Bounding box of every cut, including the tool radius' : 'Compute toolpaths first'}>Trace cut area</button>
                <button disabled={!ready || !first} onClick={() => first && run([`G0 X${f(first[0])} Y${f(first[1])}`])} className="btn-secondary py-1.5 disabled:opacity-40"
                    title={first ? 'Hover over the first cutting point' : 'Compute toolpaths first'}>Go to first cut</button>
                <button disabled={!ready} onClick={() => run([])} className="btn-secondary py-1.5 disabled:opacity-40">Lift to clearance</button>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">
                {mill.machineReady
                    ? <>Head at Z{f(topZ + clearance)} = {clearance} mm above the stock top. {cutArea && <>Cut area {(cutArea.maxX - cutArea.minX).toFixed(1)} × {(cutArea.maxY - cutArea.minY).toFixed(1)} mm (green dashed frame in 3D).</>}</>
                    : <span className="text-amber-300">Connect the machine (state must be Idle) to use these moves. Now: {mill.machineState ?? 'unknown'}.</span>}
            </p>
        </Card>
    );
};

const LEVEL_STYLE = {
    error: { cls: 'bg-red-900/30 border-red-600/40 text-red-200', Icon: XCircle },
    warning: { cls: 'bg-amber-900/25 border-amber-600/40 text-amber-100', Icon: AlertTriangle },
    info: { cls: 'bg-sky-900/20 border-sky-700/30 text-sky-200', Icon: Info },
};

const WarningList: React.FC<{ warnings: MillResult['warnings'] }> = ({ warnings }) => {
    if (!warnings.length) return null;
    const order = { error: 0, warning: 1, info: 2 };
    return (
        <div className="space-y-1">
            {[...warnings].sort((a, b) => order[a.level] - order[b.level]).map((w, i) => {
                const { cls, Icon } = LEVEL_STYLE[w.level];
                return <div key={i} className={`flex gap-2 items-start text-[11px] rounded border px-2 py-1 ${cls}`}><Icon size={12} className="mt-0.5 shrink-0" /><span>{w.message}</span></div>;
            })}
        </div>
    );
};

interface OpEditorProps {
    op: MillOp;
    stock: MillStock;
    tools: (MillTool & { id: string })[];
    contourName: Map<string, string>;
    selectedContourIds: string[];
    onChange: (patch: Partial<MillOp>) => void;
    warnings: MillResult['warnings'];
}

const OpEditor: React.FC<OpEditorProps> = ({ op, stock, tools, contourName, selectedContourIds, onChange, warnings }) => {
    const cl = chipLoad(op);
    const depth = opDepth(op, stock);
    const passes = Math.max(1, Math.ceil((depth - op.startDepth) / Math.max(0.01, op.stepdown)));
    const rampLen = op.rampAngle > 0 ? Math.min(op.stepdown, depth - op.startDepth) / Math.tan(op.rampAngle * Math.PI / 180) : 0;
    const through = depth >= stock.thickness;
    const fromBottom = op.depthRef === 'bottom';
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // Switching keeps the same physical depth, only the way it is entered changes.
    const setRef = (ref: 'top' | 'bottom') => onChange(ref === 'bottom'
        ? { depthRef: 'bottom', floor: r2(Math.max(0, stock.thickness - depth)) }
        : { depthRef: 'top', depth: r2(depth) });

    return (
        <div className="mt-3 bg-black/40 rounded-lg p-3 border border-white/10 space-y-3">
            <div className="flex items-center gap-2">
                <input value={op.label} onChange={e => onChange({ label: e.target.value })}
                    className="flex-1 bg-transparent border-b border-white/10 text-sm text-white focus:outline-none focus:border-emerald-500/50" />
                <span className="text-[10px] text-gray-500 uppercase">{TYPE_INFO[op.type].label}</span>
            </div>

            {op.type !== 'face' && (
                <div className="text-[10px] text-gray-400">
                    <div className="flex items-center justify-between">
                        <span>Contours: {op.contourIds.map(id => contourName.get(id) ?? '⚠ missing').join(', ') || 'none'}</span>
                        <button disabled={!selectedContourIds.length} onClick={() => onChange({ contourIds: [...selectedContourIds] })}
                            className="text-emerald-300 hover:text-emerald-200 disabled:opacity-30 whitespace-nowrap ml-2">use selection ({selectedContourIds.length})</button>
                    </div>
                </div>
            )}

            {op.type === 'profile' && (
                <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
                    {(['outside', 'inside', 'on'] as CutSide[]).map(s => (
                        <button key={s} onClick={() => onChange({ cutSide: s })} className={`flex-1 py-1.5 ${op.cutSide === s ? 'bg-orange-500/25 text-orange-200' : 'text-gray-400 hover:bg-white/5'}`}>{SIDE_LABEL[s]}</button>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[10px] uppercase font-bold">Tool</span>
                <select value={tools.find(t => t.name === op.tool.name && t.diameter === op.tool.diameter)?.id ?? ''}
                    onChange={e => { const t = tools.find(x => x.id === e.target.value); if (t) onChange({ tool: t }); }}
                    className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white">
                    <option value="" disabled>{op.tool.name} Ø{op.tool.diameter}</option>
                    {tools.map(t => <option key={t.id} value={t.id}>{t.name} — Ø{t.diameter}</option>)}
                </select>
                <button className="text-[10px] text-emerald-300 hover:text-emerald-200 whitespace-nowrap" title="Recompute RPM, feed, plunge and stepdown for this tool and the stock material"
                    onClick={() => { const f = suggestFeeds(stock.material, op.tool); onChange({ rpm: f.rpm, feed: f.feed, plunge: f.plunge, stepdown: op.type === 'face' ? Math.min(f.stepdown, 1) : f.stepdown }); }}>
                    suggest feeds
                </button>
            </div>

            <div className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-500 uppercase font-bold flex items-center gap-1">Final depth by
                    <HelpIcon text="Choose ONE way to define where the op stops: a depth measured down from the original stock top, or the material thickness left above the stock bottom (e.g. 1 mm skin so the part stays attached, then flip the board and face it off). The other value is computed." /></span>
                <div className="flex flex-1 rounded-lg overflow-hidden border border-white/10">
                    <button onClick={() => setRef('top')} className={`flex-1 py-1 ${!fromBottom ? 'bg-emerald-500/25 text-emerald-200' : 'text-gray-400 hover:bg-white/5'}`}>Depth from top</button>
                    <button onClick={() => setRef('bottom')} className={`flex-1 py-1 ${fromBottom ? 'bg-emerald-500/25 text-emerald-200' : 'text-gray-400 hover:bg-white/5'}`}>Left above bottom</button>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <Field label="Start depth" unit="mm" value={op.startDepth} min={0} step={0.5} help="Depth below the original stock top where this operation starts cutting (e.g. the depth already removed by facing). Air above it is skipped." onChange={v => onChange({ startDepth: Math.max(0, v) })} />
                {fromBottom
                    ? <Field label="Leave (floor)" unit="mm" value={op.floor ?? 0} min={0} step={0.1} warn={(op.floor ?? 0) <= 0 && op.type !== 'face'} help="Material left between the bottom of this cut and the bottom of the stock." onChange={v => onChange({ floor: Math.max(0, Math.min(stock.thickness - 0.05, v)) })} />
                    : <Field label="Final depth" unit="mm" value={op.depth} min={0.05} step={0.5} warn={through && op.type !== 'face'} help="Depth below the original stock top. Positive number." onChange={v => onChange({ depth: Math.max(0.05, v) })} />}
                <Field label="Stepdown" unit="mm" value={op.stepdown} min={0.05} step={0.1} warn={op.stepdown > op.tool.diameter} help="Max depth per pass. Rule of thumb: ≤ ½ tool Ø in wood, ≤ ¼ in hardwood/plastics." onChange={v => onChange({ stepdown: Math.max(0.05, v) })} />
            </div>
            <p className="text-[10px] text-gray-500 font-mono">
                cuts {op.startDepth.toFixed(2)} → {depth.toFixed(2)} mm below the top · leaves {Math.max(0, stock.thickness - depth).toFixed(2)} mm · Z{(stock.zZero === 'bottom' ? stock.thickness - depth : -depth).toFixed(2)}
                {through && op.type !== 'face' && <span className="text-amber-300"> · cuts through, protect the bed</span>}
            </p>

            <div className="grid grid-cols-3 gap-2">
                {op.type !== 'profile' && <Field label="Stepover" unit="%" value={op.stepoverPct} min={5} step={5} warn={op.stepoverPct > 70} help="Distance between adjacent passes as % of tool Ø. 40 % for pockets, 50-70 % for facing." onChange={v => onChange({ stepoverPct: Math.min(95, Math.max(5, v)) })} />}
                <Field label="Ramp angle" unit="°" value={op.rampAngle} min={0} step={0.5} warn={op.rampAngle === 0 || op.rampAngle > 30} help="Entry slope into the material along the toolpath. 2-5° for most router bits; 0 = straight plunge (needs a centre-cutting bit)." onChange={v => onChange({ rampAngle: Math.max(0, Math.min(90, v)) })} />
                <Field label="Spindle" unit="rpm" value={op.rpm} min={0} step={500} onChange={v => onChange({ rpm: Math.max(0, v) })} />
                <Field label="Feed" unit="mm/min" value={op.feed} min={1} step={50} onChange={v => onChange({ feed: Math.max(1, v) })} />
                <Field label="Plunge" unit="mm/min" value={op.plunge} min={1} step={10} onChange={v => onChange({ plunge: Math.max(1, v) })} />
            </div>

            <div className="text-[10px] text-gray-400 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
                <span>{passes} pass{passes > 1 ? 'es' : ''}</span>
                <span>chip load {cl.toFixed(3)} mm/tooth</span>
                {op.type !== 'profile' && <span>stepover {(op.tool.diameter * op.stepoverPct / 100).toFixed(2)} mm</span>}
                {rampLen > 0 && <span>ramp ≈ {rampLen.toFixed(1)} mm long</span>}
            </div>

            <WarningList warnings={warnings} />
        </div>
    );
};

export default MillPanel;
