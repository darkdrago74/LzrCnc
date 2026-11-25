import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export interface AxisSettings {
    visible: boolean;
    min: number;
    max: number;
    offset: number; // Offset from marker (Home/Origin)
    direction: number; // 1 or -1
    reversed: boolean;
    homingPos?: 'min' | 'max';
    endstops: {
        hasMin: boolean;
        hasMax: boolean;
    };
}

export interface WorkbenchSettings {
    width: number;
    height: number;
    depth: number;
    origin: 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right'; // Corner-only origins
    showWorkbench: boolean;
}

export interface MachineSettings {
    workbench: WorkbenchSettings;
    axes: {
        x: AxisSettings;
        y: AxisSettings;
        z: AxisSettings;
    };
    /** Laser power / spindle S value for 100 % (GRBL $30). Used when the controller does not report it. */
    spindleMax?: number;
    macros: any[];
}

export type MachineKind = 'laser' | 'mill' | 'laser+mill';

export interface MachineConnection {
    type: 'grbl' | 'klipper';
    port?: string;
    baud?: number;
    host?: string;
}

export interface MachineProfile {
    id: string;
    name: string;
    kind: MachineKind;
    notes?: string;
    /** Last used connection; machine-specific (COM6 on Windows, /dev/ttyUSB0 on the Pi). */
    connection: MachineConnection;
    settings: MachineSettings;
    updatedAt: string;
}

export interface MachineStore {
    version: 1;
    activeId: string;
    machines: MachineProfile[];
}

/** File written by "Export" and accepted by "Import" / "Send to another LzrCnc". */
export interface MachineExportFile {
    format: 'lzrcnc-machine';
    version: 1;
    exportedAt: string;
    machine: Omit<MachineProfile, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string };
}

export interface ImportOptions {
    /** Overwrite this machine (its connection is kept unless keepConnection is false). */
    targetId?: string;
    /** Overwrite the machine that has the same name, otherwise add a new one. */
    matchByName?: boolean;
    keepConnection?: boolean;
    activate?: boolean;
}

export class SettingsError extends Error {
    constructor(message: string, readonly statusCode = 400) { super(message); }
}

const DEFAULT_SETTINGS: MachineSettings = {
    workbench: {
        width: 300,
        height: 200,
        depth: 50,
        origin: 'bottom-left',
        showWorkbench: true
    },
    axes: {
        x: { visible: true, min: 0, max: 300, offset: 0, direction: 1, reversed: false, endstops: { hasMin: true, hasMax: false } },
        y: { visible: true, min: 0, max: 200, offset: 0, direction: 1, reversed: false, endstops: { hasMin: true, hasMax: false } },
        z: { visible: true, min: 0, max: 50, offset: 0, direction: 1, reversed: false, endstops: { hasMin: true, hasMax: true } }
    },
    spindleMax: 1000,
    macros: []
};

const ORIGINS = ['bottom-left', 'top-left', 'top-right', 'bottom-right'] as const;
const KINDS: MachineKind[] = ['laser', 'mill', 'laser+mill'];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -1e6, max = 1e6) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;

function normalizeAxis(v: unknown, def: AxisSettings): AxisSettings {
    const a = isObj(v) ? v : {};
    const out: AxisSettings = {
        visible: bool(a.visible, def.visible),
        min: num(a.min, def.min),
        max: num(a.max, def.max),
        offset: num(a.offset, def.offset),
        direction: a.direction === -1 ? -1 : 1,
        reversed: bool(a.reversed, def.reversed),
        endstops: {
            hasMin: bool(a.endstops?.hasMin, def.endstops.hasMin),
            hasMax: bool(a.endstops?.hasMax, def.endstops.hasMax),
        },
    };
    if (a.homingPos === 'min' || a.homingPos === 'max') out.homingPos = a.homingPos;
    return out;
}

/** Fills missing fields with defaults and drops invalid values, so imported/old files never break the UI. */
export function normalizeSettings(v: unknown, base: MachineSettings = DEFAULT_SETTINGS): MachineSettings {
    const s = isObj(v) ? v : {};
    const wb = isObj(s.workbench) ? s.workbench : {};
    return {
        workbench: {
            width: num(wb.width, base.workbench.width, 1, 1e5),
            height: num(wb.height, base.workbench.height, 1, 1e5),
            depth: num(wb.depth, base.workbench.depth, 0, 1e5),
            origin: ORIGINS.includes(wb.origin) ? wb.origin : base.workbench.origin,
            showWorkbench: bool(wb.showWorkbench, base.workbench.showWorkbench),
        },
        axes: {
            x: normalizeAxis(s.axes?.x, base.axes.x),
            y: normalizeAxis(s.axes?.y, base.axes.y),
            z: normalizeAxis(s.axes?.z, base.axes.z),
        },
        spindleMax: num(s.spindleMax, base.spindleMax ?? 1000, 1, 1e6),
        macros: Array.isArray(s.macros) ? s.macros : base.macros,
    };
}

