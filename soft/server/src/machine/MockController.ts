import { EventEmitter } from 'events';
import { MachineInterface, MachineStatus, Position } from './MachineInterface.js';

export interface MockControllerOptions {
    /** Delay before connect() resolves (ms). */
    connectionDelay?: number;
    /** Simulation time acceleration (2 = moves take half the real time). */
    speedFactor?: number;
    /** G0 rapid feed (mm/min). */
    rapidFeed?: number;
    /** Simulation tick (ms). */
    tickMs?: number;
}

interface QueueItem {
    kind: 'move' | 'home' | 'instant';
    target?: Position;
    feed?: number;
    /** Executed once when the item reaches the head of the queue. */
    apply?: () => void;
    started?: boolean;
    resolve: () => void;
    reject: (err: Error) => void;
}

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];
const noop = () => { };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Simulated GRBL-like machine: parses G-code and animates the position over time. */
export class MockController extends EventEmitter implements MachineInterface {
    /** Lets the job runner keep a few lines queued, like GRBL's planner. */
    readonly streamBufferSize = 127;

    private status: MachineStatus;
    private logBuffer: string[] = [];
    private MAX_LOGS = 50;

    private connectionDelay: number;
    private speedFactor: number;
    private rapidFeed: number;
    private tickMs: number;

    // Parser modal state (applies to lines as they are queued)
    private absolute = true;
    private motionMode: 0 | 1 | 2 | 3 = 0;
    private modalFeed = 1000;
    /** Position at the end of the queued moves */
    private plannedPos: Position = { x: 0, y: 0, z: 0 };

    private queue: QueueItem[] = [];
    private held = false;
    private timer: NodeJS.Timeout | null = null;
    private lastTick = 0;

    constructor(opts: MockControllerOptions = {}) {
        super();
        this.connectionDelay = opts.connectionDelay ?? 500;
        this.speedFactor = opts.speedFactor ?? 3;
        this.rapidFeed = opts.rapidFeed ?? 3000;
        this.tickMs = opts.tickMs ?? 20;
        this.status = {
            state: 'Disconnected',
            pos: { x: 0, y: 0, z: 0 },
            feedrate: 0,
            spindle: 0,
            logs: this.logBuffer,
            limits: {
                x: { min: 0, max: 200 },
                y: { min: 0, max: 200 },
                z: { min: 0, max: 200 }
            }
        };
    }

    async connect(pathOrHost: string): Promise<void> {
        this.addLog(`[MOCK] Connecting to ${pathOrHost}...`);
        if (this.connectionDelay > 0) await this.delay(this.connectionDelay);
        this.status.state = 'Idle';
        this.addLog('Grbl 1.1h [MOCK]');
        this.emitStatus();
    }

    async disconnect(): Promise<void> {
        this.clearQueue(new Error('Disconnected'));
        this.stopTicker();
        this.status.state = 'Disconnected';
        this.status.feedrate = 0;
        this.status.spindle = 0;
        this.emitStatus();
    }

    async homing(): Promise<void> {
        await this.enqueueLine('$H');
    }

    async jog(axis: Axis, dist: number, feedrate: number): Promise<void> {
        this.enqueueLine(`$J=G91 ${axis.toUpperCase()}${dist} F${feedrate}`).catch(noop);
    }

    async uploadFile(gcode: string, _filename: string): Promise<void> {
        for (const line of gcode.split('\n')) {
            if (line.trim()) await this.streamLine(line.trim());
        }
    }

    getStatus(): MachineStatus {
        return this.status;
    }

    /** Travel limits reported to the UI (taken from the active machine profile). */
    setLimits(limits: NonNullable<MachineStatus['limits']>): void {
        this.status.limits = limits;
    }

    async command(gcode: string): Promise<void> {
        if (gcode === '!') return this.feedHold();
        if (gcode === '~') return this.cycleResume();
        if (gcode === '\x18') return this.softReset();
        if (gcode === '?') return;
        for (const line of gcode.split(/\r?\n/)) {
            if (!line.trim()) continue;
            this.addLog(`>> ${line.trim()}`);
            this.enqueueLine(line).catch(noop);
            this.addLog('ok');
        }
        this.emitStatus();
    }

