import { useRef, useState } from 'react';
import { Cpu, Plus, Copy, Trash2, Download, Upload, Send, Star } from 'lucide-react';
import { apiGet, apiPost, normalizeServerUrl, remotePost } from '../api';
import type { MachineKind, MachineProfile, MachineStore } from '../types';

export interface ProfileMeta {
    name: string;
    kind: MachineKind;
    notes: string;
    spindleMax: number;
}

interface Props {
    store: MachineStore;
    editId: string;
    meta: ProfileMeta;
    dirty: boolean;
    onMetaChange: (meta: ProfileMeta) => void;
    /** Switch the profile being edited (the parent asks about unsaved changes) */
    onSelect: (id: string) => void;
    /** Persist the current edits of the selected profile */
    onSave: () => Promise<boolean>;
    /** Reload the profile list, optionally selecting a profile */
    onStoreChanged: (selectId?: string) => Promise<void>;
}

const REMOTE_KEY = 'lzrcnc.remoteServer';
const errMsg = (e: unknown) => (e as Error)?.message ?? String(e);

function downloadJson(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MachineProfilesSection({ store, editId, meta, dirty, onMetaChange, onSelect, onSave, onStoreChanged }: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [importMode, setImportMode] = useState<'new' | 'replace'>('new');
    const [remote, setRemote] = useState(() => localStorage.getItem(REMOTE_KEY) ?? '');
    const [remoteReplace, setRemoteReplace] = useState(true);

    const editing = store.machines.find(m => m.id === editId);
    const isActive = editId === store.activeId;

    const run = async (fn: () => Promise<string | void>) => {
        setBusy(true);
        setMessage(null);
        try {
            const text = await fn();
            if (text) setMessage({ ok: true, text });
        } catch (e) {
            setMessage({ ok: false, text: errMsg(e) });
        } finally {
            setBusy(false);
        }
    };

    // Export / send always use the saved file, so persist pending edits first
    const saveIfDirty = async () => {
        if (dirty && !(await onSave())) throw new Error('Save failed, nothing was exported');
    };

    const exportFile = () => apiGet<{ machine: MachineProfile }>(`/api/machines/${encodeURIComponent(editId)}/export`);
    const fileName = (name: string) => `lzrcnc-machine-${name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'machine'}.json`;

    const handleNew = () => run(async () => {
        const name = prompt('Name of the new machine:', 'New machine');
        if (!name?.trim()) return;
        const m = await apiPost<MachineProfile>('/api/machines', { name, kind: 'laser' });
        await onStoreChanged(m.id);
        return `Created “${m.name}” with default settings. Edit it below, then Save.`;
    });

    const handleDuplicate = () => run(async () => {
        await saveIfDirty();
        const name = prompt('Name of the copy:', `${meta.name} (copy)`);
        if (!name?.trim()) return;
        const m = await apiPost<MachineProfile>('/api/machines', { name, copyFromId: editId });
        await onStoreChanged(m.id);
        return `Duplicated as “${m.name}”.`;
    });

    const handleDelete = () => run(async () => {
        if (!confirm(`Delete the machine “${editing?.name}”? This cannot be undone (export it first if unsure).`)) return;
        await apiPost(`/api/machines/${encodeURIComponent(editId)}`, undefined, 'DELETE');
        await onStoreChanged(store.activeId === editId ? undefined : store.activeId);
        return `Deleted “${editing?.name}”.`;
    });

    const handleActivate = () => run(async () => {
        await saveIfDirty();
        await apiPost(`/api/machines/${encodeURIComponent(editId)}/activate`);
        await onStoreChanged(editId);
        return `“${meta.name}” is now the active machine (visualizer, CAM and simulator use it).`;
    });

    const handleExport = () => run(async () => {
        await saveIfDirty();
        const file = await exportFile();
        downloadJson(file, fileName(file.machine.name));
        return `Exported “${file.machine.name}”.`;
    });

    const handleImportFile = (f: File) => run(async () => {
        let data: unknown;
        try { data = JSON.parse(await f.text()); } catch { throw new Error(`${f.name} is not a JSON file`); }
        if (importMode === 'replace' && !confirm(`Replace the settings of “${editing?.name}” with ${f.name}? Its serial port / host is kept.`)) return;
        const res = await apiPost<{ machine: MachineProfile; replaced: boolean }>('/api/machines/import', {
            data,
            targetId: importMode === 'replace' ? editId : undefined,
        });
        await onStoreChanged(res.machine.id);
        return res.replaced ? `Updated “${res.machine.name}” from ${f.name}.` : `Imported ${f.name} as “${res.machine.name}”.`;
    });

    const handleSend = () => run(async () => {
        const url = normalizeServerUrl(remote);
        if (!url) throw new Error('Enter the address of the other LzrCnc, e.g. 192.168.1.20:3001');
        localStorage.setItem(REMOTE_KEY, remote.trim());
        await saveIfDirty();
        const file = await exportFile();
        const res = await remotePost<{ machine: MachineProfile; replaced: boolean }>(url, '/api/machines/import', {
            data: file,
            matchByName: remoteReplace,
        });
        return res.replaced
            ? `Updated “${res.machine.name}” on ${url} (its own port/host kept).`
            : `Added “${res.machine.name}” to ${url}. Select it there in Connection › Machine.`;
    });

    const input = 'w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-white';
    const btn = 'bg-white/5 hover:bg-white/10 px-2 py-1.5 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-50';

    return (
        <section className="bg-slate-800/50 p-4 rounded-lg border border-cyan-500/20 space-y-3" data-testid="machine-profiles">
            <h4 className="text-md font-semibold text-gray-200 flex items-center gap-2">
                <Cpu size={16} className="text-cyan-400" /> Machines
            </h4>

            <div className="flex gap-2 items-center">
                <select value={editId} onChange={e => onSelect(e.target.value)} className={`${input} flex-1`} disabled={busy} aria-label="Machine to edit">
                    {store.machines.map(m => (
                        <option key={m.id} value={m.id}>{m.name}{m.id === store.activeId ? '  (active)' : ''}</option>
                    ))}
                </select>
                {isActive
                    ? <span className="text-[11px] text-emerald-300 flex items-center gap-1 whitespace-nowrap"><Star size={12} /> Active</span>
                    : <button onClick={handleActivate} disabled={busy} className={`${btn} text-cyan-300`} title="Use this machine for the visualizer, CAM and simulator"><Star size={12} /> Set active</button>}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                    <label className="block text-gray-400 text-xs mb-1">Name</label>
                    <input value={meta.name} maxLength={60} onChange={e => onMetaChange({ ...meta, name: e.target.value })} className={input} />
                </div>
                <div>
                    <label className="block text-gray-400 text-xs mb-1">Type</label>
                    <select value={meta.kind} onChange={e => onMetaChange({ ...meta, kind: e.target.value as MachineKind })} className={input}>
                        <option value="laser">Laser</option>
                        <option value="mill">Mill / router</option>
                        <option value="laser+mill">Laser + mill</option>
                    </select>
                </div>
                <div>
                    <label className="block text-gray-400 text-xs mb-1" title="S value for 100 % laser power / spindle speed (GRBL $30). Used when the controller does not report $30.">Max S ($30)</label>
                    <input type="number" min={1} value={meta.spindleMax} onChange={e => onMetaChange({ ...meta, spindleMax: parseFloat(e.target.value) || 0 })} className={`${input} text-right`} />
                </div>
                <div className="col-span-2">
                    <label className="block text-gray-400 text-xs mb-1">Notes</label>
                    <input value={meta.notes} maxLength={500} placeholder="e.g. 10 W diode, garage Pi" onChange={e => onMetaChange({ ...meta, notes: e.target.value })} className={input} />
                </div>
            </div>
            {editing && (
                <p className="text-[11px] text-gray-500">
                    Connection: {editing.connection.type === 'klipper'
                        ? `Klipper ${editing.connection.host ?? '(host not set)'}`
                        : editing.connection.port ? `GRBL ${editing.connection.port} @ ${editing.connection.baud ?? 115200}` : 'GRBL, port not set yet'} (saved when you connect, kept per computer)
                    {dirty && <span className="text-amber-300"> · unsaved changes</span>}
                </p>
            )}

            <div className="grid grid-cols-3 gap-2">
                <button onClick={handleNew} disabled={busy} className={btn}><Plus size={12} /> New</button>
                <button onClick={handleDuplicate} disabled={busy} className={btn}><Copy size={12} /> Duplicate</button>
                <button onClick={handleDelete} disabled={busy || store.machines.length <= 1} className={`${btn} text-red-300`} title={store.machines.length <= 1 ? 'The last machine cannot be deleted' : undefined}><Trash2 size={12} /> Delete</button>
            </div>

            <div className="border-t border-white/10 pt-3 space-y-2">
                <div className="text-xs text-gray-400 font-semibold">Share this machine</div>
                <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleExport} disabled={busy} className={btn}><Download size={12} /> Export file</button>
                    <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn}><Upload size={12} /> Import file</button>
                </div>
                <select value={importMode} onChange={e => setImportMode(e.target.value as 'new' | 'replace')} className={`${input} text-xs`} aria-label="Import mode">
                    <option value="new">Import adds a new machine</option>
                    <option value="replace">Import replaces “{editing?.name}” (keeps its port)</option>
                </select>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" data-testid="machine-import-file"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleImportFile(f); }} />

                <label className="block text-gray-400 text-xs mt-2">Send to another LzrCnc (e.g. the Raspberry Pi)</label>
                <div className="flex gap-2">
                    <input value={remote} onChange={e => setRemote(e.target.value)} placeholder="192.168.1.20:3001" className={`${input} flex-1 text-xs`} aria-label="Other LzrCnc address" />
                    <button onClick={handleSend} disabled={busy || !remote.trim()} className={`${btn} text-cyan-300`}><Send size={12} /> Send</button>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-gray-400">
                    <input type="checkbox" checked={remoteReplace} onChange={e => setRemoteReplace(e.target.checked)} className="accent-cyan-500" />
                    Update the machine with the same name there (otherwise add a copy)
                </label>
            </div>

            {message && (
                <div className={`text-xs rounded px-2 py-1.5 ${message.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`} role="status">
                    {message.text}
                </div>
            )}
        </section>
    );
}
