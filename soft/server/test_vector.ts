import { VectorProcessor } from './src/cam/processors/VectorProcessor.js';
import { CamJob, CamOperation } from './src/cam/interfaces.js';
import fs from 'fs';

async function run() {
    const processor = new VectorProcessor();

    fs.writeFileSync('test.svg', '<svg><path d="M 10 10 L 20 20 L 20 10 Z" /></svg>');

    const job: any = {
        id: 'test',
        name: 'test',
        status: 'draft',
        sourceFilePath: 'test.svg',
        options: {
            tool: { type: 'cnc', id: 't1', name: 'bit', units: 'mm', diameter: 3.175, cutDepth: 1 },
            format: 'svg',
            feedrate: 800,
            cutHeight: -2,
            workingZ: 0,
            safeZ: 5,
            cutSide: 'outside'
        },
        operations: []
    };

    const op: CamOperation = {
        id: 'op1',
        type: 'vector_cut',
        enabled: true,
        settings: {}
    };

    const result = await processor.process(job, op);
    console.log("----- GCODE RESULT -----");
    console.log(result.gcode);
}

run().catch(console.error);
