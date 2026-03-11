import Fastify, { FastifyInstance } from 'fastify';
import fs from 'fs';
import cors from '@fastify/cors';
import { GrblController } from './machine/GrblController.js';
import { KlipperController } from './machine/KlipperController.js';
import { MachineInterface } from './machine/MachineInterface.js';
import { MockController } from './machine/MockController.js';
import camRoutes from './routes/cam.js';
import materialRoutes from './routes/material.js'; // Assuming new material routes
import settingsRoutes from './routes/settings.js'; // Import Settings Routes
import toolRoutes from './routes/tools.js';
import cncRoutes from './routes/cnc.js';
import { MaterialService } from './services/MaterialService.js'; // Added import for MaterialService
import { SettingsService } from './services/SettingsService.js'; // Import SettingsService
import { CamService } from './cam/CamService.js'; // Corrected import path
import path from 'path'; // Added import for path module

import fastifyStatic from '@fastify/static';

// ... existing imports ...

const server: FastifyInstance = Fastify({ logger: true });

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
server.register(settingsRoutes, { settingsService }); // Register Settings Routes
server.register(toolRoutes);
server.register(cncRoutes);

// SPA Fallback: serve index.html for unknown routes (React Router support)
server.setNotFoundHandler((req, reply) => {
    (reply as any).sendFile('index.html');
});


let machine: MachineInterface | null = null;
const isSim = process.env.MOCK_HARDWARE === 'true' || process.argv.includes('--sim');

if (isSim) {
    console.log('[SIMULATION] Mode Active. Using MockController.');
    machine = new MockController();
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

server.get('/ping', async (request, reply) => {
    return {
        status: 'ok',
        message: 'LzrCnc Server Online',
        sim: isSim,
        ip: getNetworkIp()
    };
});

server.post('/connect', async (request: any, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { type, port, baud, host } = request.body;

    if (machine) {
        try {
            await machine.disconnect();
        } catch (e) { }
    }

    if (type === 'grbl') {
        machine = new GrblController();
        await machine.connect(port, baud);
    } else if (type === 'klipper') {
        machine = new KlipperController();
        await machine.connect(host);
    } else if (type === 'mock') {
        machine = new MockController();
        await machine.connect('mock-device');
    } else {
        return reply.code(400).send({ error: 'Invalid machine type' });
    }

    return { status: 'connected', type };
});

server.post('/command', async (request, reply) => {
    const { gcode } = request.body as any;
    if (machine) {
        await machine.command(gcode);
    }
    return { status: 'sent' };
});

server.post('/probe', async (request, reply) => {
    const options = request.body as any; // Validation skipped for prototype
    if (machine) {
        try {
            await machine.probe(options);
            return { status: 'ok' };
        } catch (e: any) {
            return { status: 'error', message: e.message };
        }
    }
    return { status: 'disconnected' };
});

server.post('/jog', async (request: any, reply) => {
    if (!machine) return reply.code(400).send({ error: 'Not connected' });
    const { axis, dist, feedrate } = request.body;
    await machine.jog(axis, dist, feedrate);
    return { status: 'ok' };
});

server.get('/status', async (request, reply) => {
    const status = machine ? machine.getStatus() : { state: 'Disconnected' };
    const settings = await settingsService.getSettings();
    return { ...status, ip: getNetworkIp(), machineSettings: settings };
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
        console.log(`Server listening on http://0.0.0.0:${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