    streamLine(line: string): Promise<void> {
        return this.enqueueLine(line);
    }

    async feedHold(): Promise<void> {
        if (this.status.state === 'Disconnected') return;
        this.held = true;
        this.updateState();
    }

    async cycleResume(): Promise<void> {
        this.held = false;
        this.lastTick = Date.now();
        this.updateState();
    }

    async abortJob(): Promise<void> {
        await this.softReset();
        this.addLog('[MOCK] Job aborted, laser off');
    }

    async softReset(): Promise<void> {
        this.clearQueue(new Error('Soft reset'));
        this.held = false;
        this.status.spindle = 0;
        this.plannedPos = { ...this.status.pos };
        this.absolute = true;
        this.motionMode = 0;
        this.stopTicker();
        if (this.status.state !== 'Disconnected') this.status.state = 'Idle';
        this.status.feedrate = 0;
        this.emitStatus();
    }

    async probe(options: { axis: 'z'; feedrate: number; dist: number; plateThickness: number; retract: number; }): Promise<void> {
        this.addLog(`[Probe] Searching for surface at F${options.feedrate}...`);
        this.status.state = 'Run';
        this.emitStatus();
        await this.delay(1500 / this.speedFactor);
        this.addLog('[Probe] Contact! Setting Z.');
        this.status.pos.z = options.plateThickness;
        await this.delay(500 / this.speedFactor);
        this.status.pos.z = options.retract;
        this.plannedPos = { ...this.status.pos };
        this.addLog(`[Probe] Retracted to ${options.retract}`);
        this.status.state = 'Idle';
        this.emitStatus();
    }

    // ── Parser ─────────────────────────────────────────────────────────

