import { FastifyInstance } from 'fastify';
import { CncService, CncJob2D } from '../cnc/CncService.js';
import { ToolLibrary } from '../cnc/ToolLibrary.js';

export default async function cncRoutes(server: FastifyInstance) {
    const cncService = new CncService();
    const toolLib = new ToolLibrary();

    server.post('/cnc/generate', async (request: any, reply) => {
        const { type, job } = request.body;

        try {
            if (type === '2.5d') {
                const fullJob = job as CncJob2D;
                // Hydrate tool from ID if only ID provided? 
                // Currently UI sends whole tool probably.
                // But safer to lookup if ID exists.
                if (fullJob.tool && fullJob.tool.id) {
                    const storedTool = toolLib.getById(fullJob.tool.id);
                    if (storedTool) fullJob.tool = storedTool;
                }

                // File Path handling
                // The CncService expects 'filePath' on disk.
                // If user uploaded a file, we need to handle it.
                // Assuming frontend uploads file separately or we handle raw content (TODO).
                // For now, assume filePath is passed (from upload) OR handle temp file write like CAM.

                // Handle raw content if provided
                if (request.body.fileContent) {
                    const fs = await import('fs');
                    const path = await import('path');
                    const os = await import('os');
                    const tempPath = path.join(os.tmpdir(), `cnc-job-${Date.now()}.dxf`);
                    await fs.promises.writeFile(tempPath, request.body.fileContent);
                    fullJob.filePath = tempPath;
                }

                const gcode = await cncService.generate2D(fullJob);
                return { status: 'success', gcode };
            }

            return reply.code(400).send({ error: 'Invalid CNC job type' });

        } catch (err: any) {
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });
}
