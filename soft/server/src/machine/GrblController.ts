import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { MachineInterface, MachineStatus, Position } from './MachineInterface.js';

interface PendingAck {
    line: string;
    resolve: () => void;
    reject: (err: Error) => void;
}

/** Minimal writable transport so the controller can be tested without a serial port. */
export interface GrblTransport {
    write(data: string): void;
    isOpen: boolean;
}

const noop = () => { };

export class GrblController extends EventEmitter implements MachineInterface {
    readonly streamBufferSize = 127; // GRBL serial RX buffer (character-counting protocol)

    private port: SerialPort | null = null;
    private parser: ReadlineParser | null = null;
    private transport: GrblTransport | null = null;
    private status: MachineStatus = {
        state: 'Disconnected',
        pos: { x: 0, y: 0, z: 0 },
        feedrate: 0,
        spindle: 0,
        logs: []
    };
    /** Raw GRBL state incl. substate, e.g. "Hold:0" */
    private rawState = '';
    private wco: Position = { x: 0, y: 0, z: 0 };
    /** FIFO of lines awaiting 'ok' / 'error:N' (GRBL answers every line in order) */
    private pending: PendingAck[] = [];
    private MAX_LOGS = 50;

    async connect(path: string, baudRate: number = 115200): Promise<void> {
        return new Promise((resolve, reject) => {
            const port = new SerialPort({ path, baudRate, autoOpen: false });
            this.port = port;
            this.parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

            port.open((err) => {
                if (err) {
                    this.port = null;
                    return reject(err);
                }
                this.attachTransport(port);
                this.status.state = 'Idle'; // Assume idle until first status report
                this.emitStatus();
                setTimeout(() => this.send('$$'), 500); // let the bootloader settle
                this.startPolling();
                resolve();
            });

            this.parser.on('data', (line: string) => this.handleLine(line));

            port.on('close', () => {
                this.stopPolling();
                this.rejectAllPending(new Error('Port closed'));
                this.status.state = 'Disconnected';
                this.emitStatus();
                this.port = null;
                this.transport = null;
            });

            port.on('error', (err) => this.emit('error', err));
        });
    }

    /** Use an arbitrary transport (tests / alternative links). */
    attachTransport(transport: GrblTransport) {
        this.transport = transport;
        if (this.status.state === 'Disconnected') this.status.state = 'Idle';
    }

    private pollTimer: NodeJS.Timeout | null = null;
    private startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(() => this.writeRealtime('?'), 200);
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async disconnect(): Promise<void> {
        this.stopPolling();
        this.rejectAllPending(new Error('Disconnected'));
        const port = this.port;
        if (port && port.isOpen) {
            await new Promise<void>((resolve) => port.close(() => resolve()));
        }
        this.port = null;
        this.transport = null;
        this.status.state = 'Disconnected';
        this.emitStatus();
    }

    async homing(): Promise<void> {
        this.send('$H');
    }

    async jog(axis: 'x' | 'y' | 'z', dist: number, feedrate: number): Promise<void> {
        this.send(`$J=G91 ${axis.toUpperCase()}${dist} F${feedrate}`);
    }

    /** Simple send-response streaming (one line in flight). */
    async uploadFile(gcode: string, _filename: string): Promise<void> {
        for (const line of gcode.split('\n')) {
            const l = line.trim();
            if (l) await this.streamLine(l);
        }
    }

    getStatus(): MachineStatus {
        return this.status;
    }

