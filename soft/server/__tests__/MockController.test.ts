import { describe, it, expect, afterEach, vi } from 'vitest';
import { MockController } from '../src/machine/MockController';

describe('MockController', () => {
    let mock: MockController;
    afterEach(async () => { await mock?.disconnect(); });

    it('animates G0 moves to the target and returns to Idle', async () => {
        mock = new MockController({ connectionDelay: 0, speedFactor: 4 });
        await mock.connect('mock');
        await mock.command('G0 X10');
        expect(mock.getStatus().state).toBe('Run');
        await vi.waitFor(() => expect(mock.getStatus().pos.x).toBe(10), { timeout: 2000 });
        expect(mock.getStatus().state).toBe('Idle');
    });

    it('streamLine resolves after the move; supports G91, jog, G92 and $H', async () => {
        mock = new MockController({ connectionDelay: 0, speedFactor: 50 });
        await mock.connect('mock');
        await mock.streamLine('G1 X5 Y5 F6000');
        expect(mock.getStatus().pos).toEqual({ x: 5, y: 5, z: 0 });
        await mock.streamLine('G91');
        await mock.streamLine('G0 X1 Y-2');
        expect(mock.getStatus().pos).toEqual({ x: 6, y: 3, z: 0 });
        await mock.streamLine('$J=G90 Z3 F3000');
        expect(mock.getStatus().pos.z).toBe(3);
        await mock.streamLine('G92 X0 Y0');
        expect(mock.getStatus().pos).toEqual({ x: 0, y: 0, z: 3 });
        await mock.streamLine('$H');
        expect(mock.getStatus().pos).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('holds, resumes and resets', async () => {
        mock = new MockController({ connectionDelay: 0, speedFactor: 1 });
        await mock.connect('mock');
        const done = mock.streamLine('G1 X100 F600');
        await mock.feedHold();
        expect(mock.getStatus().state).toBe('Hold');
        const x = mock.getStatus().pos.x;
        await new Promise(r => setTimeout(r, 100));
        expect(mock.getStatus().pos.x).toBe(x);
        await mock.cycleResume();
        expect(mock.getStatus().state).toBe('Run');
        await mock.softReset();
        await expect(done).rejects.toThrow();
        expect(mock.getStatus().state).toBe('Idle');
    });
});
