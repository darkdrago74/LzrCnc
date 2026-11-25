import { FastifyInstance } from 'fastify';
import { SettingsService, MachineSettings, SettingsError } from '../services/SettingsService.js';
import { exec } from 'child_process';
import util from 'util';
import { resolvePath } from '../utils/pathUtils.js';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);

export default async function settingsRoutes(server: FastifyInstance, options: { settingsService: SettingsService; canSwitchMachine?: () => string | null }) {
    const { settingsService } = options;

    const fail = (reply: any, error: unknown) => {
        if (error instanceof SettingsError) return reply.status(error.statusCode).send({ error: error.message });
        server.log.error(error);
        return reply.status(500).send({ error: (error as Error)?.message ?? 'Machine settings error' });
    };

    // ── Named machine profiles ──
    server.get('/api/machines', async (_req, reply) => {
        try { return await settingsService.listMachines(); } catch (e) { return fail(reply, e); }
    });

    server.post<{ Body: any }>('/api/machines', async (req, reply) => {
        try { return await settingsService.createMachine(req.body ?? {}); } catch (e) { return fail(reply, e); }
    });

    server.put<{ Params: { id: string }; Body: any }>('/api/machines/:id', async (req, reply) => {
        try { return await settingsService.updateMachine(req.params.id, req.body ?? {}); } catch (e) { return fail(reply, e); }
    });

    server.delete<{ Params: { id: string } }>('/api/machines/:id', async (req, reply) => {
        try {
            const active = await settingsService.getActive();
            if (active.id === req.params.id) {
                const blocked = options.canSwitchMachine?.();
                if (blocked) return reply.status(409).send({ error: blocked });
            }
            return await settingsService.deleteMachine(req.params.id);
        } catch (e) { return fail(reply, e); }
    });

    server.post<{ Params: { id: string } }>('/api/machines/:id/activate', async (req, reply) => {
        try {
            const active = await settingsService.getActive();
            if (active.id !== req.params.id) {
                const blocked = options.canSwitchMachine?.();
                if (blocked) return reply.status(409).send({ error: blocked });
            }
            return await settingsService.setActive(req.params.id);
        } catch (e) { return fail(reply, e); }
    });

    server.get<{ Params: { id: string } }>('/api/machines/:id/export', async (req, reply) => {
        try {
            const file = await settingsService.exportMachine(req.params.id);
            const safe = file.machine.name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'machine';
            reply.header('Content-Disposition', `attachment; filename="lzrcnc-machine-${safe}.json"`);
            return file;
        } catch (e) { return fail(reply, e); }
    });

    // Body: { data: <export file>, targetId?, matchByName?, keepConnection?, activate? }
    server.post<{ Body: any }>('/api/machines/import', async (req, reply) => {
        try {
            const { data, targetId, matchByName, keepConnection, activate } = (req.body ?? {}) as Record<string, any>;
            const store = await settingsService.listMachines();
            const replacingActive = targetId === store.activeId
                || (matchByName && typeof data?.machine?.name === 'string'
                    && store.machines.find(m => m.id === store.activeId)?.name.toLowerCase() === data.machine.name.trim().toLowerCase());
            if (activate || replacingActive) {
                const blocked = options.canSwitchMachine?.();
                if (blocked) return reply.status(409).send({ error: blocked });
            }
            return await settingsService.importMachine(data, { targetId, matchByName, keepConnection, activate });
        } catch (e) { return fail(reply, e); }
    });

    // ── Active machine (kept for older clients) ──

    server.get('/api/settings/machine', async (request, reply) => {
        try {
            const settings = await settingsService.getSettings();
            return settings;
        } catch (error) {
            server.log.error(error);
            return reply.status(500).send({ error: 'Failed to retrieve settings' });
        }
    });

    server.post<{ Body: Partial<MachineSettings> }>('/api/settings/machine', async (request, reply) => {
        try {
            const updatedSettings = await settingsService.saveSettings(request.body);
            return updatedSettings;
        } catch (error) {
            server.log.error(error);
            return reply.status(500).send({ error: 'Failed to save settings' });
        }
    });


    // System Update Endpoints
    server.get('/api/system/update/check', async (request, reply) => {
        try {
            await execAsync('git fetch');
            const { stdout: localHash } = await execAsync('git rev-parse HEAD');

            let remoteHash = '';
            try {
                const { stdout } = await execAsync('git rev-parse @{u}');
                remoteHash = stdout;
            } catch (e) {
                // Fallback if no upstream branch configured, try origin/main
                const { stdout } = await execAsync('git rev-parse origin/main');
                remoteHash = stdout;
            }

            const available = localHash.trim() !== remoteHash.trim();

            return {
                available,
                currentVersion: localHash.trim().substring(0, 7),
                remoteVersion: remoteHash.trim().substring(0, 7)
            };
        } catch (error) {
            server.log.error(error);
            return { available: false, error: 'Failed to check for updates' };
        }
    });

    server.post('/api/system/update/apply', async (request, reply) => {
        try {
            // update.sh lives in <repo>/install/; server usually runs from <repo>/soft/server
            const candidates = [
                path.join(process.cwd(), '..', '..', 'install', 'update.sh'),
                path.join(process.cwd(), '..', 'install', 'update.sh'),
                path.join(process.cwd(), 'install', 'update.sh'),
                resolvePath('update.sh'),
            ];
            const scriptPath = candidates.find(p => fs.existsSync(p));
            if (!scriptPath) {
                return reply.status(500).send({ error: 'Update failed', details: 'update.sh not found' });
            }

            // Execute update script
            // We await it to ensure it completes before restarting
            await execAsync(`bash "${scriptPath}"`);

            // Trigger restart
            // In systemd environment, exiting with 0 triggers restart if Restart=always
            setTimeout(() => {
                process.exit(0);
            }, 1000);

            return { status: 'success', message: 'Update complete. Restarting...' };
        } catch (error: any) {
            server.log.error(error);
            return reply.status(500).send({ error: 'Update failed', details: error.message });
        }
    });
}
