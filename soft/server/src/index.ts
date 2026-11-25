import Fastify, { FastifyInstance } from 'fastify';
import fs from 'fs';
import cors from '@fastify/cors';
import { GrblController } from './machine/GrblController.js';
import { KlipperController } from './machine/KlipperController.js';
import { MachineInterface } from './machine/MachineInterface.js';
import { MockController } from './machine/MockController.js';
import { JobRunner, JobConflictError, cleanGcodeLines } from './machine/JobRunner.js';
import camRoutes from './routes/cam.js';
import materialRoutes from './routes/material.js'; // Assuming new material routes
import settingsRoutes from './routes/settings.js'; // Import Settings Routes
import toolRoutes from './routes/tools.js';
import cncRoutes from './routes/cnc.js';
import { MaterialService } from './services/MaterialService.js'; // Added import for MaterialService
import { SettingsService, type MachineSettings } from './services/SettingsService.js'; // Import SettingsService
import { CamService } from './cam/CamService.js'; // Corrected import path
import path from 'path'; // Added import for path module

import fastifyStatic from '@fastify/static';

// ... existing imports ...

// Raster jobs carry image data URLs / large G-code bodies
const server: FastifyInstance = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 });

server.register(cors, {
    origin: '*'
});

import { resolvePath } from './utils/pathUtils.js';

// Serve frontend static files
const distPath = resolvePath('client/dist');
server.register(fastifyStatic, {
    root: distPath,
    prefix: '/', // Start serving from root
});

// Services
const camService = new CamService();
const dataDir = resolvePath('data');
// Ensure data dir exists
if (!fs.existsSync(dataDir)) {
    console.warn(`Data directory not found at ${dataDir}, creating it...`);
    fs.mkdirSync(dataDir, { recursive: true });
}

const materialService = new MaterialService(dataDir);
const settingsService = new SettingsService(dataDir); // Instantiate SettingsService

server.register(camRoutes, { camService });
server.register(materialRoutes, { materialService });
server.register(settingsRoutes, { settingsService, canSwitchMachine: () => machineSwitchBlocker() }); // Register Settings Routes
server.register(toolRoutes);
server.register(cncRoutes);

// SPA Fallback: serve index.html for unknown routes (React Router support).
// Missing files (assets, API) get a real 404 so the browser reports them instead of parsing HTML as JavaScript.
server.setNotFoundHandler((req, reply) => {
    const urlPath = req.url.split('?')[0];
    if (req.method !== 'GET' || urlPath.startsWith('/api/') || urlPath.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(urlPath)) {
        return reply.code(404).send({ error: 'Not found', path: urlPath });
    }
    return (reply as any).sendFile('index.html');
});


let machine: MachineInterface | null = null;
let machineType: 'grbl' | 'klipper' | 'mock' | null = null;
const jobRunner = new JobRunner();
const REALTIME_COMMANDS = new Set(['!', '~', '?', '\x18']);
const isSim = process.env.MOCK_HARDWARE === 'true' || process.argv.includes('--sim');

/** The active machine profile may change freely, except while it drives real hardware or a job. */
function machineSwitchBlocker(): string | null {
    if (jobRunner.isActive()) return 'A job is running. Stop it before changing the machine.';
    if (machine && machineType !== 'mock') return 'Disconnect the machine before switching to another profile.';
    return null;
}

/** The simulator takes its travel limits from the active machine profile. */
function limitsFromSettings(s: MachineSettings) {
    return {
        x: { min: 0, max: s.workbench.width },
        y: { min: 0, max: s.workbench.height },
        z: { min: 0, max: s.workbench.depth },
    };
}

if (isSim) {
    console.log('[SIMULATION] Mode Active. Using MockController.');
    const mock = new MockController();
    machine = mock;
    machineType = 'mock';
    settingsService.getSettings().then(s => mock.setLimits(limitsFromSettings(s))).catch(() => { /* defaults */ });
    machine.connect('mock-device'); // Auto-connect in sim mode
}

import os from 'os';

function getNetworkIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            // Skip internal and non-IPv4
            if (!iface.internal && iface.family === 'IPv4') {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

import { SerialPort } from 'serialport';

server.get('/ping', async (request, reply) => {
    return {
        status: 'ok',
        message: 'LzrCnc Server Online',
        sim: isSim,
        ip: getNetworkIp()
    };
});

server.get('/api/ports', async (request, reply) => {
    try {
        const ports = await SerialPort.list();
        let filteredPorts = ports.filter(p => {
            const desc = (p.manufacturer || '').toLowerCase();
            const pnpId = (p.pnpId || '').toLowerCase();
            return desc.includes('arduino') || desc.includes('ch340') || desc.includes('cp210') || desc.includes('ftdi') || pnpId.includes('arduino') || p.path.toLowerCase().includes('usb');
        });

        if (filteredPorts.length === 0) {
            filteredPorts = ports;
        }

        const portNames = filteredPorts.map(p => p.path);
        return { ports: portNames };
    } catch (e) {
        server.log.error(e);
        return reply.code(500).send({ error: 'Failed to list ports' });
    }
});

async function disconnectMachine() {
    const m = machine;
    machine = null;
    machineType = null;
    jobRunner.abandon('Machine disconnected');
    if (m) {
        try { await m.disconnect(); } catch (e) { server.log.warn(e); }
    }
}

server.post('/connect', async (request: any, reply) => {
    const { type, port, baud, host, machineId } = request.body ?? {};
    if (!['grbl', 'klipper', 'mock'].includes(type)) {
        return reply.code(400).send({ error: 'Invalid machine type' });
    }
    if (jobRunner.isActive()) {
        return reply.code(409).send({ error: 'A job is running. Stop it before reconnecting.' });
    }

    await disconnectMachine();

    // Connect "as" a saved machine profile: it becomes the active one (bed, limits, simulator size)
    let profileSettings: MachineSettings;
    try {
        profileSettings = machineId
            ? (await settingsService.setActive(String(machineId))).settings
            : await settingsService.getSettings();
    } catch (e: any) {
        return reply.code(e?.statusCode ?? 500).send({ error: e?.message ?? String(e) });
    }

    let next: MachineInterface;
    try {
        if (type === 'grbl') {
            next = new GrblController();
            await next.connect(port, baud);
        } else if (type === 'klipper') {
            next = new KlipperController();
            await next.connect(host);
        } else {
            const mock = new MockController();
            mock.setLimits(limitsFromSettings(profileSettings));
            next = mock;
            await next.connect('mock-device');
        }
    } catch (e: any) {
        server.log.error(e);
        return reply.code(500).send({ error: `Connection failed: ${e?.message ?? e}` });
    }
    next.on('error', (err: Error) => server.log.error(err));
    machine = next;
    machineType = type;
    // Remember the port / host for this machine (not for the simulator)
    if (type !== 'mock') {
        const active = await settingsService.getActive();
        await settingsService.updateMachine(active.id, {
            connection: type === 'grbl' ? { type, port, baud } : { type, host },
        }).catch(e => server.log.warn(e));
    }
    return { status: 'connected', type };
});

server.post('/disconnect', async () => {
    await disconnectMachine();
    return { status: 'disconnected' };
});

server.post('/command', async (request, reply) => {
    const { gcode } = (request.body ?? {}) as any;
    if (typeof gcode !== 'string' || gcode.length === 0) {
        return reply.code(400).send({ error: 'gcode must be a non-empty string' });
    }
    if (!machine) return reply.code(400).send({ error: 'Not connected' });
    const realtime = REALTIME_COMMANDS.has(gcode) || REALTIME_COMMANDS.has(gcode.trim());
    if (jobRunner.isActive() && !realtime) {
        return reply.code(409).send({ error: 'A job is running' });
    }
    await machine.command(realtime ? (REALTIME_COMMANDS.has(gcode) ? gcode : gcode.trim()) : gcode);
    return { status: 'sent' };
});

server.post('/probe', async (request, reply) => {
    const options = request.body as any;
    if (!machine) return { status: 'disconnected' };
    if (jobRunner.isActive()) return reply.code(409).send({ error: 'A job is running' });
    try {
        await machine.probe(options);
        return { status: 'ok' };
    } catch (e: any) {
        return { status: 'error', message: e.message };
    }
});

server.post('/jog', async (request: any, reply) => {
    if (!machine) return reply.code(400).send({ error: 'Not connected' });
    if (jobRunner.isActive()) return reply.code(409).send({ error: 'A job is running' });
    const { axis, dist, feedrate } = request.body;
    await machine.jog(axis, dist, feedrate);
    return { status: 'ok' };
});

// ── Job streaming ────────────────────────────────────────────────────────────

server.post('/cam/stream-job', async (request: any, reply) => {
    const { setupCommands, gcode } = request.body ?? {};
    if (typeof gcode !== 'string' && !Array.isArray(gcode)) {
        return reply.code(400).send({ error: 'gcode must be a string or an array of lines' });
    }
    if (setupCommands !== undefined && !Array.isArray(setupCommands)) {
        return reply.code(400).send({ error: 'setupCommands must be an array of strings' });
    }
    if (!machine) return reply.code(409).send({ error: 'Machine not connected' });
    if (jobRunner.isActive()) return reply.code(409).send({ error: 'A job is already running' });
    const state = machine.getStatus().state;
    if (state !== 'Idle') return reply.code(409).send({ error: `Machine is not idle (state: ${state})` });

    const lines = [...cleanGcodeLines(setupCommands ?? []), ...cleanGcodeLines(gcode)];
    if (lines.length === 0) return reply.code(400).send({ error: 'No G-code lines to send' });
    try {
        const { total } = jobRunner.start(machine, lines);
        return { status: 'started', total };
    } catch (e: any) {
        if (e instanceof JobConflictError) return reply.code(409).send({ error: e.message });
        throw e;
    }
});

server.post('/job/pause', async () => ({ status: await jobRunner.pause() }));
server.post('/job/resume', async () => ({ status: await jobRunner.resume() }));
server.post('/job/stop', async () => ({ status: await jobRunner.stop() }));

let cachedIp = { value: '127.0.0.1', at: 0 };
function getCachedIp() {
    if (Date.now() - cachedIp.at > 10000) cachedIp = { value: getNetworkIp(), at: Date.now() };
    return cachedIp.value;
}

server.get('/status', async () => {
    const status = machine ? machine.getStatus() : { state: 'Disconnected' };
    const active = await settingsService.getActive(); // cached in memory after first read
    if (machine instanceof MockController) machine.setLimits(limitsFromSettings(active.settings));
    return {
        ...status,
        ip: getCachedIp(),
        machineSettings: active.settings,
        activeMachine: { id: active.id, name: active.name, kind: active.kind },
        connectionType: machineType,
        job: jobRunner.getStatus(),
    };
});

const { AIGcodeOptimizer } = require('./cam/processors/AIGcodeOptimizer');
const aiOptimizer = new AIGcodeOptimizer();

server.post('/api/ai/optimize-path', async (request: any, reply) => {
    try {
        const { gcode } = request.body;
        if (!gcode) return reply.code(400).send({ error: 'No G-code provided' });

        // Use the placeholder AI optimizer
        const optimized = await aiOptimizer.optimize(gcode);
        return { status: 'success', optimizedGcode: optimized };
    } catch (err: any) {
        server.log.error(err);
        return reply.code(500).send({ error: err.message });
    }
});

const start = async () => {
    try {
        const port = Number(process.env.PORT) || 3001;
        await server.listen({ port, host: '0.0.0.0' });
        const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|^br-|^veth|^virbr|Loopback/i;
        const lanUrls = Object.entries(os.networkInterfaces())
            .filter(([name]) => !virtual.test(name))
            .flatMap(([name, addrs]) => (addrs ?? [])
                .filter(a => a.family === 'IPv4' && !a.internal)
                .map(a => `http://${a.address}:${port}   (${name})`));
        console.log('');
        console.log(`  LzrCnc is running on port ${port}`);
        // 127.0.0.1 rather than localhost: enterprise Edge policies often force "localhost" into Internet Explorer mode
        console.log(`  This computer : http://127.0.0.1:${port}`);
        for (const url of lanUrls) console.log(`  Network       : ${url}`);
        if (lanUrls.length === 0) console.log('  Network       : no network address found');
        console.log('');
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
