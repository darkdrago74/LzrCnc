import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { MachineInterface, MachineStatus, Position } from './MachineInterface.js';

export class GrblController extends EventEmitter implements MachineInterface {
    private port: SerialPort | null = null;
    private parser: ReadlineParser | null = null;
    private status: MachineStatus = {
        state: 'Disconnected',
        pos: { x: 0, y: 0, z: 0 },
        feedrate: 0,
        spindle: 0,
        logs: []
    };

    async connect(path: string, baudRate: number = 115200): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port = new SerialPort({ path, baudRate, autoOpen: false });

            this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            this.port.open((err) => {
                if (err) return reject(err);
                this.status.state = 'Idle'; // Assume idle on connect
                this.emitStatus();
                // Fetch Settings
                setTimeout(() => {
                    this.send('$$');
                }, 500); // Small delay to let bootloader settle

                // Start Status Polling Loop
                this.startPolling();

                resolve();
            });

            this.parser.on('data', (line: string) => {
                this.parseResponse(line);
            });

            this.port.on('close', () => {
                this.stopPolling();
                this.status.state = 'Disconnected';
                this.emitStatus();
                this.port = null;
            });

            this.port.on('error', (err) => {
                this.emit('error', err);
            });
        });
    }

    private pollTimer: NodeJS.Timeout | null = null;
    private startPolling() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
            if (this.port && this.port.isOpen) {
                this.send('?');
            }
        }, 200);
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async disconnect(): Promise<void> {
        if (this.port && this.port.isOpen) {
            return new Promise((resolve) => {
                this.port?.close(() => resolve());
            });
        }
    }

    async homing(): Promise<void> {
        this.send('$H');
    }

    async jog(axis: 'x' | 'y' | 'z', dist: number, feedrate: number): Promise<void> {
        // GRBL Jog command: $J=G91 X10 F1000
        const cmd = `$J=G91 ${axis.toUpperCase()}${dist} F${feedrate}`;
        this.send(cmd);
    }

    async uploadFile(gcode: string, filename: string): Promise<void> {
        const lines = gcode.split('\n');
        for (const line of lines) {
            if (line.trim().length > 0) {
                this.send(line.trim());
                // Simple flow control would be needed here (wait for 'ok')
                // For prototype, we just send. In real implementation, manage buffer.
            }
        }
    }

    getStatus(): MachineStatus {
        return this.status;
    }

    private emitStatus() {
        this.emit('status', this.status);
    }

    private send(cmd: string) {
        if (this.port && this.port.isOpen) {
            this.port.write(cmd + '\n');
        }
    }

    private addLog(message: string) {
        this.status.logs.push(message);
        if (this.status.logs.length > this.MAX_LOGS) {
            this.status.logs.shift();
        }
    }

    private logBuffer: string[] = [];
    private MAX_LOGS = 50;

    async command(gcode: string): Promise<void> {
        this.send(gcode);
    }

    async probe(options: { axis: 'z', feedrate: number, dist: number, plateThickness: number, retract: number }): Promise<void> {
        // Basic G38.2 implementation for GRBL
        // G38.2 Z-10 F10
        const cmd = `G38.2 ${options.axis.toUpperCase()}${options.dist} F${options.feedrate}`;
        this.send(cmd);
        // For prototype, we just resolve. Real implementation needs status monitoring for contact.
        return Promise.resolve();
    }



    // ... (rest is same)

    private parseResponse(line: string) {
        const cleanLine = line.trim();
        if (cleanLine) {
            this.addLog(cleanLine);
            this.emit('log', cleanLine);
        }

        // Example: <Idle|MPos:0.000,0.000,0.000|FS:0,0>
        if (line.startsWith('<')) {
            const content = line.replace(/[<>]/g, '');
            const parts = content.split('|');
            const stateStr = parts[0];

            this.status.state = stateStr as any;

            for (let i = 1; i < parts.length; i++) {
                if (parts[i].startsWith('MPos:')) {
                    const coords = parts[i].substring(5).split(',');
                    this.status.pos = {
                        x: parseFloat(coords[0]),
                        y: parseFloat(coords[1]),
                        z: parseFloat(coords[2])
                    };
                } else if (parts[i].startsWith('WPos:')) {
                    const coords = parts[i].substring(5).split(',');
                    this.status.pos = {
                        x: parseFloat(coords[0]),
                        y: parseFloat(coords[1]),
                        z: parseFloat(coords[2])
                    };
                } else if (parts[i].startsWith('Pn:')) {
                    this.status.ports = parts[i].substring(3);
                }
            }
            this.emitStatus();
        } else if (cleanLine.startsWith('$')) {
            // Settings response: $130=200.000
            const match = /^\$([0-9]+)=([0-9\.]+)/.exec(cleanLine);
            if (match) {
                const id = parseInt(match[1]);
                const val = parseFloat(match[2]);

                // Initialize if missing
                if (!this.status.grblSettings) {
                    this.status.grblSettings = {};
                }
                // Store raw value
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

                // Debounce emit if multiple settings come in? 
                // For now, emit is cheap enough or we can wait.
                this.emitStatus();
            }
        }
    }
}
