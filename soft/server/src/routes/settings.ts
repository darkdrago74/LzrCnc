import { FastifyInstance } from 'fastify';
import { SettingsService, MachineSettings } from '../services/SettingsService.js';
import { exec } from 'child_process';
import util from 'util';
import { resolvePath } from '../utils/pathUtils.js';

const execAsync = util.promisify(exec);

export default async function settingsRoutes(server: FastifyInstance, options: { settingsService: SettingsService }) {
    const { settingsService } = options;

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
            const scriptPath = resolvePath('update.sh');

            // Execute update script
            // We await it to ensure it completes before restarting
            await execAsync(`"${scriptPath}"`);

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
