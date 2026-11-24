import { describe, it, expect } from 'vitest';
import { JobRunner, cleanGcodeLines, StreamTarget } from '../src/machine/JobRunner';
import { GrblController } from '../src/machine/GrblController';
import { MachineStatus } from '../src/machine/MachineInterface';

/** Fake controller that records lines and lets the test ack them manually. */
class FakeController implements StreamTarget {
    streamBufferSize = 20;
    sent: string[] = [];
    acks: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    aborted = 0;
    held = 0;
    status = { state: 'Idle', pos: { x: 0, y: 0, z: 0 }, feedrate: 0, spindle: 0, logs: [] } as MachineStatus;
    streamLine(line: string) {
        this.sent.push(line);
        return new Promise<void>((resolve, reject) => this.acks.push({ resolve, reject }));
    }
    ackNext() { this.acks.shift()!.resolve(); }
    async feedHold() { this.held++; }
    async cycleResume() { }
    async abortJob() { this.aborted++; }
    getStatus() { return this.status; }
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('JobRunner', () => {
    it('strips comments and blank lines', () => {
        expect(cleanGcodeLines('G0 X1 ; move\n\n(comment)\n  G1 X2 (inline) Y3 \n;only')).toEqual(['G0 X1', 'G1 X2  Y3']);
        expect(cleanGcodeLines(['M5', '', 'G0 X0\nG1 X1'])).toEqual(['M5', 'G0 X0', 'G1 X1']);
    });

    it('respects the character-counting buffer and completes', async () => {
        const fake = new FakeController();
        const runner = new JobRunner();
        runner.idlePollMs = 1;
        const lines = ['G1 X1', 'G1 X2', 'G1 X3', 'G1 X4', 'G1 X5']; // 6 bytes each, buffer 20 → 3 in flight
        expect(runner.start(fake, lines)).toEqual({ total: 5 });
        await tick();
        expect(fake.sent).toHaveLength(3);
        fake.ackNext();
        await tick(); await tick();
        expect(fake.sent).toHaveLength(4);
        while (fake.acks.length) { fake.ackNext(); await tick(); await tick(); }
        await runner.wait();
        const st = runner.getStatus();
        expect(st.state).toBe('done');
        expect(st.sent).toBe(5);
        expect(st.acked).toBe(5);
        expect(st.finishedAt).toBeDefined();
    });

    it('stops on controller error and aborts the machine', async () => {
        const fake = new FakeController();
        fake.streamBufferSize = 0;
        const runner = new JobRunner();
        runner.start(fake, ['G1 X1', 'G1 X2', 'G1 X3']);
        await tick();
        expect(fake.sent).toHaveLength(1);
        fake.acks.shift()!.reject(new Error('GRBL error:20'));
        await runner.wait();
        expect(runner.getStatus().state).toBe('error');
        expect(runner.getStatus().error).toContain('error:20');
        expect(fake.sent).toHaveLength(1);
        expect(fake.aborted).toBe(1);
        expect(() => runner.start(fake, ['G0 X0'])).not.toThrow();
    });

    it('pause withholds lines, resume continues, stop aborts', async () => {
        const fake = new FakeController();
        fake.streamBufferSize = 0;
        const runner = new JobRunner();
        runner.start(fake, ['G1 X1', 'G1 X2', 'G1 X3']);
        await tick();
        expect(await runner.pause()).toBe('paused');
        expect(fake.held).toBe(1);
        fake.ackNext();
        await tick(); await tick();
        expect(fake.sent).toHaveLength(1);
        expect(runner.isActive()).toBe(true);
        expect(() => runner.start(fake, ['G0'])).toThrow();
        expect(await runner.resume()).toBe('running');
        await tick(); await tick();
        expect(fake.sent).toHaveLength(2);
        expect(await runner.stop()).toBe('stopped');
        expect(fake.aborted).toBe(1);
        await runner.wait();
        expect(runner.getStatus().state).toBe('stopped');
    });

    it('streams through GrblController with ok/error handling', async () => {
        const written: string[] = [];
        const grbl = new GrblController();
        grbl.attachTransport({ isOpen: true, write: (d: string) => { written.push(d); } });
        const runner = new JobRunner();
        runner.idlePollMs = 1;
        runner.start(grbl, ['G0 X1', 'G1 X2 F100']);
        await tick();
        expect(written).toEqual(['G0 X1\n', 'G1 X2 F100\n']);
        grbl.handleLine('ok');
        grbl.handleLine('<Run|MPos:11.000,2.000,0.000|FS:100,0|WCO:10.000,0.000,0.000>');
        expect(grbl.getStatus().pos).toEqual({ x: 1, y: 2, z: 0 });
        grbl.handleLine('ok');
        grbl.handleLine('<Idle|MPos:12.000,2.000,0.000|FS:0,0>'); // WCO remembered
        expect(grbl.getStatus().pos.x).toBe(2);
        await runner.wait();
        expect(runner.getStatus()).toMatchObject({ state: 'done', sent: 2, acked: 2 });

        grbl.handleLine('$27=-1.500');
        expect(grbl.getStatus().grblSettings?.[27]).toBe(-1.5);
        await grbl.feedHold();
        expect(written[written.length - 1]).toBe('!');
    });
});
