import { FastifyInstance } from 'fastify';
import { CamService } from '../cam/CamService.js';

export default async function camRoutes(server: FastifyInstance) {
    const camService = new CamService();

    server.post('/cam/generate', async (request: any, reply) => {
        const { fileContent, filePath, fileName, operations, options } = request.body;
        // Support both: uploaded file path OR raw content sent in body
        // If fileContent is base64 string, convert to Buffer
        let source: string | Buffer = filePath;

        if (!source && fileContent) {
            if (typeof fileContent === 'string' && fileContent.startsWith('data:')) {
                // Remove prefix
                const base64Data = fileContent.split(';base64,').pop();
                if (base64Data) source = Buffer.from(base64Data, 'base64');
            } else {
                source = fileContent;
            }
        }

        if (!source) {
            return reply.code(400).send({ error: 'No file provided. Send filePath or fileContent.' });
        }

        // Construct Job
        // If request sends a list of operations, use them.
        // Legacy support: if request sends "type" and "options", wrap in single operation.
        let jobOperations = operations;
        if (!jobOperations && request.body.type) {
            jobOperations = [{
                id: 'legacy-op',
                type: request.body.type === 'vector' ? 'vector_cut' : 'raster',
                enabled: true,
                settings: options
            }];
        }

        try {
            const job = {
                id: 'job-' + Date.now(),
                name: fileName || 'Untitled Job',
                status: 'draft',
                sourceFilePath: source as any,
                operations: jobOperations,
                options: options || {} // Global fallback options
            };

            // If Source is Buffer, write to temp file if needed by vector processor (potrace usually needs file)
            // Raster processor uses sharp which handles buffer.
            if (Buffer.isBuffer(source)) {
                const fs = await import('fs');
                const path = await import('path');
                const os = await import('os');
                const tempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${fileName || 'file'}`);
                await fs.promises.writeFile(tempPath, source);
                job.sourceFilePath = tempPath;
            }

            const result = await camService.generateJob(job as any);
            return { status: 'success', gcode: result.gcode };

        } catch (err: any) {
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    server.get('/cam/validate', async () => {
        return { status: 'ok', modules: ['vector', 'raster'] };
    });
}
