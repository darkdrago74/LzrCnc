import type { MachineSettings } from '../types';

export type BedOrigin = 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right';

export interface BedExtents {
    width: number;
    height: number;
    depth: number;
    origin: BedOrigin;
    minX: number; maxX: number;
    minY: number; maxY: number;
    centerX: number; centerY: number;
}

/**
 * Work area in machine coordinates. The origin setting tells which bed corner is (0,0);
 * the machine's positive X/Y always point right/away, so e.g. a top-left origin means
 * the bed spans X 0..W and Y -H..0.
 */
export function getBedExtents(settings?: Partial<MachineSettings> | null, fallback?: { x?: { max: number }; y?: { max: number } }): BedExtents {
    const width = settings?.workbench?.width || fallback?.x?.max || 300;
    const height = settings?.workbench?.height || fallback?.y?.max || 300;
    const depth = settings?.workbench?.depth || 50;
    const origin = (settings?.workbench?.origin || 'bottom-left') as BedOrigin;
    const right = origin === 'top-right' || origin === 'bottom-right';
    const top = origin === 'top-left' || origin === 'top-right';
    const minX = right ? -width : 0;
    const minY = top ? -height : 0;
    return {
        width, height, depth, origin,
        minX, maxX: minX + width,
        minY, maxY: minY + height,
        centerX: minX + width / 2,
        centerY: minY + height / 2,
    };
}
