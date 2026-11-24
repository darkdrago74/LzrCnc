export type OperationType = 'raster' | 'vector_cut' | 'vector_engrave';

export interface CamOperation {
    id: string;
    type: OperationType;
    enabled: boolean;
    order: number;
    /** User label of the profile, e.g. "Cut 3 mm plywood" */
    name?: string;
    /** Tag colour shown on the objects using this profile */
    color?: string;
    settings: Record<string, any>;
}

export interface CamJob {
    id: string;
    file: File | null;
    operations: CamOperation[];
}
