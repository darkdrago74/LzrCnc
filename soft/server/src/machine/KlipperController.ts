import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { MachineInterface, MachineStatus } from './MachineInterface.js';

interface PendingRequest {
    resolve: (val: any) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 10000;
/** G-code scripts can block until moves are queued (e.g. G28), allow more time */
const GCODE_TIMEOUT_MS = 120000;

export class KlipperController extends EventEmitter implements MachineInterface {
    /** Moonraker executes scripts one at a time: strict send-and-wait. */
    readonly streamBufferSize = 0;

    private ws: WebSocket | null = null;
    private reqId = 0;
    private pendingRequests = new Map<number, PendingRequest>();
    /** Klipper print_stats.state (standby | printing | paused | complete | cancelled | error) */
    private printState = 'standby';
    private status: MachineStatus = {
        state: 'Disconnected',
        pos: { x: 0, y: 0, z: 0 },
        feedrate: 0,
        spindle: 0,
        logs: []
    };

    async connect(host: string): Promise<void> {
        // host may be "ip" or "ip:port"
        const url = `ws://${host}/websocket`;
        return new Promise((resolve, reject) => {
            let opened = false;
            const ws = new WebSocket(url);
            this.ws = ws;

            ws.on('open', () => {
                opened = true;
                this.status.state = 'Idle';
                this.emitStatus();
                this.subscribeObjects();
                this.fetchConfig();
                resolve();
            });

            ws.on('message', (data: Buffer) => {
                let msg: any;
                try { msg = JSON.parse(data.toString()); } catch { return; }
                this.handleMessage(msg);
            });

            ws.on('close', () => {
                this.rejectAllPending(new Error('Connection closed'));
                this.status.state = 'Disconnected';
                this.emitStatus();
                if (this.ws === ws) this.ws = null;
            });

            ws.on('error', (err) => {
                this.emit('error', err);
                if (!opened) reject(err);
            });
        });
    }

    async disconnect(): Promise<void> {
        const ws = this.ws;
        this.ws = null;
        this.rejectAllPending(new Error('Disconnected'));
        if (ws) ws.close();
        this.status.state = 'Disconnected';
        this.emitStatus();
    }

    async homing(): Promise<void> {
        await this.sendGcode('G28');
    }

    async jog(axis: 'x' | 'y' | 'z', dist: number, feedrate: number): Promise<void> {
        await this.sendGcode(`G91\nG1 ${axis.toUpperCase()}${dist} F${feedrate}\nG90`);
    }

    async uploadFile(gcode: string, _filename: string): Promise<void> {
        for (const line of gcode.split('\n')) {
            const l = line.trim();
            if (l) await this.streamLine(l);
        }
    }

    getStatus(): MachineStatus {
        return this.status;
    }

    async streamLine(line: string): Promise<void> {
        await this.sendGcode(line);
    }

    async command(gcode: string): Promise<void> {
        if (gcode === '!') return this.feedHold();
        if (gcode === '~') return this.cycleResume();
        if (gcode === '\x18') return this.softReset();
        if (gcode === '?') return;
        await this.sendGcode(gcode);
    }

    /** Pauses a virtual_sdcard print; streamed jobs are paused by the job runner withholding lines. */
    async feedHold(): Promise<void> {
        if (this.printState === 'printing') await this.rpcCall('printer.print.pause', {});
    }

    async cycleResume(): Promise<void> {
        if (this.printState === 'paused') await this.rpcCall('printer.print.resume', {});
    }

    async abortJob(): Promise<void> {
        if (this.printState === 'printing' || this.printState === 'paused') {
            try { await this.rpcCall('printer.print.cancel', {}); } catch { /* ignore */ }
        }
        try { await this.sendGcode('M5'); } catch { /* M5 may not be defined in Klipper config */ }
    }

    async softReset(): Promise<void> {
        await this.rpcCall('printer.emergency_stop', {});
    }

    async probe(_options: any): Promise<void> {
        throw new Error('Klipper native probe not yet mapped. Use generic macros.');
    }

    private sendGcode(script: string) {
        return this.rpcCall('printer.gcode.script', { script }, GCODE_TIMEOUT_MS);
    }

    rpcCall(method: string, params: any, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
            const id = ++this.reqId;
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Moonraker request '${method}' timed out`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
        });
    }

    private rejectAllPending(err: Error) {
        for (const p of this.pendingRequests.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pendingRequests.clear();
    }

    private async subscribeObjects() {
        try {
            const res = await this.rpcCall('printer.objects.subscribe', {
                objects: {
                    toolhead: ['position', 'status', 'max_velocity'],
                    print_stats: ['state']
                }
            });
            if (res?.status) this.applyStatus(res.status);
        } catch (e) {
            console.error('Failed to subscribe to Klipper objects', e);
        }
    }

    private emitStatus() {
        this.emit('status', this.status);
    }

    private async fetchConfig() {
        try {
            const response = await this.rpcCall('printer.objects.query', {
                objects: { configfile: null }
            });
            const config = response?.status?.configfile?.config ?? {};

            const limits: any = { x: { min: 0, max: 200 }, y: { min: 0, max: 200 }, z: { min: 0, max: 200 } };
            ['x', 'y', 'z'].forEach(axis => {
                const stepper = config[`stepper_${axis}`];
                if (stepper) {
                    limits[axis] = {
                        min: parseFloat(stepper.position_min) || 0,
                        max: parseFloat(stepper.position_max) || 200
                    };
                }
            });
            this.status.limits = limits;

            this.status.macros = Object.keys(config)
                .filter(key => key.startsWith('gcode_macro '))
                .map(key => key.replace('gcode_macro ', ''));

            this.emitStatus();
        } catch (e) {
            console.error('Failed to fetch Klipper config', e);
        }
    }

    private applyStatus(params: any) {
        if (params?.toolhead?.position) {
            const [x, y, z] = params.toolhead.position;
            this.status.pos = { x, y, z };
        }
        if (params?.print_stats?.state) {
            this.printState = params.print_stats.state;
            if (this.printState === 'paused') this.status.state = 'Hold';
            else if (this.printState === 'printing') this.status.state = 'Run';
            else if (this.status.state === 'Hold' || this.status.state === 'Run') this.status.state = 'Idle';
        }
    }

    /** Handles a Moonraker JSON-RPC message. Public for testing. */
    handleMessage(msg: any) {
        if (msg && msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            const p = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
            else p.resolve(msg.result);
            return;
        }

        if (msg.method === 'notify_status_update') {
            this.applyStatus(msg.params?.[0]);
            this.emitStatus();
        } else if (msg.method === 'notify_gcode_response') {
            const log = msg.params?.[0];
            if (typeof log === 'string') {
                this.status.logs.push(log);
                if (this.status.logs.length > 50) this.status.logs.shift();
                this.emit('log', log);
            }
            this.emitStatus();
        } else if (msg.method === 'notify_klippy_shutdown' || msg.method === 'notify_klippy_disconnected') {
            this.status.state = 'Alarm';
            this.rejectAllPending(new Error('Klipper shutdown'));
            this.emitStatus();
        } else if (msg.method === 'notify_klippy_ready') {
            this.status.state = 'Idle';
            this.emitStatus();
        }
    }
}
