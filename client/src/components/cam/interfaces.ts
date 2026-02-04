export type OperationType = 'raster' | 'vector_cut' | 'vector_engrave';

export interface CamOperation {
    id: string;
    type: OperationType;
    enabled: boolean;
    order: number;
    settings: Record<string, any>;
}

export interface CamJob {
    id: string;
    file: File | null;
    operations: CamOperation[];
}
