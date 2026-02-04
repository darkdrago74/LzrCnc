import { VectorOptions, RasterOptions } from './Tools';

export type JobType = 'raster' | 'vector_cut' | 'vector_engrave';

export interface CamOperation {
    id: string;
    type: JobType;
    enabled: boolean;
    // Operation specific settings overriding global defaults if needed
    settings?: Record<string, any>;
}

export interface CamJob {
    id: string;
    name: string;
    status: 'draft' | 'processing' | 'ready' | 'error';
    sourceFilePath: string; // Original image/vector path
    operations: CamOperation[];
    options: VectorOptions & RasterOptions; // Merged for now, can be split
}

export interface ProcessingResult {
    gcode: string;
    previewUrl?: string; // Data URL for preview (dithered image or SVG path)
    stats?: {
        duration: number;
        lines: number;
    };
}

export abstract class CamProcessor {
    abstract process(job: CamJob, operation: CamOperation): Promise<ProcessingResult>;
}
