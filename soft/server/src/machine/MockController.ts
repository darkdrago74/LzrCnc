import { EventEmitter } from 'events';
import { MachineInterface, MachineStatus, Position } from './MachineInterface.js';

export class MockController extends EventEmitter implements MachineInterface {
    private status: MachineStatus = {
        state: 'Disconnected',
        pos: { x: 0, y: 0, z: 0 },
        feedrate: 0,
        spindle: 0,
        logs: [],
        limits: {
            x: { min: 0, max: 200 },
            y: { min: 0, max: 200 },
            z: { min: 0, max: 200 }
        }
    };

    private connectionDelay = 500;

    async connect(pathOrHost: string): Promise<void> {
        return new Promise((resolve) => {
            console.log(`[MOCK] Connecting to ${pathOrHost}...`);
            setTimeout(() => {
                this.status.state = 'Idle';
                console.log('[MOCK] Connected.');
                this.emitStatus();
                resolve();
            }, this.connectionDelay);
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((resolve) => {
            console.log('[MOCK] Disconnecting...');
            setTimeout(() => {
                this.status.state = 'Disconnected';
                this.emitStatus();
                resolve();
            }, 200);
        });
    }

    async homing(): Promise<void> {
        console.log('[MOCK] Homing...');
        this.status.state = 'Run';
        this.emitStatus();

        await this.delay(1000);

        this.status.pos = { x: 0, y: 0, z: 0 };
        this.status.state = 'Idle';
        this.emitStatus();
    }

    async jog(axis: 'x' | 'y' | 'z', dist: number, feedrate: number): Promise<void> {
        console.log(`[MOCK] Jogging ${axis} by ${dist} at ${feedrate}`);
        this.status.state = 'Run';
        this.status.feedrate = feedrate;
        this.emitStatus();

        // Simulate movement time
        await this.delay(500);

        this.status.pos[axis] += dist;
        this.status.state = 'Idle';
        this.status.feedrate = 0;
        this.emitStatus();
    }

    async uploadFile(gcode: string, filename: string): Promise<void> {
        console.log(`[MOCK] Uploading file ${filename} (${gcode.length} bytes)`);
        const lines = gcode.split('\n');

        this.status.state = 'Run';
        this.emitStatus();

        // Simulate processing lines
        for (let i = 0; i < lines.length; i++) {
            if (i % 10 === 0) await this.delay(10); // Throttle
        }

        console.log('[MOCK] Job Finished');
        this.status.state = 'Idle';
        this.emitStatus();
    }

    getStatus(): MachineStatus {
        return this.status;
    }

    async command(gcode: string): Promise<void> {
        console.log(`[MOCK] CMD: ${gcode}`);
        this.addLog(`>> ${gcode}`);
        this.addLog(`ok`);
        this.emitStatus();
    }

    async probe(options: { axis: 'z'; feedrate: number; dist: number; plateThickness: number; retract: number; }): Promise<void> {
        console.log('[MOCK] Probing...');
        this.addLog(`[Probe] Searching for surface at F${options.feedrate}...`);
        this.status.state = 'Run';
        this.emitStatus();

        await this.delay(1500); // Simulate probe time

        this.addLog('[Probe] Contact! Setting Z.');
        this.status.pos.z = options.plateThickness;

        await this.delay(500);
        this.status.pos.z = options.retract;
        this.addLog(`[Probe] Retracted to ${options.retract}`);

        this.status.state = 'Idle';
        this.emitStatus();
    }

    private emitStatus() {
        this.status.logs = this.logBuffer;
        this.emit('status', this.status);
    }

    // Log helpers
    private logBuffer: string[] = [];
    private MAX_LOGS = 50;

    private addLog(msg: string) {
        this.logBuffer.push(msg);
        if (this.logBuffer.length > this.MAX_LOGS) this.logBuffer.shift();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
