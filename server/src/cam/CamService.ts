import { CamJob, CamOperation, ProcessingResult } from './interfaces.js';
import { RasterProcessor } from './processors/RasterProcessor.js';
import { VectorProcessor } from './processors/VectorProcessor.js';
import { VectorOptions, RasterOptions } from './Tools.js';

export class CamService {
    private rasterProcessor: RasterProcessor;
    private vectorProcessor: VectorProcessor;

    constructor() {
        this.rasterProcessor = new RasterProcessor();
        this.vectorProcessor = new VectorProcessor();
    }

    /**
     * Legacy entry point - keeping for compatibility but forwarding to new logic where possible,
     * or deprecated. The UI calls /cam/generate.
     */
    async generateJob(job: CamJob): Promise<ProcessingResult> {
        // A job can have multiple operations
        // For now, we concatenate the G-code from each operation

        const results: string[] = [];
        let totalLines = 0;

        // Header
        results.push('; Job: ' + job.name);
        results.push('G21 ; mm');
        results.push('G90 ; Absolute');

        for (const op of job.operations) {
            if (!op.enabled) continue;

            let opResult: ProcessingResult;

            if (op.type === 'raster') {
                opResult = await this.rasterProcessor.process(job, op);
            } else if (op.type === 'vector_cut' || op.type === 'vector_engrave') {
                opResult = await this.vectorProcessor.process(job, op);
            } else {
                continue;
            }

            results.push(opResult.gcode);
            if (opResult.stats) totalLines += opResult.stats.lines;
        }

        // Footer
        results.push('M5');
        results.push('G0 X0 Y0');

        return {
            gcode: results.join('\n'),
            stats: { lines: totalLines, duration: 0 }
        };
    }
}
