import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsService } from '../src/services/SettingsService';

describe('SettingsService machine profiles', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lzr-settings-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('migrates the legacy machine_settings.json into a first named profile', async () => {
        fs.writeFileSync(path.join(dir, 'machine_settings.json'), JSON.stringify({ workbench: { width: 420, height: 297 } }));
        const svc = new SettingsService(dir);
        const store = await svc.listMachines();
        expect(store.machines).toHaveLength(1);
        expect(store.machines[0].name).toBe('My machine');
        expect(store.machines[0].settings.workbench).toMatchObject({ width: 420, height: 297, depth: 50 });
        expect(store.activeId).toBe(store.machines[0].id);
        expect(fs.existsSync(path.join(dir, 'machines.json'))).toBe(true);
        // reloads from disk
        expect((await new SettingsService(dir).getSettings()).workbench.width).toBe(420);
    });

    it('keeps names unique, switches the active machine and refuses to delete the last one', async () => {
        const svc = new SettingsService(dir);
        const first = await svc.getActive();
        const copy = await svc.createMachine({ copyFromId: first.id, name: first.name });
        expect(copy.name).toBe('My machine (2)');
        await svc.setActive(copy.id);
        expect((await svc.getActive()).id).toBe(copy.id);
        await svc.deleteMachine(copy.id);
        expect((await svc.getActive()).id).toBe(first.id);
        await expect(svc.deleteMachine(first.id)).rejects.toThrow(/last machine/);
    });

    it('export → import on another server replaces the same-name machine but keeps its local port', async () => {
        const pc = new SettingsService(dir);
        const laser = await pc.createMachine({ name: 'Diode laser', connection: { type: 'grbl', port: 'COM6', baud: 115200 } });
        await pc.updateMachine(laser.id, { settings: { workbench: { width: 410, height: 400 } } });
        const file = await pc.exportMachine(laser.id);
        expect(file.format).toBe('lzrcnc-machine');

        const piDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lzr-pi-'));
        try {
            const pi = new SettingsService(piDir);
            const onPi = await pi.createMachine({ name: 'diode LASER', connection: { type: 'grbl', port: '/dev/ttyUSB0' } });
            const res = await pi.importMachine(JSON.parse(JSON.stringify(file)), { matchByName: true });
            expect(res.replaced).toBe(true);
            expect(res.machine.id).toBe(onPi.id);
            expect(res.machine.settings.workbench.width).toBe(410);
            expect(res.machine.connection.port).toBe('/dev/ttyUSB0');

            const added = await pi.importMachine(file, { activate: true });
            expect(added.replaced).toBe(false);
            expect(added.machine.name).toBe('Diode laser (2)');
            expect((await pi.getActive()).id).toBe(added.machine.id);
        } finally {
            fs.rmSync(piDir, { recursive: true, force: true });
        }
    });

    it('rejects files that are not machine profiles and sanitises bad values', async () => {
        const svc = new SettingsService(dir);
        await expect(svc.importMachine({ hello: 1 })).rejects.toThrow(/Not a LzrCnc machine file/);
        const { machine } = await svc.importMachine({ format: 'lzrcnc-machine', version: 1, machine: { name: '  ', settings: { workbench: { width: 'x', origin: 'middle' } } } });
        expect(machine.name).toBe('New machine');
        expect(machine.settings.workbench.width).toBe(300);
        expect(machine.settings.workbench.origin).toBe('bottom-left');
    });
});