function normalizeConnection(v: unknown): MachineConnection {
    const c = isObj(v) ? v : {};
    const out: MachineConnection = { type: c.type === 'klipper' ? 'klipper' : 'grbl' };
    if (typeof c.port === 'string' && c.port) out.port = c.port.slice(0, 200);
    if (typeof c.host === 'string' && c.host) out.host = c.host.slice(0, 200);
    if (typeof c.baud === 'number' && c.baud > 0) out.baud = c.baud;
    return out;
}

function cleanName(v: unknown, fallback: string) {
    const n = typeof v === 'string' ? v.trim().slice(0, 80) : '';
    return n || fallback;
}

/**
 * Named machine profiles (data/machines.json). One is "active": it drives the bed shown in the
 * visualizer, the CAM limits and the simulator, connected or not.
 * The legacy data/machine_settings.json is migrated into a first profile and left untouched.
 */
export class SettingsService {
    private storePath: string;
    private legacyPath: string;
    private store: MachineStore | null = null;
    private writing: Promise<void> = Promise.resolve();

    constructor(dataDir: string) {
        this.storePath = path.join(dataDir, 'machines.json');
        this.legacyPath = path.join(dataDir, 'machine_settings.json');
    }

    private async load(): Promise<MachineStore> {
        if (this.store) return this.store;
        let store: MachineStore | null = null;
        try {
            const raw = JSON.parse(await fs.readFile(this.storePath, 'utf-8'));
            const machines: MachineProfile[] = (Array.isArray(raw?.machines) ? raw.machines : [])
                .filter(isObj)
                .map((m: any, i: number) => this.normalizeProfile(m, typeof m.id === 'string' && m.id ? m.id : randomUUID(), `Machine ${i + 1}`));
            if (machines.length > 0) {
                const activeId = machines.some(m => m.id === raw.activeId) ? raw.activeId : machines[0].id;
                store = { version: 1, activeId, machines };
            }
        } catch (e: any) {
            if (e?.code !== 'ENOENT') console.error('[SettingsService] machines.json unreadable, rebuilding it:', e?.message ?? e);
        }
        if (!store) {
            let legacy: unknown = null;
            try { legacy = JSON.parse(await fs.readFile(this.legacyPath, 'utf-8')); } catch { /* none */ }
            const first = this.normalizeProfile({ name: 'My machine', kind: 'laser', settings: legacy }, randomUUID(), 'My machine');
            store = { version: 1, activeId: first.id, machines: [first] };
            this.store = store;
            await this.persist();
        }
        this.store = store;
        return store;
    }

    private normalizeProfile(m: any, id: string, fallbackName: string): MachineProfile {
        return {
            id,
            name: cleanName(m?.name, fallbackName),
            kind: KINDS.includes(m?.kind) ? m.kind : 'laser',
            ...(typeof m?.notes === 'string' && m.notes ? { notes: m.notes.slice(0, 2000) } : {}),
            connection: normalizeConnection(m?.connection),
            settings: normalizeSettings(m?.settings),
            updatedAt: typeof m?.updatedAt === 'string' ? m.updatedAt : new Date().toISOString(),
        };
    }

    /** Atomic write (temp file + rename), serialized so concurrent saves never interleave. */
    private persist(): Promise<void> {
        const data = JSON.stringify(this.store, null, 2);
        const run = this.writing.then(async () => {
            const tmp = `${this.storePath}.tmp`;
            await fs.writeFile(tmp, data, 'utf-8');
            await fs.rename(tmp, this.storePath);
        });
        this.writing = run.catch(() => { /* keep the chain alive */ });
        return run;
    }

    private find(store: MachineStore, id: string): MachineProfile {
        const m = store.machines.find(x => x.id === id);
        if (!m) throw new SettingsError(`Machine not found: ${id}`, 404);
        return m;
    }