    private enqueueLine(raw: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.status.state === 'Disconnected') return reject(new Error('Not connected'));
            const items = this.parseLine(raw);
            if (items.length === 0) {
                items.push({ kind: 'instant' });
            }
            items.forEach((it, i) => {
                const last = i === items.length - 1;
                this.queue.push({
                    ...it,
                    resolve: last ? resolve : noop,
                    reject: last ? reject : noop,
                });
            });
            this.startTicker();
        });
    }

    private parseLine(raw: string): Array<Omit<QueueItem, 'resolve' | 'reject'>> {
        const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim().toUpperCase();
        if (!line) return [];

        if (line.startsWith('$H')) {
            this.plannedPos = { x: 0, y: 0, z: 0 };
            return [{ kind: 'home', target: { x: 0, y: 0, z: 0 }, feed: this.rapidFeed }];
        }
        if (line.startsWith('$J=')) {
            const w = this.words(line.substring(3));
            const rel = w.g.includes(91) ? true : w.g.includes(90) ? false : !this.absolute;
            const target = this.computeTarget(w.axes, rel);
            const feed = w.f ?? this.modalFeed;
            this.plannedPos = target;
            return [{ kind: 'move', target, feed }];
        }
        if (line.startsWith('$')) return [];

        const w = this.words(line);
        const items: Array<Omit<QueueItem, 'resolve' | 'reject'>> = [];
        let nonModalCoordSet = false;
        let homeMove = false;

        for (const g of w.g) {
            if (g === 90) this.absolute = true;
            else if (g === 91) this.absolute = false;
            else if (g === 0 || g === 1 || g === 2 || g === 3) this.motionMode = g;
            else if (g === 92 || (g === 10 && w.l === 20)) nonModalCoordSet = true;
            else if (g === 28) homeMove = true;
        }
        if (w.f !== undefined && w.f > 0) this.modalFeed = w.f;

        const s = w.s;
        const m = w.m;
        if (s !== undefined || m.length > 0) {
            items.push({
                kind: 'instant',
                apply: () => {
                    if (m.includes(5)) this.status.spindle = 0;
                    else if (s !== undefined) this.status.spindle = s;
                }
            });
        }

        if (nonModalCoordSet) {
            const values = w.axes;
            for (const a of AXES) if (values[a] !== undefined) this.plannedPos[a] = values[a]!;
            items.push({
                kind: 'instant',
                apply: () => { for (const a of AXES) if (values[a] !== undefined) this.status.pos[a] = values[a]!; }
            });
        } else if (homeMove) {
            this.plannedPos = { x: 0, y: 0, z: 0 };
            items.push({ kind: 'move', target: { x: 0, y: 0, z: 0 }, feed: this.rapidFeed });
        } else if (Object.keys(w.axes).length > 0) {
            const target = this.computeTarget(w.axes, !this.absolute);
            const feed = this.motionMode === 0 ? this.rapidFeed : this.modalFeed;
            this.plannedPos = target;
            items.push({ kind: 'move', target, feed });
        }
        return items;
    }

    private computeTarget(axes: Partial<Record<Axis, number>>, relative: boolean): Position {
        const t = { ...this.plannedPos };
        for (const a of AXES) {
            const v = axes[a];
            if (v === undefined) continue;
            t[a] = relative ? t[a] + v : v;
        }
        return t;
    }

    private words(line: string) {
        const res = { g: [] as number[], m: [] as number[], axes: {} as Partial<Record<Axis, number>>, f: undefined as number | undefined, s: undefined as number | undefined, l: undefined as number | undefined };
        const re = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(line))) {
            const letter = mm[1];
            const v = parseFloat(mm[2]);
            switch (letter) {
                case 'G': res.g.push(v); break;
                case 'M': res.m.push(v); break;
                case 'X': res.axes.x = v; break;
                case 'Y': res.axes.y = v; break;
                case 'Z': res.axes.z = v; break;
                case 'F': res.f = v; break;
                case 'S': res.s = v; break;
                case 'L': res.l = v; break;
            }
        }
        return res;
    }

    // ── Simulation ─────────────────────────────────────────────────────

    private startTicker() {
        if (this.timer) return;
        this.lastTick = Date.now();
        this.timer = setInterval(() => this.tick(), this.tickMs);
        this.tick();
    }

    private stopTicker() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private tick() {
        const now = Date.now();
        const elapsed = Math.min(200, Math.max(0, now - this.lastTick));
        this.lastTick = now;
        let budget = (elapsed / 1000) * this.speedFactor; // seconds of machine time

        while (!this.held && this.queue.length > 0) {
            const head = this.queue[0];
            if (!head.started) {
                head.started = true;
                head.apply?.();
            }
            if (head.kind === 'instant' || !head.target) {
                this.queue.shift();
                head.resolve();
                continue;
            }
            const pos = this.status.pos;
            const dx = head.target.x - pos.x, dy = head.target.y - pos.y, dz = head.target.z - pos.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const v = Math.max(1, head.feed ?? this.modalFeed) / 60; // mm/s
            this.status.feedrate = head.feed ?? 0;
            if (d / v <= budget) {
                budget -= d / v;
                this.status.pos = { ...head.target };
                this.queue.shift();
                head.resolve();
                continue;
            }
            if (budget <= 0) break;
            const k = (v * budget) / d;
            this.status.pos = { x: r3(pos.x + dx * k), y: r3(pos.y + dy * k), z: r3(pos.z + dz * k) };
            budget = 0;
            break;
        }

        this.updateState();
        if (this.queue.length === 0 && !this.held) this.stopTicker();
    }

    private updateState() {
        if (this.status.state === 'Disconnected') return;
        if (this.held) this.status.state = 'Hold';
        else if (this.queue.length > 0) this.status.state = this.queue[0].kind === 'home' ? 'Home' : 'Run';
        else {
            this.status.state = 'Idle';
            this.status.feedrate = 0;
        }
        this.emitStatus();
    }

    private clearQueue(err: Error) {
        const q = this.queue;
        this.queue = [];
        for (const it of q) it.reject(err);
    }

    private emitStatus() {
        this.emit('status', this.status);
    }

    private addLog(msg: string) {
        this.logBuffer.push(msg);
        if (this.logBuffer.length > this.MAX_LOGS) this.logBuffer.shift();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
