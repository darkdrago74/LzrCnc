import { MachineInterface } from './MachineInterface.js';

export type JobState = 'idle' | 'running' | 'paused' | 'done' | 'stopped' | 'error';

export interface JobStatus {
    state: JobState;
    sent: number;
    acked: number;
    total: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
    currentLine?: string;
}

export class JobConflictError extends Error { }

/** The subset of the controller the runner needs (eases testing). */
export type StreamTarget = Pick<MachineInterface,
    'streamBufferSize' | 'streamLine' | 'feedHold' | 'cycleResume' | 'abortJob' | 'getStatus'>;

/** Removes comments (`; ...` and `( ... )`), whitespace and blank lines. */
export function cleanGcodeLines(input: string | string[]): string[] {
    const lines = Array.isArray(input) ? input.flatMap(l => String(l).split(/\r?\n/)) : input.split(/\r?\n/);
    const out: string[] = [];
    for (const l of lines) {
        const s = l.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
        if (s) out.push(s);
    }
    return out;
}

interface InFlight { bytes: number; done: Promise<void> }

/**
 * Streams G-code to a controller with flow control.
 * streamBufferSize > 0 → GRBL character-counting (keep at most N bytes unacknowledged);
 * streamBufferSize = 0 → send one line and wait for its acknowledgement.
 */
export class JobRunner {
    private status: JobStatus = { state: 'idle', sent: 0, acked: 0, total: 0 };
    private machine: StreamTarget | null = null;
    private stopRequested = false;
    private failed: Error | null = null;
    private resumeWaiters: Array<() => void> = [];
    private runPromise: Promise<void> | null = null;
    /** Resolves when the job is stopped/failed so the loop never waits on acks that won't come. */
    private aborted: Promise<void> = Promise.resolve();
    private signalAbort: () => void = () => { };

    /** Poll interval used while waiting for the machine to become idle at the end. */
    idlePollMs = 250;

    getStatus(): JobStatus {
        return this.status;
    }

    isActive(): boolean {
        return this.status.state === 'running' || this.status.state === 'paused';
    }

    /** Starts streaming; returns immediately. Throws JobConflictError if a job is active. */
    start(machine: StreamTarget, lines: string[]): { total: number } {
        if (this.isActive()) throw new JobConflictError('A job is already running');
        if (lines.length === 0) throw new Error('No G-code lines to send');
        this.machine = machine;
        this.stopRequested = false;
        this.failed = null;
        this.resumeWaiters = [];
        this.aborted = new Promise(r => { this.signalAbort = r; });
        this.status = { state: 'running', sent: 0, acked: 0, total: lines.length, startedAt: Date.now() };
        this.runPromise = this.run(machine, lines);
        return { total: lines.length };
    }

    /** Resolves when the current job loop has finished (for tests). */
    async wait(): Promise<void> {
        await this.runPromise;
    }

    async pause(): Promise<JobState> {
        if (this.status.state !== 'running' || !this.machine) return this.status.state;
        this.status.state = 'paused';
        await this.machine.feedHold();
        return this.status.state;
    }

    async resume(): Promise<JobState> {
        if (this.status.state !== 'paused' || !this.machine) return this.status.state;
        this.status.state = 'running';
        await this.machine.cycleResume();
        this.wakeWaiters();
        return this.status.state;
    }

    async stop(): Promise<JobState> {
        if (!this.isActive() || !this.machine) return this.status.state;
        this.stopRequested = true;
        this.status.state = 'stopped';
        this.status.finishedAt = Date.now();
        this.wakeWaiters();
        try {
            await this.machine.abortJob();
        } catch (e: any) {
            this.status.error = `abort failed: ${e?.message ?? e}`;
        }
        return this.status.state;
    }

    /** Called when the controller disconnects underneath a running job. */
    abandon(reason: string) {
        if (!this.isActive()) return;
        this.stopRequested = true;
        this.status.state = 'error';
        this.status.error = reason;
        this.status.finishedAt = Date.now();
        this.wakeWaiters();
    }

    private wakeWaiters() {
        if (this.shouldAbort()) this.signalAbort();
        const w = this.resumeWaiters;
        this.resumeWaiters = [];
        w.forEach(f => f());
    }

    private waitWhilePaused(): Promise<void> {
        if (this.status.state !== 'paused') return Promise.resolve();
        return new Promise(resolve => this.resumeWaiters.push(resolve));
    }

    private shouldAbort() {
        return this.stopRequested || this.failed !== null;
    }

    private fail(err: Error) {
        if (this.failed || this.stopRequested) return;
        this.failed = err;
        this.status.state = 'error';
        this.status.error = err.message;
        this.status.finishedAt = Date.now();
        this.wakeWaiters();
        this.machine?.abortJob().catch(() => { });
    }

    private async run(machine: StreamTarget, lines: string[]) {
        const bufSize = Math.max(0, machine.streamBufferSize);
        const inflight: InFlight[] = [];
        let used = 0;

        const drainOne = async () => {
            const head = inflight.shift();
            if (!head) return;
            await Promise.race([head.done, this.aborted]);
            used -= head.bytes;
        };

        try {
            for (const line of lines) {
                await this.waitWhilePaused();
                if (this.shouldAbort()) break;
                if (machine.getStatus().state === 'Alarm') throw new Error('Machine in ALARM state');

                const bytes = line.length + 1;
                if (bufSize > 0) {
                    while (inflight.length > 0 && used + bytes > bufSize) {
                        await drainOne();
                        if (this.shouldAbort()) break;
                    }
                } else {
                    while (inflight.length > 0) await drainOne();
                }
                if (this.shouldAbort()) break;
                await this.waitWhilePaused();
                if (this.shouldAbort()) break;

                this.status.sent++;
                this.status.currentLine = line;
                used += bytes;
                const done = machine.streamLine(line).then(
                    () => { if (!this.shouldAbort()) this.status.acked++; },
                    (err: Error) => this.fail(err instanceof Error ? err : new Error(String(err)))
                );
                inflight.push({ bytes, done });
            }

            while (inflight.length > 0 && !this.shouldAbort()) await drainOne();
            if (this.shouldAbort()) return;

            // All lines acknowledged: wait for the motion queue to finish (two consecutive Idle reports)
            let idleCount = 0;
            while (!this.shouldAbort()) {
                const st = machine.getStatus().state;
                if (st === 'Alarm') throw new Error('Machine entered ALARM state');
                if (st === 'Disconnected') throw new Error('Machine disconnected');
                if (st === 'Idle' && this.status.state === 'running') {
                    if (++idleCount >= 2) break;
                } else {
                    idleCount = 0;
                }
                await new Promise(r => setTimeout(r, this.idlePollMs));
            }
            if (this.shouldAbort()) return;

            this.status.state = 'done';
            this.status.finishedAt = Date.now();
        } catch (err: any) {
            this.fail(err instanceof Error ? err : new Error(String(err)));
        }
    }
}