    streamLine(line: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.transport || !this.transport.isOpen) return reject(new Error('Not connected'));
            this.pending.push({ line, resolve, reject });
            this.transport.write(line + '\n');
        });
    }

    async command(gcode: string): Promise<void> {
        const rt = gcode === '!' || gcode === '~' || gcode === '?' || gcode === '\x18';
        if (rt) {
            if (gcode === '\x18') return this.softReset();
            this.writeRealtime(gcode);
            return;
        }
        for (const line of gcode.split(/\r?\n/)) {
            if (line.trim()) this.send(line.trim());
        }
    }

    async feedHold(): Promise<void> { this.writeRealtime('!'); }
    async cycleResume(): Promise<void> { this.writeRealtime('~'); }

    async softReset(): Promise<void> {
        this.writeRealtime('\x18');
        // GRBL flushes its buffers on reset: outstanding lines will never be acknowledged.
        this.rejectAllPending(new Error('Soft reset'));
    }

    async abortJob(): Promise<void> {
        const moving = ['Run', 'Jog', 'Hold'].includes(this.status.state);
        if (moving) {
            this.writeRealtime('!');
            // Wait for the deceleration to finish (Hold:0) so the reset doesn't lose position
            await this.waitFor(() => this.rawState === 'Hold:0' || this.status.state === 'Idle', 3000);
        }
        await this.softReset();
        await this.delay(300);
        this.send('M5');
    }

    async probe(options: { axis: 'z', feedrate: number, dist: number, plateThickness: number, retract: number }): Promise<void> {
        this.send(`G38.2 ${options.axis.toUpperCase()}${options.dist} F${options.feedrate}`);
    }

    // ── Internals ──────────────────────────────────────────────────────

    private emitStatus() {
        this.emit('status', this.status);
    }

    /** Line command (expects an 'ok'). Callers that don't await still occupy the ack FIFO. */
    private send(cmd: string) {
        if (!this.transport || !this.transport.isOpen) return;
        this.pending.push({ line: cmd, resolve: noop, reject: noop });
        this.transport.write(cmd + '\n');
    }

    /** Realtime single-byte command: no newline, no ack. */
    private writeRealtime(ch: string) {
        if (this.transport && this.transport.isOpen) this.transport.write(ch);
    }

    private rejectAllPending(err: Error) {
        const p = this.pending;
        this.pending = [];
        for (const a of p) a.reject(err);
    }

    private addLog(message: string) {
        this.status.logs.push(message);
        if (this.status.logs.length > this.MAX_LOGS) this.status.logs.shift();
    }

    private waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            const start = Date.now();
            const t = setInterval(() => {
                if (cond() || Date.now() - start > timeoutMs) {
                    clearInterval(t);
                    resolve();
                }
            }, 20);
        });
    }

    private delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

    /** Parses one line received from GRBL. Public for testing. */
    handleLine(line: string) {
        const cleanLine = line.trim();
        if (!cleanLine) return;

        if (cleanLine.startsWith('<')) {
            this.parseStatusReport(cleanLine);
            return;
        }

        this.addLog(cleanLine);
        this.emit('log', cleanLine);

        if (cleanLine === 'ok') {
            this.pending.shift()?.resolve();
        } else if (cleanLine.startsWith('error:')) {
            const p = this.pending.shift();
            p?.reject(new Error(`GRBL ${cleanLine}${p ? ` on line "${p.line}"` : ''}`));
        } else if (cleanLine.startsWith('ALARM:')) {
            this.status.state = 'Alarm';
            this.rejectAllPending(new Error(`GRBL ${cleanLine}`));
            this.emitStatus();
        } else if (/^Grbl\s/i.test(cleanLine)) {
            // Welcome banner after reset/connect: all buffered lines were discarded
            this.rejectAllPending(new Error('Controller reset'));
        } else if (cleanLine.startsWith('$')) {
            this.parseSetting(cleanLine);
        }
    }

    private parseCoords(s: string): Position {
        const c = s.split(',').map(parseFloat);
        return { x: c[0] || 0, y: c[1] || 0, z: c[2] || 0 };
    }

    private parseStatusReport(line: string) {
        // <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>
        const parts = line.replace(/[<>]/g, '').split('|');
        this.rawState = parts[0];
        this.status.state = parts[0].split(':')[0] as MachineStatus['state'];

        let mpos: Position | null = null;
        let wpos: Position | null = null;
        for (let i = 1; i < parts.length; i++) {
            const p = parts[i];
            if (p.startsWith('MPos:')) mpos = this.parseCoords(p.substring(5));
            else if (p.startsWith('WPos:')) wpos = this.parseCoords(p.substring(5));
            else if (p.startsWith('WCO:')) this.wco = this.parseCoords(p.substring(4));
            else if (p.startsWith('Pn:')) this.status.ports = p.substring(3);
            else if (p.startsWith('FS:')) {
                const [f, s] = p.substring(3).split(',').map(parseFloat);
                this.status.feedrate = f || 0;
                this.status.spindle = s || 0;
            } else if (p.startsWith('F:')) {
                this.status.feedrate = parseFloat(p.substring(2)) || 0;
            }
        }
        if (!parts.some(p => p.startsWith('Pn:'))) this.status.ports = undefined;

        if (wpos) {
            this.status.pos = wpos;
        } else if (mpos) {
            this.status.pos = {
                x: round3(mpos.x - this.wco.x),
                y: round3(mpos.y - this.wco.y),
                z: round3(mpos.z - this.wco.z),
            };
        }
        this.emitStatus();
    }

    private parseSetting(line: string) {
        // $130=200.000  (values may be negative)
        const match = /^\$([0-9]+)=(-?[0-9.]+)/.exec(line);
        if (!match) return;
        const id = parseInt(match[1]);
        const val = parseFloat(match[2]);

        if (!this.status.grblSettings) this.status.grblSettings = {};
        this.status.grblSettings[id] = val;

        if (!this.status.limits) {
            this.status.limits = {
                x: { min: 0, max: 200 },
                y: { min: 0, max: 200 },
                z: { min: 0, max: 200 }
            };
        }
        if (id === 130) this.status.limits.x.max = val;
        if (id === 131) this.status.limits.y.max = val;
        if (id === 132) this.status.limits.z.max = val;
        this.emitStatus();
    }
}

function round3(v: number) { return Math.round(v * 1000) / 1000; }