    private uniqueName(store: MachineStore, name: string, exceptId?: string) {
        const taken = new Set(store.machines.filter(m => m.id !== exceptId).map(m => m.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        for (let i = 2; ; i++) {
            const n = `${name} (${i})`;
            if (!taken.has(n.toLowerCase())) return n;
        }
    }

    // ── Active machine (used by /status, the visualizer, CAM and the simulator) ──

    async getActive(): Promise<MachineProfile> {
        const store = await this.load();
        return this.find(store, store.activeId);
    }

    async getSettings(): Promise<MachineSettings> {
        return (await this.getActive()).settings;
    }

    /** Partial update of the active machine's settings (legacy /api/settings/machine). */
    async saveSettings(newSettings: Partial<MachineSettings>): Promise<MachineSettings> {
        const active = await this.getActive();
        const merged = {
            ...active.settings,
            ...newSettings,
            workbench: { ...active.settings.workbench, ...(newSettings.workbench ?? {}) },
            axes: {
                x: { ...active.settings.axes.x, ...(newSettings.axes?.x ?? {}) },
                y: { ...active.settings.axes.y, ...(newSettings.axes?.y ?? {}) },
                z: { ...active.settings.axes.z, ...(newSettings.axes?.z ?? {}) },
            },
        };
        return (await this.updateMachine(active.id, { settings: merged })).settings;
    }

    // ── Profiles ──

    async listMachines(): Promise<MachineStore> {
        return clone(await this.load());
    }

    async createMachine(input: { name?: string; kind?: MachineKind; notes?: string; copyFromId?: string; settings?: unknown; connection?: unknown }): Promise<MachineProfile> {
        const store = await this.load();
        const src = input.copyFromId ? this.find(store, input.copyFromId) : null;
        const profile = this.normalizeProfile({
            name: input.name ?? (src ? `${src.name} copy` : 'New machine'),
            kind: input.kind ?? src?.kind,
            notes: input.notes ?? src?.notes,
            connection: input.connection ?? src?.connection,
            settings: input.settings ?? src?.settings,
        }, randomUUID(), 'New machine');
        profile.name = this.uniqueName(store, profile.name);
        store.machines.push(profile);
        await this.persist();
        return clone(profile);
    }

    async updateMachine(id: string, patch: { name?: unknown; kind?: unknown; notes?: unknown; connection?: unknown; settings?: unknown }): Promise<MachineProfile> {
        const store = await this.load();
        const m = this.find(store, id);
        if (patch.name !== undefined) m.name = this.uniqueName(store, cleanName(patch.name, m.name), m.id);
        if (patch.kind !== undefined && KINDS.includes(patch.kind as MachineKind)) m.kind = patch.kind as MachineKind;
        if (patch.notes !== undefined) {
            if (typeof patch.notes === 'string' && patch.notes) m.notes = patch.notes.slice(0, 2000);
            else delete m.notes;
        }
        if (patch.connection !== undefined) m.connection = normalizeConnection({ ...m.connection, ...(isObj(patch.connection) ? patch.connection : {}) });
        if (patch.settings !== undefined) m.settings = normalizeSettings(patch.settings, m.settings);
        m.updatedAt = new Date().toISOString();
        await this.persist();
        return clone(m);
    }

    async deleteMachine(id: string): Promise<MachineStore> {
        const store = await this.load();
        this.find(store, id);
        if (store.machines.length <= 1) throw new SettingsError('The last machine cannot be deleted');
        store.machines = store.machines.filter(m => m.id !== id);
        if (store.activeId === id) store.activeId = store.machines[0].id;
        await this.persist();
        return clone(store);
    }

    async setActive(id: string): Promise<MachineProfile> {
        const store = await this.load();
        const m = this.find(store, id);
        if (store.activeId !== id) {
            store.activeId = id;
            await this.persist();
        }
        return clone(m);
    }

    async exportMachine(id: string): Promise<MachineExportFile> {
        const store = await this.load();
        const m = clone(this.find(store, id));
        return { format: 'lzrcnc-machine', version: 1, exportedAt: new Date().toISOString(), machine: m };
    }

    /**
     * Accepts an export file (or a bare profile, or legacy machine_settings.json content).
     * Returns the created/updated profile and whether an existing one was replaced.
     */
    async importMachine(data: unknown, opts: ImportOptions = {}): Promise<{ machine: MachineProfile; replaced: boolean }> {
        if (!isObj(data)) throw new SettingsError('Not a LzrCnc machine file');
        let src: Record<string, any>;
        if (data.format === 'lzrcnc-machine') {
            if (!isObj(data.machine)) throw new SettingsError('Machine file has no machine');
            src = data.machine;
        } else if (isObj(data.settings)) {
            src = data;
        } else if (isObj(data.workbench) && isObj(data.axes)) {
            src = { name: 'Imported machine', settings: data };
        } else {
            throw new SettingsError('Not a LzrCnc machine file');
        }

        const store = await this.load();
        let target = opts.targetId ? this.find(store, opts.targetId) : undefined;
        if (!target && opts.matchByName && typeof src.name === 'string') {
            target = store.machines.find(m => m.name.toLowerCase() === src.name.trim().toLowerCase());
        }

        let result: MachineProfile;
        if (target) {
            const keep = opts.keepConnection !== false;
            result = await this.updateMachine(target.id, {
                name: src.name,
                kind: src.kind,
                notes: src.notes ?? '',
                settings: normalizeSettings(src.settings),
                ...(keep ? {} : { connection: src.connection }),
            });
        } else {
            result = await this.createMachine({ name: src.name, kind: src.kind, notes: src.notes, connection: src.connection, settings: src.settings });
        }
        if (opts.activate) await this.setActive(result.id);
        return { machine: result, replaced: !!target };
    }
}
