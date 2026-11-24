import { FastifyInstance } from 'fastify';
import { CamService } from '../cam/CamService.js';
import { DxfConverter } from '../cam/processors/DxfConverter.js';
import { GCodeModifier } from '../cam/processors/GCodeModifier.js';
import { PathAnalyzer } from '../cam/PathAnalyzer.js';
import { generateMillingJob, MillJobValidationError } from '../cam/MillingGcodeGenerator.js';
import { generateLaserJob, validateLaserJob, LaserJobValidationError } from '../cam/LaserJobGenerator.js';

export default async function camRoutes(server: FastifyInstance) {
    const camService = new CamService();
    const dxfConverter = new DxfConverter();
    const gcodeModifier = new GCodeModifier();
    const pathAnalyzer = new PathAnalyzer();

    /** Legacy file-based generation (fileContent/filePath + processor options). */
    async function legacyGenerate(request: any, reply: any) {
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
    }

    server.post('/cam/generate', async (request: any, reply) => {
        const body = request.body ?? {};
        const isLegacy = (body.fileContent || body.filePath)
            && !(Array.isArray(body.operations) && body.operations.some((o: any) => o && (o.vectors || o.rasters)));
        if (isLegacy) return legacyGenerate(request, reply);

        try {
            const job = validateLaserJob(body);
            const result = await generateLaserJob(job);
            return { status: 'success', gcode: result.gcode, stats: result.stats };
        } catch (err: any) {
            if (err instanceof LaserJobValidationError) {
                return reply.code(400).send({ status: 'error', error: err.message });
            }
            server.log.error(err);
            return reply.code(500).send({ status: 'error', error: err.message });
        }
    });

    server.get('/cam/validate', async () => {
        return { status: 'ok', modules: ['vector', 'raster'] };
    });

    server.post('/cam/parse-dxf', async (request: any, reply) => {
        try {
            const { fileContent } = request.body;
            if (!fileContent) {
                return reply.code(400).send({ error: 'No DXF content provided' });
            }

            // If it comes with a data URI prefix, remove it
            let rawContent = fileContent;
            if (rawContent.startsWith('data:')) {
                const base64Data = rawContent.split(';base64,').pop();
                rawContent = Buffer.from(base64Data, 'base64').toString('utf8');
            }

            const svg = await dxfConverter.convertToSvg(rawContent);
            return { status: 'success', svg };
        } catch (err: any) {
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    server.post('/cam/modify-gcode', async (request: any, reply) => {
        try {
            const { fileContent, options } = request.body;
            if (!fileContent) {
                return reply.code(400).send({ error: 'No G-Code content provided' });
            }
            const modified = gcodeModifier.modify(fileContent, options || {});
            return { status: 'success', gcode: modified };
        } catch (err: any) {
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    /**
     * POST /cam/analyze-paths
     * Parses a DXF or SVG file and returns all detected paths with metadata:
     *   - closed / open flag
     *   - shape classification (circle, rectangle, polygon, closed_curve, open_curve)
     *   - discretized points ready for Three.js rendering
     *   - raw primitives for later G-code generation
     */
    server.post('/cam/analyze-paths', async (request: any, reply) => {
        try {
            const { fileContent, fileName } = request.body;
            if (!fileContent) {
                return reply.code(400).send({ error: 'No file content provided' });
            }

            // Strip data-URI prefix if present
            let rawContent: string = fileContent;
            if (rawContent.startsWith('data:')) {
                const b64 = rawContent.split(';base64,').pop() ?? '';
                rawContent = Buffer.from(b64, 'base64').toString('utf8');
            }

            const isDxf = (fileName as string)?.toLowerCase().endsWith('.dxf');
            const paths = isDxf
                ? pathAnalyzer.analyzeDxf(rawContent)
                : pathAnalyzer.analyzeSvg(rawContent);

            return { status: 'success', paths };
        } catch (err: any) {
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    /**
     * POST /cam/generate-milling
     * 2.5D milling (face / pocket / profile) for a stock block. Z0 = stock top.
     * Body: { stock, safeZ?, rapidRate?, contours[{id,points,closed}], operations[] } — see MillingGcodeGenerator.
     * Returns: { gcode, toolpaths, warnings, operations, stats }.
     */
    server.post('/cam/generate-milling', async (request: any, reply) => {
        try {
            const result = generateMillingJob(request.body);
            return { status: 'success', ...result };
        } catch (err: any) {
            if (err instanceof MillJobValidationError) return reply.code(400).send({ error: err.message });
            server.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });
}
